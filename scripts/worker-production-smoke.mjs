/* global console, process, setTimeout, clearTimeout, AbortController */
import { pathToFileURL } from 'node:url';

export const WORKER_SMOKE_CONTRACT = Object.freeze({
    service: 'ansem-frontline-stream',
    envelopeVersion: 4,
    healthSchemaVersion: 1,
    perRequestTimeoutMs: 60_000,
    globalBudgetMs: 150_000,
});

export const WORKER_SMOKE_DEFAULTS = Object.freeze({
    origin: 'https://ansem-frontline-stream.ansem-frontline.workers.dev',
    mint: '9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump',
    healthOrigin: 'https://ansem-frontline.vercel.app',
    recentOrigin: 'https://powerpinkk.github.io',
});

const MARKET_ERROR_CODES = new Set([
    'PROVIDER_RATE_LIMITED',
    'PROVIDER_UPSTREAM_5XX',
    'PROVIDER_RPC_FAILURE',
    'PROVIDER_MALFORMED_RESPONSE',
    'MARKET_FALLBACK_UNAVAILABLE',
]);

class SmokeContractError extends Error {
    constructor(code) {
        super(code);
        this.name = 'SmokeContractError';
        this.code = code;
    }
}

class SmokeRequestError extends Error {
    constructor(code) {
        super(code);
        this.name = 'SmokeRequestError';
        this.code = code;
    }
}

function requireContract(condition, code) {
    if (!condition) throw new SmokeContractError(code);
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function positiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
}

function safeTime(value) {
    return value === null || Number.isSafeInteger(value);
}

function cors(response, expectedOrigin) {
    requireContract(response.headers.get('access-control-allow-origin') === expectedOrigin, 'CORS_ORIGIN_MISMATCH');
}

export function validateRejectedCorsResponse(response) {
    requireContract(response?.status === 403, 'REJECTED_ORIGIN_STATUS_MISMATCH');
    requireContract(!response.headers.get('access-control-allow-origin'), 'REJECTED_ORIGIN_EXPOSED');
    return { contractOk: true, status: response.status };
}

function parseRetryAfter(value, sampledAt) {
    if (value === null) return null;
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
        const seconds = Number(trimmed);
        requireContract(Number.isSafeInteger(seconds), 'MARKET_RETRY_AFTER_INVALID');
        return { seconds, retryAt: sampledAt + seconds * 1_000 };
    }
    const retryAt = Date.parse(trimmed);
    requireContract(Number.isFinite(retryAt), 'MARKET_RETRY_AFTER_INVALID');
    return { seconds: Math.max(0, Math.ceil((retryAt - sampledAt) / 1_000)), retryAt };
}

export function validateHealthResponse(sample, { expectedBuildId, expectedOrigin }) {
    const { response, body } = sample;
    requireContract(response.status === 200, 'HEALTH_HTTP_STATUS');
    requireContract(isObject(body), 'HEALTH_BODY_INVALID');
    requireContract(body.ok === true && body.service === WORKER_SMOKE_CONTRACT.service, 'HEALTH_SERVICE_INVALID');
    requireContract(body.buildId === expectedBuildId, 'HEALTH_BUILD_ID_MISMATCH');
    requireContract(body.envelopeVersion === WORKER_SMOKE_CONTRACT.envelopeVersion, 'HEALTH_ENVELOPE_VERSION_MISMATCH');
    requireContract(body.healthSchemaVersion === WORKER_SMOKE_CONTRACT.healthSchemaVersion, 'HEALTH_SCHEMA_VERSION_MISMATCH');
    requireContract(response.headers.get('cache-control') === 'no-store', 'HEALTH_CACHE_POLICY_INVALID');
    cors(response, expectedOrigin);
    return {
        contractOk: true,
        status: response.status,
        service: body.service,
        buildId: body.buildId,
        envelopeVersion: body.envelopeVersion,
        healthSchemaVersion: body.healthSchemaVersion,
    };
}

