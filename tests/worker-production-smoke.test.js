import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { CANONICAL_VALUATION_POLICY, canonicalValuation } from '../js/canonical-valuation.js';
import { CONFIG } from '../js/config.js';
import {
    WORKER_SMOKE_DEFAULTS,
    runCli,
    runWorkerSmoke,
    validateHealthResponse,
    validateRejectedCorsResponse,
} from '../scripts/worker-production-smoke.mjs';

const BUILD = 'ansem-frontline-worker-recovery-v1';
const MINT = WORKER_SMOKE_DEFAULTS.mint;
const VALUATION_FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/public-chain/pump-valuation-states.json', import.meta.url)))
    .find((sample) => sample.mint === MINT).result;
const NOW = VALUATION_FIXTURE.receivedAt;
const MARKET = VALUATION_FIXTURE.canonicalMarket.address;

function headers(origin, extra = {}) {
    return { 'access-control-allow-origin': origin, 'cache-control': 'no-store', ...extra };
}

function capability(available = true, extra = {}) {
    return { available, status: available ? 'HEALTHY' : 'RETRY_WAIT', reason: available ? null : 'UNAVAILABLE',
        lastAttemptAt: NOW - 1_000, lastSuccessAt: available ? NOW - 1_000 : null,
        lastFailureAt: available ? null : NOW - 1_000, nextRetryAt: null, ...extra };
}

function healthBody(overrides = {}) {
    return { ok: true, service: 'ansem-frontline-stream', buildId: BUILD,
        envelopeVersion: 4, healthSchemaVersion: 1, ...overrides };
}

function marketBody() {
    return { status: 'RESOLVED', source: 'helius-fallback',
        token: { identity: { mint: MINT } },
        valuation: { tokenMint: MINT, kind: 'FDV', freshness: 'DEGRADED',
            evidenceLevel: 'PROVIDER_INDICATIVE', authorityEligible: false,
            observedAt: null, receivedAt: NOW } };
}

function recentBody({ complete = true, historicalGap = false, canonical = true,
    stale = false, quoteStale = false, epoch = 7, marketEpoch = epoch, valuationEpoch = epoch,
    nativeObservedAt = null, quoteObservedAt = null, trades = [], retainedExecutions = trades.length,
    windowReason = 'OBSERVING_60S_WINDOW', overrides = {} } = {}) {
    const market = canonical ? { ...structuredClone(VALUATION_FIXTURE.canonicalMarket), sourceEpoch: marketEpoch } : null;
    const native = canonical ? { ...structuredClone(VALUATION_FIXTURE.nativeValuation), sourceEpoch: valuationEpoch,
        tokenDecimals: 6, baseReserve: VALUATION_FIXTURE.nativeValuation.provenance.state.baseReserve,
        observedAt: nativeObservedAt ?? (stale ? NOW - CANONICAL_VALUATION_POLICY.nativeTtlMs - 1
            : VALUATION_FIXTURE.nativeValuation.observedAt) } : null;
    const quoteObservation = canonical ? { ...structuredClone(VALUATION_FIXTURE.quoteUsd),
        observedAt: quoteObservedAt ?? (quoteStale ? NOW - CANONICAL_VALUATION_POLICY.quoteTtlMs - 1
            : VALUATION_FIXTURE.quoteUsd.observedAt) } : null;
    const valuation = canonical ? canonicalValuation(native, quoteObservation, market, null, NOW) : null;
    if (valuation) valuation.sourceEpoch = valuationEpoch;
    const marketState = capability(canonical && !stale);
    const quoteCapability = capability(canonical && !quoteStale);
    const valuationAvailable = capability(canonical && !stale && !quoteStale);
    const currentWindow = { complete, pending: !complete,
        observedSince: complete ? NOW - 61_000 : NOW - 10_000,
        reason: complete ? null : windowReason };
    const historicalCoverage = { incomplete: historicalGap, totalGaps: historicalGap ? 1 : 0,
        gaps: historicalGap ? [{ reason: 'OLD_UNPROVEN_GAP', at: NOW - 600_000, sourceEpoch: epoch }] : [] };
    return { version: 4, healthSchemaVersion: 1, buildId: BUILD, tokenMint: MINT,
        status: canonical ? 'observed' : 'degraded', sourceEpoch: canonical ? epoch : 0,
        canonicalMarket: market, canonicalValuation: valuation, trades,
        integrity: { canonicalMarket: market, sourceEpoch: canonical ? epoch : 0,
            coverage: { verifiedExecutions: retainedExecutions,
                scope: 'RETAINED_CANONICAL_MARKET_MAX_5_MINUTES' }, health: { schemaVersion: 1,
                discoveryAvailable: capability(canonical), marketStateAvailable: marketState,
                quoteUsdAvailable: quoteCapability, valuationAvailable,
                executionStreamAvailable: capability(complete), terrainAuthorityAvailable: valuationAvailable,
                currentWindow, historicalCoverage } }, ...overrides };
}

