/* global console, setTimeout */
// Bounded test-only RPC, clock, replay/reconnect and source-generation changes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createEvidenceIngestion } from '../worker/src/evidence-ingestion.js';
import { calculatePressure } from '../js/market.js';
import { arbitrageFixture } from '../tests/fixtures/pool.js';
import { base58, MINT, SOL, USDC } from '../tests/fixtures/integrity.js';
const mints=[MINT,USDC,'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',SOL];
let now=Date.now(),cycles=0,reads=0,updates=0,rebases=0,highWater=0,maxEvents=0;
const services=[],fixtures=new Map();
function fixture(i,signature){const f=arbitrageFixture({mint:mints[i],quoteMint:i===3?USDC:SOL,signature,blockTime:Math.floor(now/1000)});
    const epoch=Math.floor(cycles/30)+1,pool=base58(new Uint8Array(32).fill(100+epoch%100));
    const next=JSON.parse(JSON.stringify(f).replaceAll(f.pool,pool));next.market.sourceEpoch=epoch;return next;}
const deadline=Date.now()+60000;
while(Date.now()<deadline){now+=4000;
    for(let i=0;i<4;i++){
        const signature=base58(createHash('sha512').update(`${cycles}:${i}`).digest());const f=fixture(i,signature);
        if(cycles%30===0){services[i]?.destroy();rebases+=cycles?1:0;services[i]=createEvidenceIngestion({tokenMint:mints[i],canonicalMarket:f.market,now:()=>now,onChange:()=>updates++,
            rpc:async(method,params)=>{reads++;return method==='getTransaction'?fixtures.get(params[0]):{value:params[0].map(()=>({confirmationStatus:'finalized'}))};}});}
        fixtures.set(signature,f.transaction);const service=services[i];assert(service.observeSignature(signature));
        for(let r=0;r<20;r++)assert.equal(service.observeSignature(signature),false);
        await service.drain();await service.tick();await service.drain();
        const events=service.snapshot(),mine=events.filter(e=>e.signature===signature);
        assert.deepEqual(mine.map(e=>e.isBuy),[true,false]);assert(mine.every(e=>e.settlement==='FINALIZED'));
        assert(events.every(e=>e.tokenMint===mints[i]&&e.sourceEpoch===f.market.sourceEpoch&&e.poolAddress===f.pool));
        assert.equal(new Set(events.map(e=>e.id)).size,events.length);
        if(i!==3){const p=calculatePressure(events,now);assert(p.buySol>0&&p.sellSol>0);assert.equal(p.buySol,p.sellSol);}
        const d=service.diagnostics();assert(d.records<=1024&&d.running<=2&&d.pendingReconciliations===0);
        highWater=Math.max(highWater,d.records);maxEvents=Math.max(maxEvents,events.length);
    }fixtures.clear();cycles++;await new Promise(r=>setTimeout(r,50));
}
for(const s of services){s.destroy();assert.equal(s.snapshot().length,0);assert.equal(s.diagnostics().records,0);}
const result={testOnly:true,realDurationSeconds:60,tokens:4,cycles,replayDeliveries:cycles*80,rebases,rpcReads:reads,publications:updates,highWater,maxEvents,teardown:'empty'};
writeFileSync('docs/pool-soak.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