export function validateMarketResponse(sample, { mint, expectedOrigin, sampledAt }) {
    const { response, body } = sample;
    cors(response, expectedOrigin);
    requireContract(isObject(body), 'MARKET_BODY_INVALID');
    if (response.status === 200) {
        requireContract(body.token?.identity?.mint === mint, 'MARKET_MINT_MISMATCH');
        requireContract(typeof body.source === 'string' && body.source.length > 0, 'MARKET_SOURCE_MISSING');
        requireContract(body.valuation?.tokenMint === mint, 'MARKET_VALUATION_MINT_MISMATCH');
        requireContract(body.valuation?.evidenceLevel === 'PROVIDER_INDICATIVE', 'MARKET_PROVENANCE_INVALID');
        requireContract(body.valuation?.authorityEligible === false, 'MARKET_INDICATIVE_AUTHORITY_INVALID');
        return {
            contractOk: true,
            outcome: 'INDICATIVE_AVAILABLE',
            status: response.status,
            source: body.source,
            tokenMint: mint,
            valuation: {
                kind: body.valuation.kind,
                freshness: body.valuation.freshness,
                evidenceLevel: body.valuation.evidenceLevel,
                authorityEligible: false,
                observedAt: body.valuation.observedAt ?? null,
                receivedAt: body.valuation.receivedAt ?? null,
            },
        };
    }
    if (response.status === 503) {
        requireContract(body.status === 'degraded' && isObject(body.error), 'MARKET_TYPED_ERROR_INVALID');
        requireContract(MARKET_ERROR_CODES.has(body.error.code), 'MARKET_ERROR_CODE_INVALID');
        requireContract(typeof body.error.retryable === 'boolean', 'MARKET_RETRYABLE_INVALID');
        requireContract(safeTime(body.error.retryAt), 'MARKET_RETRY_AT_INVALID');
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'), sampledAt);
        if (body.error.retryAt !== null && body.error.retryAt !== undefined) {
            requireContract(retryAfter !== null, 'MARKET_RETRY_AFTER_MISSING');
        }
        if (retryAfter) {
            const exposed = response.headers.get('access-control-expose-headers') || '';
            requireContract(exposed.split(',').some((name) => name.trim().toLowerCase() === 'retry-after'),
                'MARKET_RETRY_AFTER_NOT_EXPOSED');
        }
        requireContract(response.headers.get('cache-control') === 'no-store', 'MARKET_ERROR_CACHE_POLICY_INVALID');
        return {
            contractOk: true,
            outcome: 'TYPED_PROVIDER_UNAVAILABLE',
            status: response.status,
            error: {
                code: body.error.code,
                retryable: body.error.retryable,
                retryAt: body.error.retryAt ?? null,
                retryAfter,
            },
        };
    }
    if (response.status === 422) {
        requireContract(body.error?.code === 'NO_SAFE_FALLBACK_POOLS', 'MARKET_UNSUPPORTED_ERROR_INVALID');
        requireContract(!body.valuation?.authorityEligible, 'MARKET_UNSUPPORTED_AUTHORITY_INVALID');
        if (body.token?.identity?.mint) requireContract(body.token.identity.mint === mint, 'MARKET_MINT_MISMATCH');
        requireContract(response.headers.get('cache-control') === 'no-store', 'MARKET_ERROR_CACHE_POLICY_INVALID');
        return { contractOk: true, outcome: 'NO_SAFE_FALLBACK_POOLS', status: response.status,
            error: { code: body.error.code } };
    }
    throw new SmokeContractError('MARKET_HTTP_STATUS');
}

