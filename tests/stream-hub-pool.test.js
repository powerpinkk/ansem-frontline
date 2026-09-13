import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../worker/src/server-market.js', () => ({ createRpcTransport: () => vi.fn(), resolveServerMarket: vi.fn() }));
import { resolveServerMarket } from '../worker/src/server-market.js';
import { StreamHub } from '../worker/src/stream-hub.js';
import { swapFixture, MINT, signatureFor } from './fixtures/integrity.js';
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
