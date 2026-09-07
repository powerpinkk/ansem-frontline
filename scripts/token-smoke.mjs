/* global fetch, AbortSignal, console, setTimeout */
import { discoverToken } from '../js/token-discovery.js';
import { createTokenContext } from '../js/token-context.js';
import { DEFAULT_TOKEN_CONTEXT } from '../js/token-presets.js';

const tokens = [
    { label: 'ANSEM', context: DEFAULT_TOKEN_CONTEXT },
    { label: 'USDC', context: createTokenContext({ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }) },
    { label: 'JUP', context: createTokenContext({ mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN' }) },
];

const results = [];
for (const { label, context } of tokens) {
    const resolution = await discoverToken(context, {
        fetchPairs: fetchDexPairs,
    });
    if (!resolution.ok) throw new Error(`${label}: ${resolution.status} (${resolution.error.code}: ${resolution.error.detail || resolution.error.message})`);
    if (resolution.context.identity.mint !== context.identity.mint) throw new Error(`${label}: mint mismatch`);
    if (resolution.context.identity.symbol.toUpperCase() !== label) throw new Error(`${label}: metadata mismatch`);
    if (!resolution.context.resources.pools.length) throw new Error(`${label}: no compatible pools`);
    results.push({
        token: label,
        mint: context.identity.mint,
        status: resolution.status,
        pools: resolution.context.resources.pools.length,
        referencePool: resolution.context.resources.referencePool.address,
    });
}

console.table(results);

async function fetchDexPairs(mint) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${encodeURIComponent(mint)}`, {
                headers: { accept: 'application/json' },
                signal: AbortSignal.timeout(8_000),
            });
            if (response.ok) return response.json();
            const error = new Error(`DexScreener HTTP ${response.status}`);
            error.status = response.status;
            throw error;
        } catch (error) {
            lastError = error;
            if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 350));
        }
    }
    throw lastError;
}
