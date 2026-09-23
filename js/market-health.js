const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;

function reasonForIdentityFailure(failure) {
    if (!failure) return null;
    if (failure === 'RPC_HTTP_429') return 'RPC_RATE_LIMITED';
    if (failure.startsWith('RPC_HTTP_5')) return 'RPC_UPSTREAM_5XX';
    if (failure.startsWith('RPC_HTTP_')) return 'RPC_HTTP_FAILURE';
    if (failure.startsWith('RPC_ERROR_')) return 'RPC_RESPONSE_FAILURE';
    if (failure === 'RPC_NOT_CONFIGURED') return 'RPC_NOT_CONFIGURED';
    return 'DISCOVERY_FAILED';
}
export function formatPriceDisplay(value) {
    return positive(value) ? `$${Number(value).toFixed(6)}` : '—';
}

export function deriveMarketHealth(state) {
    const integrity = state?.integrity || null;
    const canonicalValuation = state?.canonicalValuation || null;
    const providerValuation = state?.valuation || null;
    const canonicalMarketAvailable = Boolean(state?.canonicalMarket);
    const priceAvailable = positive(state?.price);
    const providerValuationAvailable = positive(providerValuation?.valueUsd)
        && providerValuation?.kind !== 'UNKNOWN';
    const terrainAuthorityAvailable = canonicalValuation?.authorityEligible === true
        && positive(canonicalValuation.valueUsd);
    const workerConnected = state?.workerConnected === true;
    const executionStreamStatus = state?.executionStreamStatus || 'connecting';
    const executionStreamHealthy = workerConnected
        && executionStreamStatus === 'online'
        && canonicalMarketAvailable
        && !integrity?.identityFailure
        && integrity?.coverageIncomplete !== true
        && !(integrity?.rpcFailures > 0);
    const hasRecentExecutions = Array.isArray(state?.liveTrades) && state.liveTrades.length > 0;
    const degradedReasons = [];
    const addReason = (reason) => {
        if (reason && !degradedReasons.includes(reason)) degradedReasons.push(reason);
    };

    if (!priceAvailable) addReason('PRICE_UNAVAILABLE');
    if (!canonicalMarketAvailable) {
        addReason(reasonForIdentityFailure(integrity?.identityFailure));
        addReason('NO_CANONICAL_MARKET');
    }
    if (!terrainAuthorityAvailable) {
        if (integrity?.valuationFailure) addReason(`VALUATION_${integrity.valuationFailure}`);
        addReason('VALUATION_AUTHORITY_UNAVAILABLE');
    }
    if (!workerConnected) addReason('WORKER_DISCONNECTED');
    if (executionStreamStatus === 'offline') addReason('EXECUTION_STREAM_UNAVAILABLE');
    if (integrity?.coverageIncomplete === true) addReason('EXECUTION_COVERAGE_INCOMPLETE');
    if (integrity?.rpcFailures > 0) addReason('EXECUTION_RPC_FAILURES');

    const flowState = executionStreamHealthy
        ? hasRecentExecutions ? 'ACTIVE' : 'QUIET'
        : workerConnected || integrity ? 'DEGRADED' : 'WAITING';
    return Object.freeze({
        workerConnected,
        executionStreamHealthy,
        discoveryHealthy: canonicalMarketAvailable && !integrity?.identityFailure,
        marketIdentityAvailable: Boolean(state?.marketSelection),
        canonicalMarketAvailable,
        priceAvailable,
        priceState: priceAvailable ? 'INDICATIVE' : 'UNAVAILABLE',
        valuationAvailable: terrainAuthorityAvailable || providerValuationAvailable,
        valuationState: terrainAuthorityAvailable ? 'AUTHORITATIVE'
            : providerValuationAvailable ? 'INDICATIVE' : 'UNAVAILABLE',
        quoteUsdState: canonicalValuation?.quoteFreshness || 'UNAVAILABLE',
        terrainAuthorityAvailable,
        pressureAvailable: executionStreamHealthy,
        flowState,
        lastVerifiedExecutionAt: state?.lastTradeAt || null,
        degradedReasons: Object.freeze(degradedReasons),
    });
}
