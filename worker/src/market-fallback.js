export const SOL_MINT = 'So11111111111111111111111111111111111111112';

export const FALLBACK_POOLS = Object.freeze([
    { address: '6e7V9eegCHw997T72MxgwwJipZ6GJyZF8NvjkzT1rvpN', dexId: 'meteora', quoteSymbol: 'SOL' },
    { address: 'FnzKY6x7entQ1eR3D225dQyT7ybfka4PskBMQhb8L3CC', dexId: 'pumpswap', quoteSymbol: 'SOL' },
]);

export function normalizeHeliusMarket(token, sol) {
    const price = Number(token?.token_info?.price_info?.price_per_token || 0);
    const solPriceUsd = Number(sol?.token_info?.price_info?.price_per_token || 0);
    const decimals = Number(token?.token_info?.decimals || 0);
    const rawSupply = Number(token?.token_info?.supply || 0);
    const supply = decimals >= 0 ? rawSupply / (10 ** decimals) : 0;
    if (!(price > 0) || !(solPriceUsd > 0)) return null;
    return {
        price,
        solPriceUsd,
        mcap: supply > 0 ? supply * price : 0,
        chg: null,
        pools: FALLBACK_POOLS,
        source: 'helius-fallback',
    };
}
