import { selectMarket } from '../../js/market-selection.js';
import { decodePoolIdentity, verifyPoolVaults } from './pool-identity.js';

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
    // Only the deterministically selected market contributes pressure. Never
    // silently substitute another pool if its on-chain identity is unavailable.
    const primary = selected.pools[0];
    const result = await rpc('getMultipleAccounts', [[primary.address], { encoding: 'base64', commitment: 'confirmed' }]);
    let canonicalMarket = null, identityFailure = null;
    try {
        const identity = decodePoolIdentity(primary.address, result?.value?.[0], mint, primary.quoteMint);
        const vaultResult = await rpc('getMultipleAccounts', [identity.vaults, {
            encoding: 'base64', commitment: 'confirmed', minContextSlot: result.context.slot,
        }]);
        if (vaultResult.context.slot < result.context.slot) throw new Error('VAULT_SLOT_REGRESSION');
        canonicalMarket = { ...verifyPoolVaults(identity, vaultResult.value, vaultResult.context.slot), sourceEpoch: selected.selection.sourceEpoch };
    } catch (e) { identityFailure = e.message; }
    return { pools: canonicalMarket ? [{ ...primary, ...canonicalMarket }] : [], canonicalMarket,
        selection: selected.selection, unsupportedPools: canonicalMarket ? 0 : 1, identityFailure, receivedAt: Date.now() };
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
