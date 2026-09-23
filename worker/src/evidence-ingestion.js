import { createTradeJournal, isCanonicalTrade, isUserEconomicAttribution } from '../../js/market-evidence.js';
import { verifyTransaction } from './transaction-evidence.js';
import { validSignature } from './protocol-verifiers.js';
import { verificationCategory, summarizeCoverage } from './verification-coverage.js';
import { verifyPoolExecutions } from './pool-executions.js';
import { summarizePoolCoverage } from './pool-coverage.js';
import { acquisitionFailure, AcquisitionError } from './acquisition-policy.js';

export const INGESTION_POLICY = Object.freeze({ maxRecords: 1024, maxQueued: 128, concurrency: 2,
    maxAgeMs: 300_000, retries: 3, reconciliationMs: 3000, reconciliationDeadlineMs: 90_000, statusBatch: 50, maxTransactionReadsPerMinute: 120 });

export function createEvidenceIngestion({ tokenMint, canonicalMarket = null, rpc, now = Date.now,
    onChange = () => {}, onGap = () => {}, policy = INGESTION_POLICY }) {
    const records = new Map();
    const journal = createTradeJournal(tokenMint, { maxEntries: policy.maxRecords, maxAgeMs: policy.maxAgeMs }, canonicalMarket
        ? (e) => isCanonicalTrade(e) && e.poolAddress === canonicalMarket.address && e.sourceEpoch === canonicalMarket.sourceEpoch
        : isUserEconomicAttribution);
    const running = new Set();
    const abort = new AbortController();
    let stopped = false;
    let reconciling = false;
    let lastReconcile = 0;
    let transactionStarts = [];
    const counts = { duplicates: 0, rejected: 0, unverified: 0, overflow: 0, rpcFailures: 0, reconciled: 0 };
    const acquisition = {
        transaction: { status: 'UNKNOWN', reason: null, lastAttemptAt: null, lastSuccessAt: null, lastFailureAt: null, nextRetryAt: null, generation: 0 },
        status: { status: 'UNKNOWN', reason: null, lastAttemptAt: null, lastSuccessAt: null, lastFailureAt: null, nextRetryAt: null, generation: 0 },
    };
    const failedJobs = { transaction: new Map(), status: new Map() };
    function acquisitionAttempt(domain) {
        const current = acquisition[domain];
        current.generation += 1; current.lastAttemptAt = now();
        return { generation: current.generation, attemptedAt: current.lastAttemptAt };
    }
    function acquisitionResult(domain, ticket, ok, error = null) {
        const current = acquisition[domain];
        if (ok) {
            if (failedJobs[domain].size) return;
            current.status = 'HEALTHY'; current.reason = null; current.nextRetryAt = null; current.lastSuccessAt = now();
        } else {
            const failure = acquisitionFailure(error);
            current.status = 'RETRY_WAIT'; current.reason = failure.reason; current.nextRetryAt = failure.retryAt;
            current.lastFailureAt = now();
        }
    }

    function publish(record, event) {
        if (stopped) return;
        const result = journal.upsert(event, now());
        if (event.settlement === 'REJECTED' && record.state !== 'REJECTED') counts.rejected += 1;
        if (event.settlement === 'FINALIZED' && record.state !== 'FINALIZED') counts.reconciled += 1;
        record.event = event;
        record.events ||= new Map(); record.events.set(event.id, event);
        record.category = verificationCategory({ event });
        record.state = event.settlement;
        if (result.accepted) onChange({ type: result.fresh ? 'trade' : 'reconcile', data: event });
    }
    function withdraw(record, settlement, reconciliationReason) {
        for (const event of record.events?.values() || []) publish(record, { ...event, settlement, reconciliationReason });
    }
    function unknown(record, reason) {
        if (record.event) withdraw(record, 'RECONCILIATION_UNKNOWN', reason);
        else record.state = 'RECONCILIATION_UNKNOWN';
        failedJobs.transaction.delete(record.signature); failedJobs.status.delete(record.signature);
        for (const domain of ['transaction','status']) if (!failedJobs[domain].size && acquisition[domain].status === 'RETRY_WAIT') {
            acquisition[domain].status = 'GAP_RECORDED'; acquisition[domain].reason = null; acquisition[domain].nextRetryAt = null;
        }
        if (!record.gapReported) {
            record.gapReported = true;
            onGap({ reason, signature: record.signature, sourceEpoch: canonicalMarket?.sourceEpoch || null, at: now() });
        }
    }
    function cleanup() {
        for (const [signature, r] of records) if (!r.running && now() - r.createdAt > policy.maxAgeMs) records.delete(signature);
        journal.values(now());
    }
    function observeSignature(signature, slot = null) {
        if (stopped || !validSignature(signature) || (slot !== null && (!Number.isSafeInteger(slot) || slot < 0))) return false;
        cleanup();
        if (records.has(signature)) { counts.duplicates += 1; return false; }
        if (records.size >= policy.maxRecords || [...records.values()].filter((r) => r.state === 'PENDING').length >= policy.maxQueued) {
            counts.overflow += 1; onGap({ reason: 'EVIDENCE_QUEUE_SATURATED', signature,
                sourceEpoch: canonicalMarket?.sourceEpoch || null, at: now() }); return false;
        }
        records.set(signature, { signature, slot, state: 'PENDING', attempts: 0, createdAt: now(), nextAt: now(), running: false });
        pump();
        return true;
    }
    async function fetchEvidence(record, commitment = 'confirmed') {
        record.running = true;
        record.attempts += 1;
        const ticket = acquisitionAttempt('transaction');
        try {
            const tx = await rpc('getTransaction', [record.signature, { encoding: 'jsonParsed', commitment, maxSupportedTransactionVersion: 0 }], abort.signal);
            if (stopped) return;
            if (tx) failedJobs.transaction.delete(record.signature);
            acquisitionResult('transaction', ticket, true);
            if (!tx) {
                if (record.attempts >= policy.retries || now() - record.createdAt >= policy.reconciliationDeadlineMs) {
                    unknown(record, 'TRANSACTION_NOT_AVAILABLE_DEADLINE');
                } else {
                    record.state = commitment === 'finalized' ? 'FINALIZE_PENDING' : 'PENDING';
                    record.nextAt = now() + 1000 * 4 ** (record.attempts - 1);
                }
                return;
            }
            const result = canonicalMarket ? verifyPoolExecutions(tx, record.signature, canonicalMarket, commitment.toUpperCase())
                : verifyTransaction(tx, record.signature, tokenMint, commitment.toUpperCase());
            if (canonicalMarket) record.poolResult = result;
            record.category = verificationCategory(result);
            const events = result.events ?? (result.event ? [result.event] : []);
            const incoming = new Set(events.map((e) => e.id));
            for (const previous of record.events?.values() || []) if (!incoming.has(previous.id)) {
                publish(record, { ...previous, settlement: 'REJECTED', reconciliationReason: result.reason || 'INVOCATION_MISSING' });
            }
            if (events.length) for (const event of events) publish(record, { ...event, observedAt: record.createdAt, receivedAt: now() });
            else if (record.event) withdraw(record, 'REJECTED', result.reason);
            else {
                record.state = result.status;
                record.reason = result.reason;
                if (!['NON_DIRECTIONAL','NON_SWAP'].includes(result.status)) counts[result.status === 'FAILED' ? 'rejected' : 'unverified'] += 1;
            }
        } catch (error) {
            if (stopped) return;
            if (error instanceof AcquisitionError && error.deferred) {
                record.attempts -= 1;
                record.state = commitment === 'finalized' ? 'FINALIZE_PENDING' : 'PENDING';
                record.nextAt = error.retryAt || now() + 1_000;
                return;
            }
            counts.rpcFailures += 1;
            failedJobs.transaction.set(record.signature, acquisitionFailure(error));
            acquisitionResult('transaction', ticket, false, error);
            if (record.attempts >= policy.retries) {
                unknown(record, 'TRANSACTION_ACQUISITION_EXHAUSTED');
            } else {
                record.state = commitment === 'finalized' ? 'FINALIZE_PENDING' : 'PENDING';
                record.nextAt = now() + 1000 * 4 ** (record.attempts - 1);
            }
        } finally { record.running = false; }
    }
    function pump() {
        if (stopped) return;
        transactionStarts = transactionStarts.filter((at) => now() - at < 60_000);
        for (const record of records.values()) {
            if (running.size >= policy.concurrency) break;
            if (record.running || !['PENDING', 'FINALIZE_PENDING'].includes(record.state) || record.nextAt > now()) continue;
            if (transactionStarts.length >= policy.maxTransactionReadsPerMinute) break;
            transactionStarts.push(now());
            const task = fetchEvidence(record, record.state === 'FINALIZE_PENDING' ? 'finalized' : 'confirmed');
            running.add(task);
            void task.finally(() => { running.delete(task); pump(); });
        }
    }
    async function tick() {
        if (stopped) return;
        cleanup();
        for (const record of records.values()) {
            if (['PENDING','FINALIZE_PENDING'].includes(record.state) && !record.running
                && now() - record.createdAt > policy.reconciliationDeadlineMs) {
                unknown(record, 'EVIDENCE_SETTLEMENT_DEADLINE');
            }
        }
        pump();
        if (reconciling || now() - lastReconcile < policy.reconciliationMs) return;
        const pending = [...records.values()].filter((r) => r.state === 'CONFIRMED' && !r.running)
            .sort((a, b) => (a.checkedAt || 0) - (b.checkedAt || 0)).slice(0, policy.statusBatch);
        if (!pending.length) return;
        reconciling = true;
        lastReconcile = now();
        const ticket = acquisitionAttempt('status');
        try {
            const result = await rpc('getSignatureStatuses', [pending.map((r) => r.signature), { searchTransactionHistory: true }], abort.signal);
            if (stopped) return;
            if (!result || !Array.isArray(result.value) || result.value.length !== pending.length) throw new Error('STATUS_MALFORMED');
            for (const record of pending) failedJobs.status.delete(record.signature);
            acquisitionResult('status', ticket, true);
            for (let i = 0; i < pending.length; i += 1) {
                const record = pending[i];
                record.checkedAt = now();
                const status = result?.value?.[i];
                if (status?.err) withdraw(record, 'REJECTED', 'FINAL_STATUS_FAILED');
                else if (status?.confirmationStatus === 'finalized') {
                    record.state = 'FINALIZE_PENDING'; record.attempts = 0; record.nextAt = now();
                } else if (now() - record.createdAt > policy.reconciliationDeadlineMs) {
                    unknown(record, 'FINAL_STATUS_DEADLINE');
                }
            }
        } catch (error) {
            if (error instanceof AcquisitionError && error.deferred) {
                lastReconcile = Math.min(lastReconcile, (error.retryAt || now() + 1_000) - policy.reconciliationMs);
                return;
            }
            counts.rpcFailures += 1;
            const failure = acquisitionFailure(error);
            for (const record of pending) failedJobs.status.set(record.signature, failure);
            acquisitionResult('status', ticket, false, error);
            for (const record of pending) if (now() - record.createdAt > policy.reconciliationDeadlineMs) {
                unknown(record, 'FINAL_STATUS_ACQUISITION_EXHAUSTED');
            }
        } finally { reconciling = false; pump(); }
    }
    return {
        observeSignature, tick,
        async drain() { while (running.size && !stopped) await Promise.allSettled([...running]); },
        snapshot: () => journal.values(now(), true),
        diagnostics: () => ({ ...counts, acquisition: structuredClone(acquisition),
            coverage: canonicalMarket ? summarizePoolCoverage(records.values()) : summarizeCoverage(records.values()), records: records.size, running: running.size,
            pendingReconciliations: [...records.values()].filter((r) => ['CONFIRMED', 'FINALIZE_PENDING'].includes(r.state)).length,
            pendingEvidence: [...records.values()].filter((r) => ['PENDING','CONFIRMED','FINALIZE_PENDING'].includes(r.state)).length,
            lastVerifiedSlot: journal.values(now()).reduce((s, e) => Math.max(s, e.slot), 0), journal: journal.diagnostics() }),
        destroy() { stopped = true; abort.abort(); records.clear(); journal.clear(); },
    };
}
