/* global console, setTimeout, structuredClone */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createEvidenceIngestion} from '../worker/src/evidence-ingestion.js';
import {canonicalValuation,createCanonicalValuationBoundary} from '../js/canonical-valuation.js';
import {base58,swapFixture} from '../tests/fixtures/integrity.js';
const names=['pump-current-riwhygf4yVCi','pump-current-2YWDvuzevLrH','pump-current-4UShs8LsunL6','pump-current-4FRUXb8DEjGx'];
const examples=names.map(n=>JSON.parse(readFileSync('tests/fixtures/public-chain/'+n+'.json')));
const states=JSON.parse(readFileSync('tests/fixtures/public-chain/pump-current-states.json'));
const services=[],boundaries=examples.map(f=>createCanonicalValuationBoundary(f.market.tokenMint)),pending=new Map();
let now=Date.now(),cycles=0,reads=0,publications=0,rebases=0,maxRecords=0,maxEvents=0,fxRefreshes=0;
const deadline=Date.now()+60000;
while(Date.now()<deadline){now+=4000;
    for(let i=0;i<examples.length;i++){
        const source=examples[i],phase=Math.floor(cycles/30),epoch=phase+1,amm=phase%2===1;
        const signature=base58(createHash('sha512').update(`pump:${cycles}:${i}`).digest());
        const f=amm?swapFixture({mint:source.market.tokenMint,quoteMint:source.market.quoteMint,signature,blockTime:Math.floor(now/1000)}):structuredClone(source);
        f.market={...f.market,lifecycle:amm?'AMM':'CURVE_ACTIVE',sourceEpoch:epoch};
        f.transaction.blockTime=Math.floor(now/1000);f.transaction.transaction.signatures[0]=signature;
        if(cycles%30===0){services[i]?.destroy();boundaries[i].clear();rebases+=cycles?1:0;
            services[i]=createEvidenceIngestion({tokenMint:f.market.tokenMint,canonicalMarket:f.market,now:()=>now,onChange:()=>publications++,
                rpc:async(method,params)=>{reads++;return method==='getTransaction'?pending.get(params[0]):{value:params[0].map(()=>({confirmationStatus:'finalized'}))};}});
        }
        pending.set(signature,f.transaction);const service=services[i];assert(service.observeSignature(signature));
        // Live delivery, reconnect replay and bounded-history overlap all enter
        // the same signature registry. This is mocked transport, not uptime.
        for(let replay=0;replay<20;replay++)assert.equal(service.observeSignature(signature),false);
        await service.drain();await service.tick();await service.drain();
        const events=service.snapshot();assert(events.some(e=>e.signature===signature));assert(events.every(e=>e.settlement==='FINALIZED'&&e.sourceEpoch===epoch&&e.tokenMint===f.market.tokenMint));
        const s=states.find(s=>s.mint===f.market.tokenMint)||states[0];
        const native={...s.nativeValuation,tokenMint:f.market.tokenMint,marketIdentity:f.market.address,sourceEpoch:epoch,quoteMint:f.market.quoteMint,observedAt:now,slot:cycles+1};
        const quote={...s.quoteUsd,quoteMint:f.market.quoteMint,price:'10000000000',observedAt:now};
        const v=canonicalValuation(native,quote,f.market,boundaries[i].snapshot(now),now);
        assert.equal(v.authorityEligible,native.supplyVerified);
        boundaries[i].accept(v,f.market,now);
        const count=publications;quote.price='11000000000';
        const fx=canonicalValuation(native,quote,f.market,v,now);assert.equal(fx.movementCause,'QUOTE_USD_FX_UPDATE');
        assert(boundaries[i].accept(fx,f.market,now));assert.equal(publications,count);fxRefreshes++;
        assert.equal(boundaries[i].snapshot(now+90001).authorityEligible,false);
        const diagnostics=service.diagnostics();assert(diagnostics.records<=1024&&diagnostics.running<=2&&diagnostics.pendingReconciliations===0);
        maxRecords=Math.max(maxRecords,diagnostics.records);maxEvents=Math.max(maxEvents,events.length);
    }
    pending.clear();cycles++;await new Promise(r=>setTimeout(r,40));
}
for(const s of services){s.destroy();assert.equal(s.snapshot().length,0);assert.equal(s.diagnostics().records,0);}
for(const b of boundaries){b.clear();assert.equal(b.snapshot(now),null);}assert.equal(pending.size,0);
const result={testOnly:true,realDurationSeconds:60,tokens:4,cycles,replayDeliveries:cycles*80,rebases,fxRefreshes,rpcReads:reads,publications,maxRecords,maxEvents,teardown:'empty'};
writeFileSync('docs/pump-authority-soak.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
