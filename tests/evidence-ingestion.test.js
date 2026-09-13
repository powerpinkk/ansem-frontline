import { describe, expect, it } from 'vitest';
import { createEvidenceIngestion, INGESTION_POLICY } from '../worker/src/evidence-ingestion.js';
import { createTradeJournal } from '../js/market-evidence.js';
import { calculatePressure } from '../js/market.js';
import { swapFixture, canonicalEvent, signatureFor, MINT, USDC } from './fixtures/integrity.js';

describe('bounded settlement ingestion', () => {
    it('enforces the RPC budget and withdraws a queued finalization at its deadline', async () => {
        let now = 10_000; let txReads = 0;
        const f = swapFixture({ blockTime: 10 });
        const service = createEvidenceIngestion({ tokenMint: MINT, canonicalMarket: f.market, now: () => now,
            policy: { ...INGESTION_POLICY, maxTransactionReadsPerMinute: 1, reconciliationDeadlineMs: 10_000 },
            rpc: async (method) => {
                if (method === 'getTransaction') { txReads += 1; return f.transaction; }
                return { value: [{ confirmationStatus: 'finalized', err: null }] };
            } });
        service.observeSignature(f.signature); await service.drain();
        now += 4000; await service.tick(); await service.drain();
        expect(txReads).toBe(1);
        now += 11_000; await service.tick();
        expect(service.snapshot()[0].settlement).toBe('RECONCILIATION_UNKNOWN');
        expect(service.diagnostics().overflow).toBeGreaterThan(0);
        service.destroy();
    });
    it('confirmed→finalized upgrades one event after independently re-verifying finalized data', async () => {
        let now = 10_000; const changes = []; const calls = [];
        const f = swapFixture({ blockTime: 10 });
        const service = createEvidenceIngestion({ tokenMint: MINT, canonicalMarket: f.market, now: () => now, onChange: (m) => changes.push(m),
            rpc: async (method, params) => { calls.push({ method, params }); return method === 'getTransaction'
                ? f.transaction : { value: [{ confirmationStatus: 'finalized', slot: 100, err: null }] }; } });
        expect(service.observeSignature(f.signature, 100)).toBe(true);
        await service.drain();
        expect(service.observeSignature(f.signature, 100)).toBe(false);
        expect(service.snapshot()).toHaveLength(1); expect(service.snapshot()[0].settlement).toBe('CONFIRMED');
        now += 4000; await service.tick(); await service.drain();
        expect(service.snapshot()).toHaveLength(1); expect(service.snapshot()[0].settlement).toBe('FINALIZED');
        expect(changes.map((x) => x.type)).toEqual(['trade', 'reconcile']);
        expect(calls.at(-1).params[1].commitment).toBe('finalized');
        service.destroy();
    });
    it('rebuilds pressure on invalidation without an opposite trade', async () => {
        let now = 10_000; const changes = []; const f = swapFixture({ blockTime: 10 });
        const service = createEvidenceIngestion({ tokenMint: MINT, canonicalMarket: f.market, now: () => now, onChange: (m) => changes.push(m),
            rpc: async (method) => method === 'getTransaction' ? f.transaction : { value: [{ err: { rejected: true } }] } });
        service.observeSignature(f.signature); await service.drain();
        expect(calculatePressure(service.snapshot(), now).buySol).toBe(25);
        now += 4000; await service.tick();
        expect(calculatePressure(service.snapshot(), now).totalSol).toBe(0);
        expect(changes).toHaveLength(2); expect(changes[1].data.isBuy).toBe(true);
        expect(changes[1].data.settlement).toBe('REJECTED'); service.destroy();
    });
    it('retries null boundedly and never relabels timeout as a trade or chain failure', async () => {
        let now = 10_000; let requests = 0;
        const service = createEvidenceIngestion({ tokenMint: MINT, now: () => now, rpc: async () => { requests += 1; return null; } });
        service.observeSignature(signatureFor()); await service.drain();
        for (let i = 0; i < 10; i += 1) { now += 10_000; await service.tick(); await service.drain(); }
        expect(requests).toBe(3); expect(service.snapshot()).toEqual([]); service.destroy();
    });
    it('unknown reconciliation withdraws provisional authority and remains one identity', async () => {
        let now = 10_000; const f = swapFixture({ blockTime: 10 });
        const service = createEvidenceIngestion({ tokenMint: MINT, canonicalMarket: f.market, now: () => now,
            rpc: async (method) => method === 'getTransaction' ? f.transaction : { value: [null] } });
        service.observeSignature(f.signature); await service.drain(); now = 101_000; await service.tick();
        expect(service.snapshot()[0].settlement).toBe('RECONCILIATION_UNKNOWN');
        expect(service.observeSignature(f.signature)).toBe(false); service.destroy();
    });
    it('bounds concurrency, queues and record retention under duplicates and token switches', async () => {
        let now = 10_000; const pending = [];
        const service = createEvidenceIngestion({ tokenMint: MINT, now: () => now, policy: { ...INGESTION_POLICY, maxRecords: 8, maxQueued: 8 },
            rpc: () => new Promise((resolve) => pending.push(resolve)) });
        for (let i = 1; i <= 100; i += 1) service.observeSignature(signatureFor(i));
        expect(service.diagnostics()).toMatchObject({ records: 8, running: 2, overflow: 92 });
        service.destroy(); for (const resolve of pending) resolve(null);
        await service.drain(); expect(service.snapshot()).toEqual([]);
        now += 1;
        const next = createTradeJournal(USDC); expect(next.upsert(canonicalEvent(), now).accepted).toBe(false);
    });
});

