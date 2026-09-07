import { CONFIG } from './config.js';
import { createTokenContext, validateSolanaMint } from './token-context.js';
import { discoverToken } from './token-discovery.js';
import { DEFAULT_TOKEN_CONTEXT } from './token-presets.js';
import { deriveSolPrice } from './market.js';

export async function resolveTokenInput(input, {
    signal,
    fetchImpl = fetch,
    timeoutMs = 4_500,
} = {}) {
    const validation = validateSolanaMint(input);
    if (!validation.ok) return discoverToken(input, { fetchPairs: async () => [] });
    const context = validation.value === DEFAULT_TOKEN_CONTEXT.identity.mint
        ? DEFAULT_TOKEN_CONTEXT
        : createTokenContext({ mint: validation.value });
    return discoverToken(context, {
        fetchPairs: (mint) => fetchTokenPairs(mint, { signal, fetchImpl, timeoutMs }),
        fetchSolPrice: async () => deriveSolPrice(await fetchTokenPairs(CONFIG.SOL_MINT, { signal, fetchImpl, timeoutMs })),
    });
}

async function fetchTokenPairs(mint, { signal, fetchImpl, timeoutMs }) {
    const timeoutController = new AbortController();
    const abortFromCaller = () => timeoutController.abort(signal?.reason);
    if (signal?.aborted) abortFromCaller();
    else signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
    try {
        const response = await fetchImpl(`${CONFIG.DEXSCREENER_TOKEN_URL}/${encodeURIComponent(mint)}`, {
            signal: timeoutController.signal,
            headers: { accept: 'application/json' },
        });
        if (!response.ok) {
            const error = new Error(`HTTP ${response.status}`);
            error.status = response.status;
            throw error;
        }
        return await response.json();
    } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abortFromCaller);
    }
}
