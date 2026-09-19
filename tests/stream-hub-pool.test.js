import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../worker/src/server-market.js', () => ({ createRpcTransport: () => vi.fn(), resolveServerMarket: vi.fn() }));
import { resolveServerMarket } from '../worker/src/server-market.js';
import { StreamHub } from '../worker/src/stream-hub.js';
import { swapFixture, MINT, signatureFor } from './fixtures/integrity.js';
import { readFileSync } from 'node:fs';
afterEach(()=>vi.restoreAllMocks());
function setup() {
    const stored=new Map([['marketEpoch',7]]),sent=[];
    const ctx={storage:{get:async k=>stored.get(k),put:async(k,v)=>stored.set(k,v),setAlarm:async()=>{}},
        getWebSockets:()=>[{send:m=>sent.push(JSON.parse(m))}]};
    const hub=new StreamHub(ctx,{});hub.tokenMint=MINT;
    return {hub,sent,stored};
}
const market=f=>({canonicalMarket:structuredClone(f.market),pools:[structuredClone(f.market)],selection:{tokenMint:MINT},receivedAt:Date.now(),unsupportedPools:0});
it('persists an increasing market epoch and replaces ingestion on a source change',async()=>{
    const {hub,sent,stored}=setup(),f=swapFixture();resolveServerMarket.mockResolvedValueOnce(market(f));
    await hub.ensureMarket();const old=hub.ingestion;expect(hub.market.canonicalMarket.sourceEpoch).toBe(8);
    hub.market.receivedAt=0;const next=market(swapFixture({protocol:'dlmm'}));resolveServerMarket.mockResolvedValueOnce(next);
    await hub.ensureMarket();expect(hub.ingestion).not.toBe(old);expect(old.snapshot()).toEqual([]);
    expect(stored.get('marketEpoch')).toBe(9);expect(sent.at(-1)).toMatchObject({type:'snapshot',version:4,sourceEpoch:9,trades:[]});hub.ingestion.destroy();
});
it('a late catch-up response from the old pool cannot enter the new epoch or cursor',async()=>{
    const {hub}=setup(),f=swapFixture();resolveServerMarket.mockResolvedValueOnce(market(f));await hub.ensureMarket();
    let release;hub.rpc=()=>new Promise(r=>release=r);const pending=hub.catchUp();
    hub.market.receivedAt=0;resolveServerMarket.mockResolvedValueOnce(market(swapFixture({protocol:'dlmm'})));await hub.ensureMarket();
    release([{signature:f.signature,slot:100,blockTime:Math.floor(Date.now()/1000)}]);await pending;
    expect(hub.ingestion.diagnostics().records).toBe(0);expect(hub.cursorByPool.size).toBe(0);hub.ingestion.destroy();
});
it('failed and successful log mentions share acquisition, while alien subscriptions are ignored',async()=>{
    const {hub}=setup(),f=swapFixture();resolveServerMarket.mockResolvedValueOnce(market(f));await hub.ensureMarket();
    const observe=vi.spyOn(hub.ingestion,'observeSignature').mockReturnValue(true);hub.subscriptions.set(3,f.pool);
    const notification=(subscription,err)=>JSON.stringify({method:'logsNotification',params:{subscription,result:{context:{slot:100},value:{signature:signatureFor(),err}}}});
    hub.handleUpstreamMessage(notification(99,null));expect(observe).not.toHaveBeenCalled();
    hub.handleUpstreamMessage(notification(3,null));hub.handleUpstreamMessage(notification(3,{failed:true}));expect(observe).toHaveBeenCalledTimes(2);hub.ingestion.destroy();
});
it('curve completion, unavailable migration pool and AMM adoption rebase without executions',async()=>{
    const curve=JSON.parse(readFileSync(new URL('./fixtures/public-chain/pump-current-states.json',import.meta.url)))[0];
    vi.spyOn(Date,'now').mockReturnValue(curve.receivedAt);
    const {hub,sent}=setup();hub.tokenMint=curve.mint;
    resolveServerMarket.mockResolvedValueOnce({...curve,pools:[curve.canonicalMarket],selection:{tokenMint:curve.mint},receivedAt:Date.now()});
    await hub.ensureMarket();const epoch=hub.sourceEpoch,ingestion=hub.ingestion;
    expect(hub.diagnostics().canonicalValuation.authorityEligible).toBe(true);
    hub.market.receivedAt=0;
    resolveServerMarket.mockResolvedValueOnce({canonicalMarket:null,pools:[],selection:{tokenMint:curve.mint},
        identityFailure:'MIGRATION_POOL_NOT_YET_AVAILABLE',lifecycle:'CURVE_COMPLETE_MIGRATING',refreshIntervalMs:10000,receivedAt:Date.now()});
    await hub.ensureMarket();expect(hub.sourceEpoch).toBe(epoch+1);expect(hub.ingestion).toBeNull();expect(ingestion.snapshot()).toEqual([]);
    expect(hub.diagnostics().canonicalValuation).toBeNull();
    hub.market.receivedAt=0;const amm=market(swapFixture({mint:curve.mint}));amm.canonicalMarket.lifecycle='AMM';
    // Deterministic migration boundary, not a claimed observed migration price.
    // Even a large new reserve-derived observation must be a new source basis.
    amm.nativeValuation={...curve.nativeValuation,marketIdentity:amm.canonicalMarket.address,
        rawQuoteValue:String(BigInt(curve.nativeValuation.rawQuoteValue)*50n)};
    amm.quoteUsd=curve.quoteUsd;
    resolveServerMarket.mockResolvedValueOnce(amm);
    await hub.ensureMarket();expect(hub.sourceEpoch).toBe(epoch+2);expect(hub.market.canonicalMarket.lifecycle).toBe('AMM');
    expect(hub.diagnostics().canonicalValuation).toMatchObject({authorityEligible:true,movementCause:'SOURCE_REBASE',sourceEpoch:epoch+2});
    expect(sent.filter(m=>m.type==='trade'||m.type==='reconcile')).toEqual([]);
    expect(sent.filter(m=>m.type==='snapshot').every(m=>m.trades.length===0)).toBe(true);
    hub.ingestion.destroy();
});
it('idle teardown removes valuation, ingestion and cursors',async()=>{
    const {hub}=setup(),f=swapFixture();resolveServerMarket.mockResolvedValueOnce(market(f));await hub.ensureMarket();
    hub.ctx.getWebSockets=()=>[];hub.lastClientAt=0;hub.cursorByPool.set(f.pool,'cursor');
    await hub.alarm();expect(hub.market).toBeNull();expect(hub.ingestion).toBeNull();expect(hub.cursorByPool.size).toBe(0);
    expect(hub.valuationBoundary.snapshot()).toBeNull();
});
it('never creates ingestion or valuation authority for an unsupported Mayhem market',async()=>{
    const {hub}=setup(),f=swapFixture();resolveServerMarket.mockResolvedValueOnce(market(f));await hub.ensureMarket();
    const prior=hub.ingestion;expect(prior).not.toBeNull();hub.market.receivedAt=0;
    f.market={...f.market,mayhem:true,compatibility:'UNSUPPORTED_MAYHEM'};
    resolveServerMarket.mockResolvedValueOnce({canonicalMarket:f.market,pools:[],selection:{tokenMint:MINT},receivedAt:Date.now(),
        unsupportedPools:1,identityFailure:'UNSUPPORTED_MAYHEM',valuationFailure:'UNSUPPORTED_MAYHEM'});
    await hub.ensureMarket();
    expect(hub.ingestion).toBeNull();
    expect(prior.snapshot()).toEqual([]);
    expect(hub.diagnostics()).toMatchObject({unsupportedPools:1,identityFailure:'UNSUPPORTED_MAYHEM',
        valuationFailure:'UNSUPPORTED_MAYHEM',canonicalValuation:null,degraded:true});
});
