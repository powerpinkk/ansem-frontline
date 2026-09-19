import { validateSolanaMint } from './token-context.js';

export const QUOTE_ASSETS = Object.freeze({
    So11111111111111111111111111111111111111112: { symbol: 'SOL', decimals: 9 },
    EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', decimals: 6 },
    Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: 'USDT', decimals: 6 },
});
export const SELECTION_POLICY = Object.freeze({ superiority: 1.25, maxPairs: 500, maxPools: 5 });
export const positive = (value) => {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
};

// Provider responses are unordered sets. Conflicting duplicate identities are
// unusable, rather than resolved by whichever object happened to arrive first.
export function eligiblePairs(pairs, mint) {
    if (!Array.isArray(pairs) || pairs.length > SELECTION_POLICY.maxPairs) return [];
    const byAddress = new Map();
    const conflicting = new Set();
    for (const p of pairs) {
        if (p?.chainId !== 'solana' || p.baseToken?.address !== mint
            || !validateSolanaMint(p.pairAddress).ok || !QUOTE_ASSETS[p.quoteToken?.address]
            || !positive(p.priceUsd) || !positive(p.liquidity?.usd)) continue;
        const previous = byAddress.get(p.pairAddress);
        const fingerprint = (x) => JSON.stringify([x.dexId, x.baseToken.address, x.quoteToken.address,
            x.priceUsd, x.marketCap, x.fdv, x.liquidity?.usd, x.volume?.h1, x.volume?.h24]);
        if (previous && fingerprint(previous) !== fingerprint(p)) conflicting.add(p.pairAddress);
        byAddress.set(p.pairAddress, p);
    }
    return [...byAddress.values()].filter((p) => !conflicting.has(p.pairAddress)).sort((a, b) =>
        positive(b.liquidity.usd) - positive(a.liquidity.usd)
        || (positive(b.volume?.h1) || 0) - (positive(a.volume?.h1) || 0)
        || a.pairAddress.localeCompare(b.pairAddress, 'en'));
}

export function selectMarket(pairs, mint, previous = null, now = Date.now(), limit = SELECTION_POLICY.maxPools) {
    const candidates = eligiblePairs(pairs, mint);
    if (!candidates.length) return null;
    const prior = previous?.tokenMint === mint && previous.source === 'dexscreener' ? previous : null;
    const incumbent = candidates.find((p) => p.pairAddress === prior?.pairAddress);
    const best = candidates[0];
    const retain = incumbent && positive(best.liquidity.usd) < positive(incumbent.liquidity.usd) * SELECTION_POLICY.superiority;
    const pair = retain ? incumbent : best;
    const unchanged = prior?.pairAddress === pair.pairAddress && prior.dexId === pair.dexId
        && prior.quoteMint === pair.quoteToken.address;
    const selection = {
        tokenMint: mint, pairAddress: pair.pairAddress, dexId: String(pair.dexId || 'unknown').slice(0, 40),
        baseMint: mint, quoteMint: pair.quoteToken.address, liquidityUsd: positive(pair.liquidity.usd),
        selectionReason: retain ? 'INCUMBENT_WITHIN_25_PERCENT' : incumbent ? 'SUPERIOR_LIQUIDITY' : 'BEST_AVAILABLE',
        selectedAt: unchanged ? prior.selectedAt : now, source: 'dexscreener',
        sourceEpoch: unchanged ? prior.sourceEpoch : (prior?.sourceEpoch || 0) + 1,
        evidenceLevel: 'PROVIDER_INDICATIVE',
    };
    const ordered = [pair, ...candidates.filter((p) => p.pairAddress !== pair.pairAddress)]
        .slice(0, Math.max(1, Math.min(SELECTION_POLICY.maxPools, limit)));
    return { pair, selection, pairs: ordered, pools: ordered.map(poolDescriptor) };
}

export function poolDescriptor(pair) {
    let url = null;
    try { const parsed = new URL(pair.url); if (parsed.protocol === 'https:') url = parsed.href; } catch { /* optional */ }
    return {
        address: pair.pairAddress, dexId: String(pair.dexId || 'unknown').slice(0, 40),
        baseMint: pair.baseToken.address, quoteMint: pair.quoteToken.address,
        quoteSymbol: QUOTE_ASSETS[pair.quoteToken.address].symbol,
        liquidityUsd: positive(pair.liquidity?.usd), volumeH24Usd: positive(pair.volume?.h24) || 0,
        volumeH1Usd: positive(pair.volume?.h1) || 0, url,
    };
}