function jsonResponse(body, status, origin, extraHeaders = {}) {
    return Response.json(body, { status, headers: headers(origin, extraHeaders) });
}

function transport({ health = healthBody(), market = marketBody(), recent = recentBody(), marketStatus = 200,
    marketHeaders = {} } = {}) {
    const calls = [];
    const fetchImpl = vi.fn(async (input, init = {}) => {
        const url = new URL(input);
        calls.push({ path: url.pathname, method: init.method || 'GET', origin: init.headers.Origin, signal: init.signal });
        if (url.pathname === '/health') {
            return jsonResponse(health, 200, WORKER_SMOKE_DEFAULTS.healthOrigin);
        }
        if (url.pathname === '/market') {
            return jsonResponse(market, marketStatus, WORKER_SMOKE_DEFAULTS.healthOrigin, marketHeaders);
        }
        if (url.pathname === '/recent') {
            return jsonResponse(recent, 200, WORKER_SMOKE_DEFAULTS.recentOrigin);
        }
        throw new Error('Unexpected path');
    });
    return { fetchImpl, calls };
}

async function smoke(options = {}, evaluatedAt = NOW) {
    const fixture = transport(options);
    const report = await runWorkerSmoke({ live: true, expectedBuildId: BUILD,
        fetchImpl: fixture.fetchImpl, now: () => evaluatedAt });
    return { report, ...fixture };
}

function trade({ timestamp = NOW - 1_000, settlement = 'FINALIZED', sourceEpoch = 7,
    signature = '1'.repeat(88), outerIndex = 0 } = {}) {
    const invocationPath = `${outerIndex}.outer`;
    return { tokenMint: MINT, signature, poolAddress: MARKET, marketIdentity: MARKET,
        sourceEpoch, id: `${MINT}:${signature}:${MARKET}:${invocationPath}:pool-v1`,
        executionOrder: { outerIndex, innerIndex: null }, invocationPath,
        slot: VALUATION_FIXTURE.nativeValuation.slot, isBuy: true,
        rawTokenAmount: '100', rawQuoteAmount: '200', settlement,
        evidenceLevel: 'CHAIN_VERIFIED', verificationVersion: 'pool-execution-v1',
        economicScope: 'CANONICAL_POOL_EXECUTION', timestamp };
}

