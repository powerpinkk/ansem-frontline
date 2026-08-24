const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function parseClientConfiguration(raw) {
    let message;
    try { message = JSON.parse(raw); } catch { return null; }
    if (message?.type !== 'configure' || !Array.isArray(message.pools)) return null;

    const seen = new Set();
    const pools = message.pools.slice(0, 12).filter((pool) => {
        if (!SOLANA_ADDRESS.test(pool?.address || '') || seen.has(pool.address)) return false;
        seen.add(pool.address);
        return true;
    }).map((pool) => ({
        address: pool.address,
        dexId: String(pool.dexId || 'solana').slice(0, 40),
        quoteSymbol: String(pool.quoteSymbol || '').slice(0, 12),
    }));
    const tokenPriceUsd = Number(message.market?.tokenPriceUsd);
    const solPriceUsd = Number(message.market?.solPriceUsd);
    if (!pools.length || !(tokenPriceUsd > 0) || !(solPriceUsd > 0)) return null;
    return { pools, market: { tokenPriceUsd, solPriceUsd, updatedAt: Date.now() } };
}
