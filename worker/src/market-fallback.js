import { TOKEN_DISCOVERY_STATUS, createTokenContext } from '../../js/token-context.js';
import { ANSEM_FALLBACK_POOLS, ANSEM_MINT } from '../../js/token-presets.js';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';

export function fallbackPoolsForMint(mint) {
    return mint === ANSEM_MINT ? ANSEM_FALLBACK_POOLS : Object.freeze([]);
}

export function normalizeHeliusMarket(token, sol, { mint = ANSEM_MINT, pools = fallbackPoolsForMint(mint) } = {}) {
    const price = Number(token?.token_info?.price_info?.price_per_token || 0);
    const solPriceUsd = Number(sol?.token_info?.price_info?.price_per_token || 0);
    const reportedDecimals = Number(token?.token_info?.decimals);
    const decimals = Number.isInteger(reportedDecimals) && reportedDecimals >= 0 && reportedDecimals <= 18
        ? reportedDecimals
        : null;
    const rawSupply = Number(token?.token_info?.supply || 0);
    const supply = decimals !== null && Number.isFinite(rawSupply) && rawSupply >= 0
        ? rawSupply / (10 ** decimals)
        : null;
    if (!Number.isFinite(price) || !(price > 0) || !Number.isFinite(solPriceUsd) || !(solPriceUsd > 0)) return null;
    const metadata = token?.content?.metadata || {};
    const imageUrl = token?.content?.links?.image || token?.content?.files?.[0]?.uri;
    const tokenContext = createTokenContext({
        mint,
        symbol: metadata.symbol || token?.token_info?.symbol,
        name: metadata.name,
        decimals,
        supply,
        metadata: { imageUrl, uri: token?.content?.json_uri },
        resources: { pools, referencePool: pools[0] || null },
        discovery: {
            status: pools.length ? TOKEN_DISCOVERY_STATUS.RESOLVED : TOKEN_DISCOVERY_STATUS.UNSUPPORTED,
            source: 'helius-fallback',
            resolvedAt: Date.now(),
            fallback: true,
            provenance: { identity: 'helius', supply: 'helius', market: 'helius', pools: pools.length ? 'default-preset' : 'unavailable' },
        },
    });
    return {
        price,
        solPriceUsd,
        mcap: supply > 0 ? supply * price : 0,
        chg: null,
        pools,
        token: tokenContext,
        status: pools.length ? TOKEN_DISCOVERY_STATUS.RESOLVED : TOKEN_DISCOVERY_STATUS.UNSUPPORTED,
        source: 'helius-fallback',
    };
}