describe('canonical journal and pressure', () => {
    it('deduplicates live, history, replay and finality; sorts by slot', () => {
        const now = Date.now(); const j = createTradeJournal(MINT);
        const later = canonicalEvent({ slot: 200, signature: signatureFor(2), timestamp: now });
        const earlier = canonicalEvent({ slot: 100, timestamp: now });
        j.upsert(later, now); j.upsert(earlier, now); j.upsert(later, now);
        j.upsert({ ...earlier, settlement: 'FINALIZED' }, now);
        j.upsert(earlier, now);
        expect(j.values(now).map((e) => e.slot)).toEqual([100, 200]);
        expect(calculatePressure(j.values(now), now).buySol).toBe(50);
    });
    it('cannot revive rejected evidence through older confirmed replay', () => {
        const now = Date.now(); const j = createTradeJournal(MINT); const e = canonicalEvent();
        j.upsert(e, now); j.upsert({ ...e, settlement: 'REJECTED' }, now); j.upsert(e, now);
        expect(j.values(now)).toEqual([]);
    });
    it('does not invent pressure from transfers, unknown USD, future events or duplicate entries', () => {
        const now = Date.now(); const buy = canonicalEvent({ timestamp: now });
        const inputs = [buy, buy, { ...buy, evidenceLevel: 'PROVIDER_INDICATIVE', id: 'fake' },
            canonicalEvent({ signature: signatureFor(2), timestamp: now, quoteMint: USDC, quoteSymbol: 'USDC', solValue: null }),
            canonicalEvent({ signature: signatureFor(3), timestamp: now + 1 })];
        expect(calculatePressure(inputs, now)).toMatchObject({ buySol: 25, sellSol: 0, coverage: { excludedNonSol: 1 } });
    });
    it('never replays expired trades; rejects new entries on capacity instead of clearing dedup', () => {
        const now = Date.now(); const j = createTradeJournal(MINT, { maxEntries: 1, maxAgeMs: 1000 });
        const e = canonicalEvent({ timestamp: now }); j.upsert(e, now);
        expect(j.upsert(canonicalEvent({ signature: signatureFor(2), timestamp: now }), now).accepted).toBe(false);
        expect(j.values(now + 1001)).toEqual([]); expect(j.upsert(e, now + 1001).accepted).toBe(false);
    });
});