describe('worker production smoke', () => {
    it('accepts a typed 503 once without retrying or suppressing independently healthy canon', async () => {
        const retryAt = NOW + 120_000;
        const { report, calls } = await smoke({ marketStatus: 503,
            market: { status: 'degraded', error: { code: 'PROVIDER_RATE_LIMITED', retryable: true, retryAt } },
            marketHeaders: { 'retry-after': '120', 'access-control-expose-headers': 'Retry-After' } });
        expect(calls.filter((call) => call.path === '/market')).toHaveLength(1);
        expect(report.calls).toMatchObject({ total: 3, byEndpoint: { health: 1, market: 1, recent: 1 } });
        expect(report.budgets.retries).toBe(0);
        expect(report.provenance.indicativeMarket).toMatchObject({ contractOk: true,
            outcome: 'TYPED_PROVIDER_UNAVAILABLE', error: { code: 'PROVIDER_RATE_LIMITED', retryable: true,
                retryAt, retryAfter: { seconds: 120, retryAt } } });
        expect(report).toMatchObject({ contractOk: true, canonicalAcquisitionProven: true,
            promotionEligible: true, result: 'PROMOTION_ELIGIBLE' });
    });

    it.each([
        ['build ID', { health: healthBody({ buildId: 'wrong-worker' }) }, 'HEALTH_BUILD_ID_MISMATCH'],
        ['envelope', { health: healthBody({ envelopeVersion: 999 }) }, 'HEALTH_ENVELOPE_VERSION_MISMATCH'],
        ['health schema', { health: healthBody({ healthSchemaVersion: 999 }) }, 'HEALTH_SCHEMA_VERSION_MISMATCH'],
        ['recent build ID', { recent: recentBody({ overrides: { buildId: 'wrong-worker' } }) }, 'RECENT_BUILD_ID_MISMATCH'],
    ])('rejects the wrong %s', async (_label, options, error) => {
        const { report } = await smoke(options);
        expect(report).toMatchObject({ contractOk: false, canonicalAcquisitionProven: false,
            promotionEligible: false, result: 'CONTRACT_FAILED' });
        expect(report.promotionReason).toContain(error);
    });

    it('never promotes a response without canonical identity or valuation', async () => {
        const { report } = await smoke({ recent: recentBody({ canonical: false }) });
        expect(report).toMatchObject({ contractOk: true, canonicalAcquisitionProven: false,
            promotionEligible: false, result: 'INCONCLUSIVE' });
        expect(report.promotionReason).toContain('CANONICAL_MARKET_NOT_PROVEN');
        expect(report.promotionReason).toContain('CANONICAL_VALUATION_NOT_PROVEN');
    });

    it('accepts a complete fresh canonical valuation produced by the real constructor', async () => {
        const { report } = await smoke({ recent: recentBody() });
        expect(report).toMatchObject({ contractOk: true, canonicalAcquisitionProven: true,
            promotionEligible: true, acquisition: { canonicalValuation: {
                boundaryAccepted: true, economicValuesValid: true, authorityEligible: true,
                nativeFreshness: 'FRESH', quoteFreshness: 'FRESH' } } });
    });

    it('expires native authority on receipt using the existing 20 second policy', async () => {
        const body = recentBody();
        const evaluatedAt = body.canonicalValuation.nativeObservedAt + CANONICAL_VALUATION_POLICY.nativeTtlMs + 1;
        const { report } = await smoke({ recent: body }, evaluatedAt);
        expect(report.contractOk).toBe(true);
        expect(report.canonicalAcquisitionProven).toBe(false);
        expect(report.promotionEligible).toBe(false);
        expect(report.promotionReason).toContain('CANONICAL_STATE_EXPIRED_ON_RECEIPT');
        expect(report.acquisition.canonicalValuation).toMatchObject({ boundaryAccepted: true,
            authorityEligible: false, nativeFreshness: 'STALE', evaluatedAt,
            nativeTtlMs: CANONICAL_VALUATION_POLICY.nativeTtlMs });
    });

    it('evaluates recent at its receipt time instead of the global smoke start', async () => {
        const fixture = transport({ recent: recentBody() });
        let clock = NOW;
        const receivedAt = VALUATION_FIXTURE.nativeValuation.observedAt
            + CANONICAL_VALUATION_POLICY.nativeTtlMs + 1;
        const fetchImpl = vi.fn(async (input, init) => {
            if (new URL(input).pathname === '/recent') clock = receivedAt;
            return fixture.fetchImpl(input, init);
        });
        const report = await runWorkerSmoke({ live: true, expectedBuildId: BUILD,
            fetchImpl, now: () => clock });
        expect(report.timing).toMatchObject({ startedAt: NOW, recentReceivedAt: receivedAt, evaluatedAt: receivedAt });
        expect(report.canonicalAcquisitionProven).toBe(false);
        expect(report.promotionEligible).toBe(false);
        expect(report.promotionReason).toContain('CANONICAL_STATE_EXPIRED_ON_RECEIPT');
    });

    it('expires the quote while preserving independently fresh native acquisition', async () => {
        const quoteObservedAt = NOW - CANONICAL_VALUATION_POLICY.quoteTtlMs + 10_000;
        const body = recentBody({ quoteObservedAt });
        const evaluatedAt = NOW + 10_001;
        const { report } = await smoke({ recent: body }, evaluatedAt);
        expect(report.contractOk).toBe(true);
        expect(report.canonicalAcquisitionProven).toBe(true);
        expect(report.promotionEligible).toBe(false);
        expect(report.promotionReason).toContain('CANONICAL_QUOTE_EXPIRED_ON_RECEIPT');
        expect(report.acquisition.canonicalValuation).toMatchObject({ authorityEligible: false,
            nativeFreshness: 'FRESH', quoteFreshness: 'STALE', evaluatedAt,
            quoteTtlMs: CANONICAL_VALUATION_POLICY.quoteTtlMs });
    });

    it.each([
        ['missing market cap', (value) => { delete value.valueUsd; }],
        ['missing unit price', (value) => { delete value.unitPriceUsd; }],
        ['missing nested unit price', (value) => { delete value.unitPrice.valueUsd; }],
        ['zero market cap', (value) => { value.valueUsd = '0'; }],
        ['non-finite unit price', (value) => { value.unitPriceUsd = 'NaN'; value.unitPrice.valueUsd = 'NaN'; }],
        ['incoherent unit price', (value) => { value.unitPrice.valueUsd = '999'; }],
    ])('never promotes canonical economic data with %s', async (_label, mutate) => {
        const body = recentBody();
        mutate(body.canonicalValuation);
        const { report } = await smoke({ recent: body });
        expect(report.contractOk).toBe(true);
        expect(report.canonicalAcquisitionProven).toBe(false);
        expect(report.promotionEligible).toBe(false);
        expect(report.promotionReason).toContain('CANONICAL_ECONOMIC_VALUES_INVALID');
    });

    it.each([
        ['future observation timestamp', (value) => { value.nativeObservedAt = NOW + 1; }],
        ['invalid slot', (value) => { value.slot = -1; }],
    ])('rejects canonical valuation with %s', async (_label, mutate) => {
        const body = recentBody();
        mutate(body.canonicalValuation);
        const { report } = await smoke({ recent: body });
        expect(report).toMatchObject({ contractOk: true, canonicalAcquisitionProven: false,
            promotionEligible: false });
        expect(report.promotionReason).toContain('CANONICAL_VALUATION_BOUNDARY_REJECTED');
    });

    it('recognizes the explicit no-safe-pools contract without inventing authority', async () => {
        const { report, calls } = await smoke({ marketStatus: 422,
            market: { status: 'UNSUPPORTED', error: { code: 'NO_SAFE_FALLBACK_POOLS' },
                token: { identity: { mint: MINT } } } });
        expect(calls.filter((call) => call.path === '/market')).toHaveLength(1);
        expect(report.provenance.indicativeMarket).toMatchObject({ contractOk: true,
            outcome: 'NO_SAFE_FALLBACK_POOLS', error: { code: 'NO_SAFE_FALLBACK_POOLS' } });
        expect(report.promotionEligible).toBe(true);
    });

    it.each([
        ['market', { marketEpoch: 8 }],
        ['valuation', { valuationEpoch: 8 }],
    ])('rejects a mismatched %s epoch', async (_label, recentOptions) => {
        const { report } = await smoke({ recent: recentBody(recentOptions) });
        expect(report).toMatchObject({ contractOk: false, canonicalAcquisitionProven: false,
            promotionEligible: false });
        expect(report.promotionReason).toContain('EPOCH_MISMATCH');
    });

    it('classifies a complete zero-swap window as QUIET without letting an old gap poison valuation', async () => {
        const { report } = await smoke({ recent: recentBody({ complete: true, historicalGap: true }) });
        expect(report).toMatchObject({ contractOk: true, canonicalAcquisitionProven: true,
            promotionEligible: true, acquisition: { coverage: {
                currentWindow: { state: 'QUIET', complete: true, verifiedExecutions: 0 },
                historical: { incomplete: true, totalGaps: 1 } } } });
    });

    it('keeps retained five-minute coverage separate from a quiet 60 second window', async () => {
        const old = trade({ timestamp: NOW - 120_000 });
        const { report } = await smoke({ recent: recentBody({ trades: [old], retainedExecutions: 1 }) });
        expect(report).toMatchObject({ promotionEligible: true, acquisition: { coverage: {
            currentWindow: { state: 'QUIET', verifiedExecutions: 0, windowMs: CONFIG.PRESSURE_WINDOW_MS },
            retainedJournal: { verifiedExecutions: 1, scope: 'RETAINED_CANONICAL_MARKET_MAX_5_MINUTES' } } } });
    });

    it('counts one deduplicated active canonical execution inside the 60 second window', async () => {
        const current = trade({ timestamp: NOW - CONFIG.PRESSURE_WINDOW_MS + 1 });
        const { report } = await smoke({ recent: recentBody({ trades: [current, structuredClone(current)],
            retainedExecutions: 1 }) });
        expect(report.acquisition.coverage).toMatchObject({
            currentWindow: { state: 'ACTIVE', verifiedExecutions: 1, temporalEvidenceComplete: true },
            retainedJournal: { verifiedExecutions: 1 } });
        expect(report.promotionEligible).toBe(true);
    });

    it('does not count inactive or wrong-epoch executions as current activity', async () => {
        const inactive = trade({ settlement: 'RECONCILIATION_UNKNOWN', signature: '2'.repeat(88) });
        const foreignEpoch = trade({ sourceEpoch: 8, signature: '3'.repeat(88) });
        const { report } = await smoke({ recent: recentBody({ trades: [inactive, foreignEpoch], retainedExecutions: 2 }) });
        expect(report.acquisition.coverage).toMatchObject({ currentWindow: {
            state: 'QUIET', verifiedExecutions: 0, temporalEvidenceComplete: true },
        retainedJournal: { verifiedExecutions: 2 } });
    });

    it.each([
        ['lacks original time', null],
        ['has a future original time', NOW + 1],
    ])('keeps current activity unknown when an active canonical event %s', async (_label, timestamp) => {
        const uncertain = trade({ timestamp });
        const { report } = await smoke({ recent: recentBody({ trades: [uncertain], retainedExecutions: 1 }) });
        expect(report).toMatchObject({ promotionEligible: false, acquisition: { coverage: { currentWindow: {
            state: 'UNKNOWN', verifiedExecutions: 0, temporalEvidenceComplete: false, temporalIssueCount: 1 } } } });
        expect(report.promotionReason).toContain('CURRENT_WINDOW_TEMPORAL_EVIDENCE_INSUFFICIENT');
    });

    it('keeps a zero-swap pending window explicit and ineligible', async () => {
        const { report } = await smoke({ recent: recentBody({ complete: false }) });
        expect(report).toMatchObject({ contractOk: true, canonicalAcquisitionProven: true,
            promotionEligible: false, acquisition: { coverage: { currentWindow: { state: 'PENDING' } } } });
        expect(report.promotionReason).toContain('OBSERVING_60S_WINDOW');
    });

    it('keeps an incomplete gapped window explicit instead of classifying it quiet', async () => {
        const { report } = await smoke({ recent: recentBody({ complete: false, windowReason: 'CURRENT_WINDOW_GAP' }) });
        expect(report).toMatchObject({ promotionEligible: false,
            acquisition: { coverage: { currentWindow: { state: 'GAPPED', verifiedExecutions: 0 } } } });
        expect(report.promotionReason).toContain('CURRENT_WINDOW_GAP');
    });

    it('uses exactly one call per endpoint and the configured CORS origins', async () => {
        const { report, calls } = await smoke();
        expect(calls.map(({ path, method, origin }) => ({ path, method, origin }))).toEqual([
            { path: '/health', method: 'GET', origin: WORKER_SMOKE_DEFAULTS.healthOrigin },
            { path: '/market', method: 'GET', origin: WORKER_SMOKE_DEFAULTS.healthOrigin },
            { path: '/recent', method: 'POST', origin: WORKER_SMOKE_DEFAULTS.recentOrigin },
        ]);
        expect(report.calls.total).toBe(3);
        expect(report.websocket).toEqual({ enabled: false, attempted: false, recoveryProven: false });
    });

    it('cancels a timed-out request and does not retry it', async () => {
        let healthAborted = false;
        const base = transport();
        const fetchImpl = vi.fn((input, init) => {
            if (new URL(input).pathname !== '/health') return base.fetchImpl(input, init);
            return new Promise((_resolve, reject) => {
                init.signal.addEventListener('abort', () => {
                    healthAborted = true;
                    reject(new DOMException('aborted', 'AbortError'));
                }, { once: true });
            });
        });
        const report = await runWorkerSmoke({ live: true, expectedBuildId: BUILD, fetchImpl,
            perRequestTimeoutMs: 5, globalBudgetMs: 100 });
        expect(healthAborted).toBe(true);
        expect(fetchImpl).toHaveBeenCalledTimes(3);
        expect(report.calls.byEndpoint).toEqual({ health: 1, market: 1, recent: 1 });
        expect(report.promotionReason).toContain('REQUEST_TIMEOUT');
        expect(report.promotionEligible).toBe(false);
    });

    it('applies the same timeout to a stalled response body', async () => {
        let bodySignalAborted = false;
        const base = transport();
        const fetchImpl = vi.fn((input, init) => {
            if (new URL(input).pathname !== '/health') return base.fetchImpl(input, init);
            init.signal.addEventListener('abort', () => { bodySignalAborted = true; }, { once: true });
            return { status: 200, headers: new Headers(headers(WORKER_SMOKE_DEFAULTS.healthOrigin)),
                text: () => new Promise(() => {}) };
        });
        const report = await runWorkerSmoke({ live: true, expectedBuildId: BUILD, fetchImpl,
            perRequestTimeoutMs: 5, globalBudgetMs: 100 });
        expect(bodySignalAborted).toBe(true);
        expect(fetchImpl).toHaveBeenCalledTimes(3);
        expect(report.promotionReason).toContain('REQUEST_TIMEOUT');
    });

    it('imports and runs in default mode without any network access', async () => {
        const fetchImpl = vi.fn(() => { throw new Error('network must not run'); });
        const report = await runCli([], { fetchImpl });
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(report).toEqual(expect.objectContaining({ mode: 'offline', networkTraffic: false,
            promotionEligible: false, promotionReason: 'LIVE_MODE_NOT_SELECTED', calls: { total: 0, byEndpoint: {} } }));
    });

    it('requires the expected build ID before live transport can start', async () => {
        const fetchImpl = vi.fn();
        await expect(runWorkerSmoke({ live: true, fetchImpl })).rejects.toThrow('EXPECTED_BUILD_ID_REQUIRED');
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('keeps both allowed origins and the rejected-origin policy covered offline', () => {
        for (const origin of [WORKER_SMOKE_DEFAULTS.healthOrigin, WORKER_SMOKE_DEFAULTS.recentOrigin]) {
            const result = validateHealthResponse({ response: jsonResponse(healthBody(), 200, origin), body: healthBody() },
                { expectedBuildId: BUILD, expectedOrigin: origin });
            expect(result.contractOk).toBe(true);
        }
        expect(validateRejectedCorsResponse(new Response('Forbidden', { status: 403 })))
            .toEqual({ contractOk: true, status: 403 });
    });
});
