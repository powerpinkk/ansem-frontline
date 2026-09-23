import { selectMarket } from '../../js/market-selection.js';
import { decodePoolIdentity, verifyPoolVaults } from './pool-identity.js';
import { probePumpCurve, pumpSwapValuation } from './pump-market.js';
import { AcquisitionError, createJsonRpcTransport } from './acquisition-policy.js';

export function isTransientAcquisitionFailure(error) {
    return error instanceof AcquisitionError
        ? error.retryable || error.deferred
        : /^(RPC_HTTP_429|RPC_HTTP_5|RPC_ERROR_|RPC_TIMEOUT|RPC_NETWORK|RPC_MALFORMED)/.test(error?.message || '');
}

export async function resolveServerMarket(mint, rpc, previous = null, fetchImpl = fetch) {
    let curve;
    try { curve = await probePumpCurve(mint, rpc); }
    catch (e) { return {pools:[],canonicalMarket:null,selection:previous,unsupportedPools:1,identityFailure:e.reason || e.message,
        acquisitionFailure:isTransientAcquisitionFailure(e),retryAt:e.retryAt || null,
        receivedAt:Date.now(),refreshIntervalMs:e.kind === 'RATE_LIMIT' || e.message === 'RPC_HTTP_429' ? 60_000 : 10_000}; }
    if (curve && !curve.complete) return {...curve,pools:curve.canonicalMarket.mayhem?[]:[curve.canonicalMarket],
        unsupportedPools:curve.canonicalMarket.mayhem?1:0,identityFailure:curve.canonicalMarket.mayhem?'UNSUPPORTED_MAYHEM':null,
        selection:{tokenMint:mint,pairAddress:curve.canonicalMarket.address,sourceEpoch:1},refreshIntervalMs:10_000};
    // The browser requests a mint. All subscription candidates come from this
    // fixed endpoint and their program owners are checked against fixed adapters.
    let selected;
    if (curve?.complete) selected={pools:[{address:curve.migration,quoteMint:curve.quoteMint}],
        selection:{tokenMint:mint,pairAddress:curve.migration,sourceEpoch:1}};
    else {
    const response = await fetchImpl(`https://api.dexscreener.com/token-pairs/v1/solana/${encodeURIComponent(mint)}`, {
        headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('DISCOVERY_UNAVAILABLE');
    const payload = await response.json();
    selected = selectMarket(Array.isArray(payload) ? payload : payload.pairs, mint, previous);
    if (!selected) throw new Error('NO_COMPATIBLE_MARKET');
    }
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
    let native = {};
    if (canonicalMarket?.protocol === 'pumpswap') {
        try { native = await pumpSwapValuation(canonicalMarket,rpc,canonicalMarket.verifiedAtSlot); }
        catch(e) { native = {valuationFailure:e.message}; }
        if (native.unsupportedVariant) {
            const mayhem=native.unsupportedVariant==='MAYHEM';
            identityFailure=mayhem?'UNSUPPORTED_MAYHEM':'UNSUPPORTED_PUMP_VARIANT';
            canonicalMarket={...canonicalMarket,compatibility:identityFailure,...(mayhem?{mayhem:true}:{})};
        }
    }
    const supported=canonicalMarket?.compatibility==='POOL_STATE_AND_VAULTS_VERIFIED';
    return { ...native, pools: supported ? [{ ...primary, ...canonicalMarket }] : [], canonicalMarket,
        lifecycle:curve?.complete&&!canonicalMarket?'CURVE_COMPLETE_MIGRATING':canonicalMarket?.lifecycle,
        refreshIntervalMs:curve?10_000:60_000,nativeRefreshIntervalMs:canonicalMarket?.protocol==='pumpswap'?10_000:null,
        selection: selected.selection, unsupportedPools: supported ? 0 : 1, identityFailure, receivedAt: Date.now() };
}

export async function refreshServerMarket(market, rpc) {
    if (market?.canonicalMarket?.protocol !== 'pumpswap') throw new Error('NATIVE_REFRESH_UNSUPPORTED');
    const refreshed = await pumpSwapValuation(market.canonicalMarket, rpc, market.canonicalMarket.verifiedAtSlot);
    const verifiedAtSlot = refreshed.nativeValuation?.slot ?? market.canonicalMarket.verifiedAtSlot;
    const canonicalMarket = { ...market.canonicalMarket, verifiedAtSlot };
    return { ...market, ...refreshed, canonicalMarket,
        pools: market.pools.map((pool) => pool.address === canonicalMarket.address ? { ...pool, ...canonicalMarket } : pool),
        receivedAt: market.receivedAt, nativeReceivedAt: Date.now() };
}

export function createRpcTransport(env, fetchImpl = fetch) {
    return createJsonRpcTransport(env, fetchImpl);
}