function capabilitySummary(health, name) {
    const value = health[name];
    requireContract(isObject(value) && typeof value.available === 'boolean', `RECENT_${name.toUpperCase()}_INVALID`);
    return {
        available: value.available,
        status: value.status ?? null,
        reason: value.reason ?? null,
        lastAttemptAt: value.lastAttemptAt ?? null,
        lastSuccessAt: value.lastSuccessAt ?? null,
        lastFailureAt: value.lastFailureAt ?? null,
        nextRetryAt: value.nextRetryAt ?? null,
    };
}

export function validateRecentResponse(sample, { mint, expectedBuildId, expectedOrigin }) {
    const { response, body } = sample;
    requireContract(response.status === 200, 'RECENT_HTTP_STATUS');
    requireContract(response.headers.get('cache-control') === 'no-store', 'RECENT_CACHE_POLICY_INVALID');
    cors(response, expectedOrigin);
    requireContract(isObject(body), 'RECENT_BODY_INVALID');
    requireContract(body.version === WORKER_SMOKE_CONTRACT.envelopeVersion, 'RECENT_ENVELOPE_VERSION_MISMATCH');
    requireContract(body.healthSchemaVersion === WORKER_SMOKE_CONTRACT.healthSchemaVersion, 'RECENT_HEALTH_SCHEMA_VERSION_MISMATCH');
    requireContract(body.buildId === expectedBuildId, 'RECENT_BUILD_ID_MISMATCH');
    requireContract(body.tokenMint === mint, 'RECENT_MINT_MISMATCH');
    requireContract(Array.isArray(body.trades), 'RECENT_TRADES_INVALID');
    requireContract(isObject(body.integrity) && isObject(body.integrity.health), 'RECENT_INTEGRITY_INVALID');
    const health = body.integrity.health;
    requireContract(health.schemaVersion === WORKER_SMOKE_CONTRACT.healthSchemaVersion, 'RECENT_HEALTH_SCHEMA_VERSION_MISMATCH');
    requireContract(isObject(health.currentWindow) && typeof health.currentWindow.complete === 'boolean', 'RECENT_CURRENT_WINDOW_INVALID');
    requireContract(isObject(health.historicalCoverage) && typeof health.historicalCoverage.incomplete === 'boolean', 'RECENT_HISTORY_COVERAGE_INVALID');
    if (health.currentWindow.complete) requireContract(health.currentWindow.pending === false, 'RECENT_CURRENT_WINDOW_CONFLICT');

    const capabilities = {
        discoveryAvailable: capabilitySummary(health, 'discoveryAvailable'),
        marketStateAvailable: capabilitySummary(health, 'marketStateAvailable'),
        quoteUsdAvailable: capabilitySummary(health, 'quoteUsdAvailable'),
        valuationAvailable: capabilitySummary(health, 'valuationAvailable'),
        executionStreamAvailable: capabilitySummary(health, 'executionStreamAvailable'),
        terrainAuthorityAvailable: capabilitySummary(health, 'terrainAuthorityAvailable'),
    };
    const market = body.canonicalMarket;
    const valuation = body.canonicalValuation;
    const epoch = body.sourceEpoch;
    let canonicalIdentityCoherent = false;
    if (market !== null && market !== undefined) {
        requireContract(isObject(market) && market.tokenMint === mint, 'RECENT_CANONICAL_MINT_MISMATCH');
        requireContract(typeof market.address === 'string' && market.address.length > 0, 'RECENT_CANONICAL_ADDRESS_INVALID');
        requireContract(positiveInteger(epoch) && market.sourceEpoch === epoch, 'RECENT_CANONICAL_EPOCH_MISMATCH');
        if (body.integrity.canonicalMarket) {
            requireContract(body.integrity.canonicalMarket.address === market.address, 'RECENT_INTEGRITY_MARKET_MISMATCH');
            requireContract(body.integrity.sourceEpoch === epoch, 'RECENT_INTEGRITY_EPOCH_MISMATCH');
        }
        canonicalIdentityCoherent = true;
    } else {
        requireContract(valuation === null || valuation === undefined, 'RECENT_VALUATION_WITHOUT_MARKET');
    }

    let valuationCoherent = false;
    if (valuation !== null && valuation !== undefined) {
        requireContract(canonicalIdentityCoherent, 'RECENT_VALUATION_WITHOUT_MARKET');
        requireContract(valuation.tokenMint === mint && valuation.marketIdentity === market.address,
            'RECENT_VALUATION_IDENTITY_MISMATCH');
        requireContract(valuation.sourceEpoch === epoch, 'RECENT_VALUATION_EPOCH_MISMATCH');
        requireContract(valuation.kind === 'PROTOCOL_MARKET_CAP', 'RECENT_VALUATION_KIND_INVALID');
        requireContract(typeof valuation.authorityEligible === 'boolean', 'RECENT_VALUATION_AUTHORITY_INVALID');
        valuationCoherent = true;
    }

    const requiredValuationGates = ['identity', 'formula', 'supply', 'nativeFresh', 'quoteIdentity',
        'quoteFresh', 'slot', 'lifecycle', 'supportedVariant', 'numeric'];
    const valuationProofComplete = valuationCoherent
        && valuation.protocolDefinition === 'PUMP_PROTOCOL_MARKET_CAP_V1'
        && requiredValuationGates.every((gate) => valuation.gates?.[gate] === true)
        && valuation.unitPrice?.kind === 'PROTOCOL_UNIT_PRICE'
        && valuation.unitPrice?.evidenceLevel === 'PROTOCOL_CANONICAL'
        && valuation.unitPrice?.authorityEligible === true
        && valuation.unitPrice?.sourceEpoch === epoch;
    const canonicalAcquisitionProven = canonicalIdentityCoherent
        && capabilities.marketStateAvailable.available === true;
    const valuationEligible = valuationProofComplete
        && valuation.authorityEligible === true
        && valuation.freshness === 'FRESH'
        && valuation.nativeFreshness === 'FRESH'
        && valuation.quoteFreshness === 'FRESH'
        && capabilities.quoteUsdAvailable.available === true
        && capabilities.valuationAvailable.available === true;
    const currentWindowComplete = health.currentWindow.complete === true;
    const reasons = [];
    if (!canonicalIdentityCoherent) reasons.push('CANONICAL_MARKET_NOT_PROVEN');
    else if (!capabilities.marketStateAvailable.available) reasons.push('CANONICAL_STATE_UNAVAILABLE');
    if (!valuationCoherent) reasons.push('CANONICAL_VALUATION_NOT_PROVEN');
    else {
        if (!valuationProofComplete) reasons.push('CANONICAL_VALUATION_PROOF_INCOMPLETE');
        if (!valuation.authorityEligible) reasons.push('CANONICAL_VALUATION_INELIGIBLE');
        if (valuation.freshness !== 'FRESH' || valuation.nativeFreshness !== 'FRESH') reasons.push('CANONICAL_STATE_STALE');
        if (valuation.quoteFreshness !== 'FRESH' || !capabilities.quoteUsdAvailable.available) reasons.push('CANONICAL_QUOTE_UNAVAILABLE_OR_STALE');
        if (!capabilities.valuationAvailable.available) reasons.push('VALUATION_CAPABILITY_UNAVAILABLE');
    }
    if (!currentWindowComplete) reasons.push(health.currentWindow.reason || 'CURRENT_WINDOW_INCOMPLETE');

    const verifiedExecutions = Number.isSafeInteger(body.integrity.coverage?.verifiedExecutions)
        ? body.integrity.coverage.verifiedExecutions : body.trades.length;
    const windowState = currentWindowComplete
        ? verifiedExecutions === 0 ? 'QUIET' : 'ACTIVE'
        : health.currentWindow.reason?.includes('GAP') ? 'GAPPED'
            : health.currentWindow.pending ? 'PENDING' : 'UNKNOWN';
    return {
        contractOk: true,
        status: response.status,
        canonicalAcquisitionProven,
        valuationEligible,
        promotionEligible: canonicalAcquisitionProven && valuationEligible && currentWindowComplete,
        promotionReasons: reasons,
        sourceEpoch: positiveInteger(epoch) ? epoch : null,
        canonicalMarket: canonicalIdentityCoherent ? {
            address: market.address,
            protocol: market.protocol ?? null,
            compatibility: market.compatibility ?? null,
            lifecycle: market.lifecycle ?? null,
            sourceEpoch: epoch,
        } : null,
        canonicalValuation: valuationCoherent ? {
            kind: valuation.kind,
            evidenceLevel: valuation.evidenceLevel ?? null,
            authorityEligible: valuation.authorityEligible,
            freshness: valuation.freshness ?? null,
            nativeFreshness: valuation.nativeFreshness ?? null,
            quoteFreshness: valuation.quoteFreshness ?? null,
            nativeObservedAt: valuation.nativeObservedAt ?? null,
            quoteObservedAt: valuation.quoteObservedAt ?? null,
            sourceEpoch: valuation.sourceEpoch,
            protocolDefinition: valuation.protocolDefinition ?? null,
            gates: valuation.gates ?? null,
            unitPrice: valuation.unitPrice ? {
                kind: valuation.unitPrice.kind,
                evidenceLevel: valuation.unitPrice.evidenceLevel,
                authorityEligible: valuation.unitPrice.authorityEligible,
                observedAt: valuation.unitPrice.observedAt ?? null,
                quoteObservedAt: valuation.unitPrice.quoteObservedAt ?? null,
            } : null,
            provenance: valuation.provenance ? {
                nativeFormula: valuation.provenance.native?.formula ?? null,
                nativeTransport: valuation.provenance.native?.transport ?? null,
                nativeObservation: valuation.provenance.native?.observation ?? null,
                quoteSource: valuation.provenance.quote?.source ?? null,
                quoteFeedId: valuation.provenance.quote?.feedId ?? null,
                quoteOwner: valuation.provenance.quote?.owner ?? null,
                quoteTransport: valuation.provenance.quote?.transport ?? null,
                unitPriceFormula: valuation.unitPrice?.provenance?.formula ?? null,
            } : null,
        } : null,
        capabilities,
        coverage: {
            currentWindow: { ...health.currentWindow, state: windowState, verifiedExecutions },
            historical: {
                incomplete: health.historicalCoverage.incomplete,
                totalGaps: health.historicalCoverage.totalGaps ?? null,
                gaps: Array.isArray(health.historicalCoverage.gaps)
                    ? health.historicalCoverage.gaps.map((gap) => ({ reason: gap?.reason ?? null,
                        at: gap?.at ?? null, sourceEpoch: gap?.sourceEpoch ?? null })) : [],
            },
        },
    };
}

