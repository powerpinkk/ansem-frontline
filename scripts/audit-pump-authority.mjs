/* global console, structuredClone */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {verifyPoolExecutions} from '../worker/src/pool-executions.js';
import {probePumpCurve,pumpSwapValuation} from '../worker/src/pump-market.js';
import {canonicalValuation} from '../js/canonical-valuation.js';
const read=p=>JSON.parse(readFileSync(p));
const context=read('tests/fixtures/pump-capture-context.json');
const names=read('tests/fixtures/pump-current-index.json');
const old=['pump-curve-5PLzrxBbYJ7v.json'];
const replay=name=>{
    const path='tests/fixtures/public-chain/'+name,f=read(path);
    const result=verifyPoolExecutions(f.transaction,f.signature,f.market,'FINALIZED');
    const unsupported=f.market.mayhem===true;
    assert.equal(result.status,unsupported?'UNSUPPORTED':'VERIFIED');assert.equal(result.events.length,unsupported?0:1);
    return {fixture:name,sha256:createHash('sha256').update(readFileSync(path)).digest('hex'),signature:f.signature,
        slot:f.transaction.slot,mint:f.market.tokenMint,quote:f.market.quoteMint,status:result.status,reason:result.reason,
        events:result.events.map(e=>({instruction:e.instructions[0].name,route:e.routeKind,path:e.invocationPath,
            rawTokenAmount:e.rawTokenAmount,rawQuoteAmount:e.rawQuoteAmount,fees:e.fees,quoteSymbol:e.quoteSymbol}))};
};
const current=names.map(replay),previous=old.map(replay);
const successful=context.cohort.filter(r=>!r.err);
assert(current.every(s=>successful.some(r=>r.signature===s.signature)));
const supported=current.filter(s=>s.status==='VERIFIED'),unsupported=current.filter(s=>s.status==='UNSUPPORTED');
const summary={capturedAt:context.observedAt,endpoint:'https://api.mainnet-beta.solana.com',
    selection:'One bounded 48-mention Pump program page, single slot; supported executions plus one deterministic unsupported-variant proof. No market-wide extrapolation.',
    mentions:context.cohort.length,failedTransactions:context.cohort.filter(r=>r.err).length,
    successfulIdentifiedSwaps:successful.reduce((n,r)=>n+r.instructions.length,0),verifiedExecutions:supported.length,
    unsupportedIdentifiedSwaps:unsupported.length,uniqueMints:new Set(current.map(s=>s.mint)).size,
    instructionCounts:Object.fromEntries([...new Set(supported.flatMap(s=>s.events.map(e=>e.instruction)))].map(n=>[n,supported.flatMap(s=>s.events).filter(e=>e.instruction===n).length])),
    cohort:context.cohort,current,previous};
writeFileSync('docs/pump-mainnet-samples.json',JSON.stringify(summary,null,2));
const samples=read('tests/fixtures/public-chain/pump-valuation-states.json');
const valuations=[];const realNow=Date.now;
try {for(const s of samples){
    Date.now=()=>s.result.nativeValuation.observedAt;
    const isCurve=s.result.canonicalMarket.protocol==='pump-curve';
    const reads=structuredClone(isCurve?s.reads:[s.reads.at(-1)]);
    const rpc=async(method,params)=>{const r=reads.shift();assert.equal(method,r.method);assert.deepEqual(params,r.params);return r.result;};
    const result=isCurve?await probePumpCurve(s.mint,rpc):await pumpSwapValuation(s.result.canonicalMarket,rpc,reads[0].params[1].minContextSlot);
    assert.equal(reads.length,0);assert.equal(result.nativeValuation.rawQuoteValue,s.result.nativeValuation.rawQuoteValue);
    const market=result.canonicalMarket??s.result.canonicalMarket;
    const v=canonicalValuation(result.nativeValuation,result.quoteUsd,market,null,s.result.nativeValuation.observedAt);
    assert.equal(v.authorityEligible,true);
    const corroboration=context.providers.find(p=>p.mint===s.mint);
    const usd=Number(v.valueUsd),quoteValue=Number(result.nativeValuation.rawQuoteValue)/10**result.nativeValuation.quoteDecimals;
    const comparison={pumpQuoteRatio:quoteValue/corroboration.pump.market_cap_quote,
        pumpUsdDelta:usd-corroboration.pump.market_cap_usd,pumpUsdDeltaPercent:100*(usd/corroboration.pump.market_cap_usd-1),
        dex:corroboration.dex.map(p=>({pair:p.pair,mcDelta:usd-p.mc,mcDeltaPercent:100*(usd/p.mc-1)}))};
    valuations.push({mint:s.mint,protocol:market.protocol,market:market.address,observedAt:Date.now(),
        native:result.nativeValuation,quote:result.quoteUsd,valuation:v,failure:result.valuationFailure,
        corroboration,comparison,
        note:'Exact SDK protocol definition with live mint supply; asynchronous provider corroboration only.'});
}}finally{Date.now=realNow;}
writeFileSync('docs/pump-valuation-samples.json',JSON.stringify({historicalReplay:true,
    observationRange:[Math.min(...valuations.map(v=>v.observedAt)),Math.max(...valuations.map(v=>v.observedAt))],
    authoritativeAtObservation:valuations.filter(v=>v.valuation.authorityEligible).length,valuations},null,2));
console.log(JSON.stringify({mentions:summary.mentions,failed:summary.failedTransactions,currentVerified:supported.length,earlierVerified:previous.length,
    currentSupported:supported.length,currentUnsupported:unsupported.length,
    valuationEligibleAtObservation:valuations.filter(v=>v.valuation.authorityEligible).length}));
