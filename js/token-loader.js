import { CONFIG } from './config.js';
import { createTokenContext, validateSolanaMint, withTokenResolution } from './token-context.js';
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
    const result = await discoverToken(context, {
        fetchPairs: (mint) => fetchTokenPairs(mint, { signal, fetchImpl, timeoutMs }),
        fetchSolPrice: async () => deriveSolPrice(await fetchTokenPairs(CONFIG.SOL_MINT, { signal, fetchImpl, timeoutMs })),
    });
    if (result.ok || signal?.aborted) return result;
    // An active Pump curve can exist before any provider pair. Resolve its
    // canonical server identity without inventing a provider price or listing.
    try {
        const response = await fetchImpl(CONFIG.RELAY_RECENT_URL, {
            method:'POST',headers:{'content-type':'application/json',accept:'application/json'},
            body:JSON.stringify({type:'configure',token:{mint:validation.value,chain:'solana'}}),
            signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) return result;
        const snapshot = await response.json(), market = snapshot.canonicalMarket;
        if (signal?.aborted || snapshot.version!==4 || snapshot.tokenMint!==validation.value
            || market?.tokenMint!==validation.value || market.lifecycle!=='CURVE_ACTIVE'
            || market.compatibility!=='POOL_STATE_AND_VAULTS_VERIFIED' || !validateSolanaMint(market.address).ok
            || !Number.isSafeInteger(market.sourceEpoch) || market.sourceEpoch<1) return result;
        return {ok:true,status:'resolved',market:null,context:withTokenResolution(context,{
            decimals:market.tokenDecimals,resources:{pools:[market],referencePool:market},
            discovery:{status:'resolved',source:'verified-pump-curve',observedAt:Date.now()},
        })};
    } catch { return result; }
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