function failureCode(error) {
    if (error instanceof SmokeContractError || error instanceof SmokeRequestError) return error.code;
    if (error?.name === 'AbortError') return 'REQUEST_TIMEOUT';
    return 'REQUEST_FAILED';
}

function makeRequestExecutor({ fetchImpl, now, setTimeoutImpl, clearTimeoutImpl, perRequestTimeoutMs, globalDeadline }) {
    const calls = [];
    return {
        calls,
        async json(url, init, label) {
            const remaining = globalDeadline - now();
            if (remaining <= 0) throw new SmokeRequestError('GLOBAL_BUDGET_EXHAUSTED');
            const timeoutMs = Math.min(perRequestTimeoutMs, remaining);
            const controller = new AbortController();
            const startedAt = now();
            calls.push({ label, method: init.method || 'GET', startedAt, timeoutMs, status: null });
            const entry = calls.at(-1);
            let timer;
            const timedOut = new Promise((_, reject) => {
                timer = setTimeoutImpl(() => {
                    controller.abort();
                    reject(new SmokeRequestError('REQUEST_TIMEOUT'));
                }, timeoutMs);
            });
            try {
                const operation = (async () => {
                    const response = await fetchImpl(url, { ...init, signal: controller.signal });
                    entry.status = response.status;
                    const text = await response.text();
                    let body;
                    try { body = JSON.parse(text); } catch { throw new SmokeRequestError('RESPONSE_JSON_INVALID'); }
                    return { response, body };
                })();
                return await Promise.race([operation, timedOut]);
            } finally {
                clearTimeoutImpl(timer);
                entry.finishedAt = now();
            }
        },
    };
}

