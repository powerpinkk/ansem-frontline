import { TOKEN_DISCOVERY_STATUS, createTokenContext } from '../../js/token-context.js';
import { ANSEM_FALLBACK_POOLS, ANSEM_MINT } from '../../js/token-presets.js';
import { providerValuation } from '../../js/market-valuation.js';
import { positive } from '../../js/market-selection.js';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';

export function fallbackPoolsForMint(mint) {
    return mint === ANSEM_MINT ? ANSEM_FALLBACK_POOLS : Object.freeze([]);
}

export function normalizeHeliusMarket(token, sol, { mint = ANSEM_MINT, pools = fallbackPoolsForMint(mint) } = {}) {
    if ((token?.id && token.id !== mint) || (sol?.id && sol.id !== SOL_MINT)) return null;
    const price = positive(token?.token_info?.price_info?.price_per_token);
    const solPriceUsd = positive(sol?.token_info?.price_info?.price_per_token);
    const value = token?.token_info?.decimals;
    const reportedDecimals = value === null || value === undefined || typeof value === 'boolean' || value === '' ? NaN : Number(value);
    const decimals = Number.isInteger(reportedDecimals) && reportedDecimals >= 0 && reportedDecimals <= 18
        ? reportedDecimals
        : null;
    const reportedSupply = token?.token_info?.supply;
    const rawSupply = typeof reportedSupply === 'string' && /^\d{1,20}$/.test(reportedSupply) && BigInt(reportedSupply) <= 18446744073709551615n
        ? reportedSupply : Number.isSafeInteger(reportedSupply) && reportedSupply >= 0 ? String(reportedSupply) : null;
    const supply = decimals !== null && rawSupply !== null
        ? Number(rawSupply) / (10 ** decimals)
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
    const valuation = providerValuation({ tokenMint: mint, source: 'helius-fallback', priceUsd: price,
        fdv: supply > 0 ? supply * price : null,
        supplyBasis: supply !== null ? { kind: 'TOTAL', rawAmount: rawSupply, decimals, source: 'helius-das' } : null });
    return {
        price,
        solPriceUsd,
        mcap: null,
        valuation,
        chg: null,
        pools,
        token: tokenContext,
        status: pools.length ? TOKEN_DISCOVERY_STATUS.RESOLVED : TOKEN_DISCOVERY_STATUS.UNSUPPORTED,
        source: 'helius-fallback',
    };
}
