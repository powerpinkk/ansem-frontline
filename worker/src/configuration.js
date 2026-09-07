import { validateSolanaMint } from '../../js/token-context.js';

export function parseClientConfiguration(raw, { expectedMint = '', defaultMint = '' } = {}) {
    let message;
    try { message = JSON.parse(raw); } catch { return null; }
    if (message?.type !== 'configure' || !Array.isArray(message.pools)) return null;

    const mintValidation = validateSolanaMint(message.token?.mint || message.mint || defaultMint);
    if (!mintValidation.ok || (expectedMint && mintValidation.value !== expectedMint)) return null;
    const chain = message.token?.chain || 'solana';
    if (chain !== 'solana') return null;

    const seen = new Set();
    const pools = message.pools.slice(0, 12).filter((pool) => {
        if (!validateSolanaMint(pool?.address).ok || seen.has(pool.address)) return false;
        seen.add(pool.address);
        return true;
    }).map((pool) => ({
        address: pool.address,
        dexId: String(pool.dexId || 'solana').slice(0, 40),
        quoteSymbol: String(pool.quoteSymbol || '').slice(0, 12),
    }));
    const tokenPriceUsd = Number(message.market?.tokenPriceUsd);
    const solPriceUsd = Number(message.market?.solPriceUsd);
    if (!pools.length
        || !Number.isFinite(tokenPriceUsd) || !(tokenPriceUsd > 0) || tokenPriceUsd > 1e15
        || !Number.isFinite(solPriceUsd) || !(solPriceUsd > 0) || solPriceUsd > 1e9) return null;
    return {
        token: { mint: mintValidation.value, chain },
        pools,
        market: { tokenPriceUsd, solPriceUsd, updatedAt: Date.now() },
    };
}
