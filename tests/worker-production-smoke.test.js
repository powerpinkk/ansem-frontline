import { describe, expect, it, vi } from 'vitest';
import {
    WORKER_SMOKE_DEFAULTS,
    runCli,
    runWorkerSmoke,
    validateHealthResponse,
    validateRejectedCorsResponse,
} from '../scripts/worker-production-smoke.mjs';

const BUILD = 'ansem-frontline-worker-recovery-v1';
const MINT = WORKER_SMOKE_DEFAULTS.mint;
const NOW = 1_800_000_000_000;
const MARKET = 'market111111111111111111111111111111111111';

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
    stale = false, quoteStale = false, epoch = 7, marketEpoch = epoch, valuationEpoch = epoch, overrides = {} } = {}) {
    const market = canonical ? { tokenMint: MINT, address: MARKET, protocol: 'pumpswap',
        compatibility: 'POOL_STATE_AND_VAULTS_VERIFIED', lifecycle: 'AMM', sourceEpoch: marketEpoch } : null;
    const valuation = canonical ? { tokenMint: MINT, marketIdentity: MARKET, sourceEpoch: valuationEpoch,
        kind: 'PROTOCOL_MARKET_CAP', protocolDefinition: 'PUMP_PROTOCOL_MARKET_CAP_V1', authorityEligible: !stale && !quoteStale,
        freshness: stale || quoteStale ? 'DEGRADED' : 'FRESH', nativeFreshness: stale ? 'STALE' : 'FRESH',
        quoteFreshness: quoteStale ? 'STALE' : 'FRESH', nativeObservedAt: NOW - 1_000, quoteObservedAt: NOW - 1_000,
        gates: { identity: true, formula: true, supply: true, nativeFresh: !stale, quoteIdentity: true,
            quoteFresh: !quoteStale, slot: true, lifecycle: true, supportedVariant: true, numeric: true },
        unitPrice: { kind: 'PROTOCOL_UNIT_PRICE', evidenceLevel: 'PROTOCOL_CANONICAL',
            authorityEligible: !stale && !quoteStale, sourceEpoch: valuationEpoch,
            observedAt: NOW - 1_000, quoteObservedAt: NOW - 1_000 },
        provenance: { native: { method: 'ATOMIC_ACCOUNT_READ' }, quote: { source: 'PYTH_ONCHAIN_FULL' } } } : null;
    const marketState = capability(canonical && !stale);
    const quote = capability(canonical && !quoteStale);
    const valuationAvailable = capability(canonical && !stale && !quoteStale);
    const currentWindow = { complete, pending: !complete,
        observedSince: complete ? NOW - 61_000 : NOW - 10_000,
        reason: complete ? null : 'OBSERVING_60S_WINDOW' };
    const historicalCoverage = { incomplete: historicalGap, totalGaps: historicalGap ? 1 : 0,
        gaps: historicalGap ? [{ reason: 'OLD_UNPROVEN_GAP', at: NOW - 600_000, sourceEpoch: epoch }] : [] };
    return { version: 4, healthSchemaVersion: 1, buildId: BUILD, tokenMint: MINT,
        status: canonical ? 'observed' : 'degraded', sourceEpoch: canonical ? epoch : 0,
        canonicalMarket: market, canonicalValuation: valuation, trades: [],
        integrity: { canonicalMarket: market, sourceEpoch: canonical ? epoch : 0,
            coverage: { verifiedExecutions: 0 }, health: { schemaVersion: 1,
                discoveryAvailable: capability(canonical), marketStateAvailable: marketState,
                quoteUsdAvailable: quote, valuationAvailable,
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

async function smoke(options = {}) {
    const fixture = transport(options);
    const report = await runWorkerSmoke({ live: true, expectedBuildId: BUILD,
        fetchImpl: fixture.fetchImpl, now: () => NOW });
    return { report, ...fixture };
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

    it('never promotes stale canonical valuation', async () => {
        const { report } = await smoke({ recent: recentBody({ stale: true }) });
        expect(report.contractOk).toBe(true);
        expect(report.canonicalAcquisitionProven).toBe(false);
        expect(report.promotionEligible).toBe(false);
        expect(report.promotionReason).toContain('CANONICAL_STATE_STALE');
    });

    it('never promotes a stale quote while preserving the canonical state distinction', async () => {
        const { report } = await smoke({ recent: recentBody({ quoteStale: true }) });
        expect(report.contractOk).toBe(true);
        expect(report.canonicalAcquisitionProven).toBe(true);
        expect(report.promotionEligible).toBe(false);
        expect(report.promotionReason).toContain('CANONICAL_QUOTE_UNAVAILABLE_OR_STALE');
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

    it('keeps a zero-swap pending window explicit and ineligible', async () => {
        const { report } = await smoke({ recent: recentBody({ complete: false }) });
        expect(report).toMatchObject({ contractOk: true, canonicalAcquisitionProven: true,
            promotionEligible: false, acquisition: { coverage: { currentWindow: { state: 'PENDING' } } } });
        expect(report.promotionReason).toContain('OBSERVING_60S_WINDOW');
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
