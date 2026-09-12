import { selectMarket } from '../../js/market-selection.js';
import { PROTOCOLS } from './protocol-verifiers.js';

export async function resolveServerMarket(mint, rpc, previous = null, fetchImpl = fetch) {
    // The browser requests a mint. All subscription candidates come from this
    // fixed endpoint and their program owners are checked against fixed adapters.
    const response = await fetchImpl(`https://api.dexscreener.com/token-pairs/v1/solana/${encodeURIComponent(mint)}`, {
        headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('DISCOVERY_UNAVAILABLE');
    const payload = await response.json();
    const selected = selectMarket(Array.isArray(payload) ? payload : payload.pairs, mint, previous);
    if (!selected) throw new Error('NO_COMPATIBLE_MARKET');
    const result = await rpc('getMultipleAccounts', [selected.pools.map((p) => p.address), {
        encoding: 'base64', commitment: 'confirmed', dataSlice: { offset: 0, length: 0 },
    }]);
    const pools = selected.pools.flatMap((pool, index) => {
        const account = result?.value?.[index];
        return account && !account.executable && PROTOCOLS[account.owner]
            ? [{ ...pool, programId: account.owner, compatibility: 'PROGRAM_OWNER_CHECKED', verifiedAtSlot: result.context.slot }] : [];
    });
    return { pools, selection: selected.selection, unsupportedPools: selected.pools.length - pools.length, receivedAt: Date.now() };
}

export function createRpcTransport(env, fetchImpl = fetch) {
    return async (method, params, signal) => {
        if (!env.HELIUS_API_KEY) throw new Error('RPC_NOT_CONFIGURED');
        const response = await fetchImpl(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(env.HELIUS_API_KEY)}`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error(`RPC_HTTP_${response.status}`);
        const payload = await response.json();
        if (payload.error) throw new Error(`RPC_ERROR_${payload.error.code}`);
        return payload.result;
    };
}