function failedResult(error) {
    return { contractOk: false, error: failureCode(error) };
}

export async function runWorkerSmoke({
    live = false,
    expectedBuildId,
    origin = WORKER_SMOKE_DEFAULTS.origin,
    mint = WORKER_SMOKE_DEFAULTS.mint,
    fetchImpl = globalThis.fetch,
    now = Date.now,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
    perRequestTimeoutMs = WORKER_SMOKE_CONTRACT.perRequestTimeoutMs,
    globalBudgetMs = WORKER_SMOKE_CONTRACT.globalBudgetMs,
} = {}) {
    if (!live) return {
        mode: 'offline', networkTraffic: false, contractOk: false,
        canonicalAcquisitionProven: false, promotionEligible: false,
        promotionReason: 'LIVE_MODE_NOT_SELECTED', calls: { total: 0, byEndpoint: {} },
    };
    if (typeof expectedBuildId !== 'string' || !expectedBuildId.trim()) {
        throw new SmokeContractError('EXPECTED_BUILD_ID_REQUIRED');
    }
    requireContract(typeof fetchImpl === 'function', 'FETCH_TRANSPORT_REQUIRED');
    requireContract(Number.isFinite(perRequestTimeoutMs) && perRequestTimeoutMs > 0
        && perRequestTimeoutMs <= WORKER_SMOKE_CONTRACT.perRequestTimeoutMs, 'REQUEST_TIMEOUT_BUDGET_INVALID');
    requireContract(Number.isFinite(globalBudgetMs) && globalBudgetMs > 0
        && globalBudgetMs <= WORKER_SMOKE_CONTRACT.globalBudgetMs, 'GLOBAL_BUDGET_INVALID');
    const normalizedOrigin = origin.replace(/\/$/, '');
    const startedAt = now();
    const request = makeRequestExecutor({ fetchImpl, now, setTimeoutImpl, clearTimeoutImpl,
        perRequestTimeoutMs, globalDeadline: startedAt + globalBudgetMs });
    const samples = {};
    try {
        samples.health = await request.json(`${normalizedOrigin}/health`, {
            headers: { Origin: WORKER_SMOKE_DEFAULTS.healthOrigin },
        }, 'health');
    } catch (error) { samples.healthError = error; }
    try {
        samples.market = await request.json(`${normalizedOrigin}/market?mint=${encodeURIComponent(mint)}`, {
            headers: { Origin: WORKER_SMOKE_DEFAULTS.healthOrigin },
        }, 'market');
    } catch (error) { samples.marketError = error; }
    try {
        samples.recent = await request.json(`${normalizedOrigin}/recent`, {
            method: 'POST',
            headers: { Origin: WORKER_SMOKE_DEFAULTS.recentOrigin, 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'configure', token: { mint, chain: 'solana' } }),
        }, 'recent');
    } catch (error) { samples.recentError = error; }

    let health;
    try {
        if (samples.healthError) throw samples.healthError;
        health = validateHealthResponse(samples.health, { expectedBuildId,
            expectedOrigin: WORKER_SMOKE_DEFAULTS.healthOrigin });
    } catch (error) { health = failedResult(error); }
    let market;
    try {
        if (samples.marketError) throw samples.marketError;
        market = validateMarketResponse(samples.market, { mint,
            expectedOrigin: WORKER_SMOKE_DEFAULTS.healthOrigin, sampledAt: startedAt });
    } catch (error) { market = failedResult(error); }
    let recent;
    try {
        if (samples.recentError) throw samples.recentError;
        recent = validateRecentResponse(samples.recent, { mint, expectedBuildId,
            expectedOrigin: WORKER_SMOKE_DEFAULTS.recentOrigin });
    } catch (error) { recent = failedResult(error); }

    const contractOk = health.contractOk === true && market.contractOk === true && recent.contractOk === true;
    const canonicalAcquisitionProven = contractOk && recent.canonicalAcquisitionProven === true;
    const promotionEligible = canonicalAcquisitionProven && recent.promotionEligible === true;
    const promotionReasons = [];
    if (!health.contractOk) promotionReasons.push(health.error);
    if (!market.contractOk) promotionReasons.push(market.error);
    if (!recent.contractOk) promotionReasons.push(recent.error);
    if (recent.contractOk) promotionReasons.push(...recent.promotionReasons);
    const byEndpoint = Object.fromEntries(['health', 'market', 'recent'].map((label) => [label,
        request.calls.filter((call) => call.label === label).length]));
    return {
        mode: 'live',
        sampledAt: new Date(startedAt).toISOString(),
        mint,
        expectedBuildId,
        contract: { service: WORKER_SMOKE_CONTRACT.service,
            envelopeVersion: WORKER_SMOKE_CONTRACT.envelopeVersion,
            healthSchemaVersion: WORKER_SMOKE_CONTRACT.healthSchemaVersion },
        budgets: { perRequestTimeoutMs, globalBudgetMs, retries: 0, websocket: 'disabled' },
        result: contractOk ? promotionEligible ? 'PROMOTION_ELIGIBLE' : 'INCONCLUSIVE' : 'CONTRACT_FAILED',
        contractOk,
        canonicalAcquisitionProven,
        promotionEligible,
        promotionReason: promotionEligible ? null : [...new Set(promotionReasons.filter(Boolean))].join(',') || 'NOT_PROVEN',
        calls: { total: request.calls.length, byEndpoint,
            attempts: request.calls.map(({ label, method, status, timeoutMs }) => ({ label, method, status, timeoutMs })) },
        acquisition: recent.contractOk ? {
            canonicalAcquisitionProven: recent.canonicalAcquisitionProven,
            sourceEpoch: recent.sourceEpoch,
            canonicalMarket: recent.canonicalMarket,
            canonicalValuation: recent.canonicalValuation,
            capabilities: recent.capabilities,
            coverage: recent.coverage,
        } : null,
        provenance: { health, indicativeMarket: market },
        websocket: { enabled: false, attempted: false, recoveryProven: false },
    };
}

export function parseCliArguments(argv) {
    const options = { live: false };
    for (let index = 0; index < argv.length; index += 1) {
        const value = argv[index];
        if (value === '--live') options.live = true;
        else if (value === '--expected-build-id') options.expectedBuildId = argv[++index];
        else if (value.startsWith('--expected-build-id=')) options.expectedBuildId = value.slice(value.indexOf('=') + 1);
        else if (value === '--origin') options.origin = argv[++index];
        else if (value.startsWith('--origin=')) options.origin = value.slice(value.indexOf('=') + 1);
        else throw new SmokeContractError('CLI_ARGUMENT_INVALID');
    }
    return options;
}

export async function runCli(argv = process.argv.slice(2), dependencies = {}) {
    return runWorkerSmoke({ ...parseCliArguments(argv), ...dependencies });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    try {
        const report = await runCli();
        console.log(JSON.stringify(report));
        if (report.mode === 'live' && !report.promotionEligible) process.exitCode = 1;
    } catch (error) {
        console.error(JSON.stringify({ mode: 'live', contractOk: false, canonicalAcquisitionProven: false,
            promotionEligible: false, error: failureCode(error), calls: { total: 0 } }));
        process.exitCode = 1;
    }
}
