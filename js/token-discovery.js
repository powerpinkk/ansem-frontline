import { CONFIG } from './config.js';
import { deriveSolPrice, summarizePoolActivity } from './market.js';
import { selectMarket } from './market-selection.js';
import { providerValuation } from './market-valuation.js';
import {
    TOKEN_DISCOVERY_STATUS,
    createTokenContext,
    validateSolanaMint,
    withTokenResolution,
} from './token-context.js';

export async function discoverToken(input, {
    fetchPairs,
    fetchSolPrice,
    poolLimit = CONFIG.MAX_TRACKED_POOLS,
    trackedPools = [],
    previousSelection = null,
} = {}) {
    const suppliedContext = input?.identity ? input : null;
    const mint = suppliedContext?.identity?.mint ?? input;
    const validation = validateSolanaMint(mint);
    if (!validation.ok) return failure(TOKEN_DISCOVERY_STATUS.INVALID, validation.code, validation.message);
    const context = suppliedContext || createTokenContext({ mint: validation.value });
    if (typeof fetchPairs !== 'function') {
        return failure(TOKEN_DISCOVERY_STATUS.UPSTREAM_FAILURE, 'DISCOVERY_FETCHER_MISSING', 'Token discovery is not configured', context);
    }

    try {
        const payload = await fetchPairs(validation.value);
        const resolution = resolveDexScreenerPayload(context, payload, poolLimit, trackedPools, previousSelection);
        if (!resolution.ok || resolution.market.solPriceUsd > 0 || typeof fetchSolPrice !== 'function') return resolution;
        const solPriceUsd = Number(await fetchSolPrice());
        if (!Number.isFinite(solPriceUsd) || !(solPriceUsd > 0)) throw new Error('SOL/USD price is unavailable');
        return { ...resolution, market: { ...resolution.market, solPriceUsd } };
    } catch (error) {
        const temporary = error?.name === 'AbortError'
            || error?.status === 408
            || error?.status === 429
            || Number(error?.status) >= 500;
        return failure(
            temporary ? TOKEN_DISCOVERY_STATUS.TEMPORARY_ERROR : TOKEN_DISCOVERY_STATUS.UPSTREAM_FAILURE,
            temporary ? 'DISCOVERY_TEMPORARY' : 'DISCOVERY_UPSTREAM',
            temporary ? 'Token discovery is temporarily unavailable' : 'Token discovery upstream failed',
            context,
            error instanceof Error ? error.message : 'Unknown upstream error',
        );
    }
}

export function resolveDexScreenerPayload(context, payload, poolLimit = CONFIG.MAX_TRACKED_POOLS, _existingPools = [], previousSelection = null) {
    const pairs = Array.isArray(payload) ? payload : payload?.pairs;
    if (!Array.isArray(pairs)) {
        return failure(TOKEN_DISCOVERY_STATUS.UPSTREAM_FAILURE, 'DISCOVERY_PAYLOAD', 'Invalid discovery response', context);
    }
    const mint = context.identity.mint;
    const matchingPairs = pairs.filter((pair) => pair?.chainId === 'solana'
        && (pair?.baseToken?.address === mint || pair?.quoteToken?.address === mint));
    if (!matchingPairs.length) {
        return failure(TOKEN_DISCOVERY_STATUS.UNAVAILABLE, 'TOKEN_NOT_FOUND', 'No Solana markets were found for this mint', context);
    }
    const basePairs = matchingPairs.filter((pair) => pair?.baseToken?.address === mint);
    const selected = selectMarket(basePairs, mint, previousSelection, Date.now(), poolLimit);
    if (!selected) {
        return failure(
            TOKEN_DISCOVERY_STATUS.UNSUPPORTED,
            'NO_COMPATIBLE_POOLS',
            'The token has no supported pools where it is the tracked base asset',
            context,
        );
    }

    const { pools: trackedPools, pairs: selectedPairs, pair: primaryPair, selection } = selected;
    const referencePool = trackedPools[0];
    const tokenDescriptor = primaryPair.baseToken;
    const totalVolume = basePairs.reduce((sum, pair) => sum + numeric(pair.volume?.h24), 0);
    const trackedVolume = trackedPools.reduce((sum, pool) => sum + pool.volumeH24Usd, 0);
    const price = numeric(primaryPair.priceUsd);
    if (!(price > 0)) {
        return failure(TOKEN_DISCOVERY_STATUS.UNAVAILABLE, 'PRICE_UNAVAILABLE', 'Token price is not available', context);
    }

    const resolvedAt = Date.now();
    const valuation = providerValuation({ tokenMint: mint, marketIdentity: primaryPair.pairAddress,
        source: 'dexscreener', priceUsd: price, marketCap: primaryPair.marketCap, fdv: primaryPair.fdv, receivedAt: resolvedAt });
    const resolvedContext = withTokenResolution(context, {
        symbol: tokenDescriptor.symbol,
        name: tokenDescriptor.name,
        metadata: { imageUrl: primaryPair.info?.imageUrl },
        resources: { pools: trackedPools, referencePool },
        discovery: {
            status: TOKEN_DISCOVERY_STATUS.RESOLVED,
            source: 'dexscreener',
            resolvedAt,
            fallback: false,
            provenance: { identity: 'dexscreener', pools: 'dexscreener', market: 'dexscreener' },
        },
    });
    return {
        ok: true,
        status: TOKEN_DISCOVERY_STATUS.RESOLVED,
        context: resolvedContext,
        market: {
            price,
            mcap: valuation.kind === 'MARKET_CAP' ? valuation.valueUsd : null,
            valuation,
            selection,
            chg: numeric(primaryPair.priceChange?.h1),
            pools: trackedPools.length,
            coverage: totalVolume > 0 ? (trackedVolume / totalVolume) * 100 : 0,
            referencePool,
            trackedPools,
            solPriceUsd: deriveSolPrice(basePairs),
            activity: summarizePoolActivity(selectedPairs, 'm5'),
            activity1h: summarizePoolActivity(selectedPairs, 'h1'),
            source: 'dexscreener',
            resolvedAt,
        },
    };
}

function failure(status, code, message, context = null, detail = '') {
    return { ok: false, status, context, error: { code, message, ...(detail ? { detail } : {}) } };
}

function numeric(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
