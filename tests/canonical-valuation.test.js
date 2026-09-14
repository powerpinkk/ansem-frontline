import {readFileSync} from 'node:fs';
import {expect,it,vi,afterEach} from 'vitest';
import {protocolMarketCap,canonicalValuation,createCanonicalValuationBoundary} from '../js/canonical-valuation.js';
import {probePumpCurve,pumpSwapValuation} from '../worker/src/pump-market.js';
import {decodeQuoteUsd} from '../worker/src/quote-usd.js';
const load=name=>JSON.parse(readFileSync(new URL('./fixtures/'+name,import.meta.url)));
const samples=load('public-chain/pump-current-states.json');
const sample=samples[0];
const native=()=>structuredClone(sample.nativeValuation),fx=()=>structuredClone(sample.quoteUsd),market=()=>structuredClone(sample.canonicalMarket);
const now=sample.receivedAt;
afterEach(()=>vi.restoreAllMocks());
it.each(load('pump-sdk-vectors.json').vectors)('matches official integer reference: $name',v=>{
    expect(protocolMarketCap(v.input).rawQuoteValue).toBe(v.rawQuoteValue);
});
it.each(['0','-1','NaN','Infinity','1.5',undefined])('rejects invalid reserve %s',baseReserve=>{
    expect(()=>protocolMarketCap({protocol:'pump-curve',supply:'1000000000000000',baseReserve,quoteReserve:'30000000000'})).toThrow();
});
it('does not reuse the PumpSwap Mayhem constant for curves',()=>{
    const input={supply:'2000000000000000',baseReserve:'1000000000000',quoteReserve:'1000000000',mayhem:true};
    expect(protocolMarketCap({...input,protocol:'pump-curve'}).rawQuoteValue).toBe('2000000000000');
    expect(protocolMarketCap({...input,protocol:'pumpswap'}).rawQuoteValue).toBe('1000000000000');
});
it('grants USD authority only when both independent observations satisfy the gates',()=>{
    const v=canonicalValuation(native(),fx(),market(),null,now);
    expect(v.authorityEligible).toBe(true);expect(v.valueUsd).toMatch(/^\d+(\.\d+)?$/);
    expect(canonicalValuation(native(),{...fx(),observedAt:now-90001},market(),v,now)).toMatchObject({authorityEligible:false,nativeFreshness:'FRESH',quoteFreshness:'STALE'});
    expect(canonicalValuation({...native(),observedAt:now-20001},fx(),market(),v,now).authorityEligible).toBe(false);
});
it.each([
    ['epoch',n=>{n.sourceEpoch++;}],['mint',n=>{n.tokenMint=n.quoteMint;}],['market',n=>{n.marketIdentity=n.quoteMint;}],
    ['supply',n=>{n.supplyVerified=false;}],['slot',n=>{n.slot=-1;}],['future time',n=>{n.observedAt=now+1;}],
    ['kind',n=>{n.kind='FDV';}],['formula',n=>{n.protocolDefinition='PROVIDER_INDICATIVE';}],['zero',n=>{n.rawQuoteValue='0';}],
])('withholds authority on %s',(_label,mutate)=>{const n=native();mutate(n);expect(canonicalValuation(n,fx(),market(),null,now).authorityEligible).toBe(false);});
it.each([
    ['source',q=>{q.source='dexscreener';}],['mint',q=>{q.quoteMint=sample.canonicalMarket.tokenMint;}],
    ['partial',q=>{q.verification='PARTIAL';}],['confidence',q=>{q.confidenceAccepted=false;}],
    ['price',q=>{q.price='Infinity';}],['zero',q=>{q.price='0';}],['negative',q=>{q.price='-1';}],
])('rejects quote evidence: %s',(_label,mutate)=>{const q=fx();mutate(q);expect(canonicalValuation(native(),q,market(),null,now).authorityEligible).toBe(false);});
it('separates a 10% FX move from token price, supply and rebase',()=>{
    const n=native(),q=fx();q.price='10000000000';
    const first=canonicalValuation(n,q,market(),null,now);
    q.price='11000000000';const fxMove=canonicalValuation(n,q,market(),first,now);
    expect(fxMove.movementCause).toBe('QUOTE_USD_FX_UPDATE');
    expect(Number(fxMove.valueUsd)/Number(first.valueUsd)).toBeCloseTo(1.1,12);
    const supply=canonicalValuation({...n,supplyRaw:String(BigInt(n.supplyRaw)*2n)},q,market(),fxMove,now);
    expect(supply.movementCause).toBe('SUPPLY_BASIS_CHANGE');
    expect(canonicalValuation({...n,sourceEpoch:2},q,{...market(),sourceEpoch:2},supply,now).movementCause).toBe('SOURCE_REBASE');
});
it.each([6,10,50])('accepts coherent %sx and reverse moves without magnitude gates',factor=>{
    const n=native(),q=fx(),m=market(),before=canonicalValuation(n,q,m,null,now);
    const after=canonicalValuation({...n,rawQuoteValue:String(BigInt(n.rawQuoteValue)*BigInt(factor))},q,m,before,now);
    expect(after.authorityEligible).toBe(true);expect(after.movementCause).toBe('TOKEN_PRICE_UPDATE');
    expect(Number(after.valueUsd)/Number(before.valueUsd)).toBeCloseTo(factor,10);
    expect(canonicalValuation(n,q,m,after,now).authorityEligible).toBe(true);
});
it('provider MC and FDV cannot overwrite the canonical observation',()=>{
    const m=market(),v=canonicalValuation(native(),fx(),m,null,now),boundary=createCanonicalValuationBoundary(m.tokenMint);
    boundary.accept(v,m,now);
    expect(boundary.accept({tokenMint:m.tokenMint,marketCap:Number(v.valueUsd)*20,fdv:5000000,priceUsd:999,authorityEligible:true},m,now)).toBeNull();
    expect(boundary.snapshot(now).valueUsd).toBe(v.valueUsd);
});
it('rejects epoch/slot/time regressions and expires authority on the client without new messages',()=>{
    const m=market(),v=canonicalValuation(native(),fx(),m,null,now),boundary=createCanonicalValuationBoundary(m.tokenMint);
    expect(boundary.accept(v,m,now)).not.toBeNull();
    for(const changed of [{slot:v.slot-1},{nativeObservedAt:v.nativeObservedAt-1},{quoteObservedAt:v.quoteObservedAt-1},{sourceEpoch:0}])
        expect(boundary.accept({...v,...changed},m,now)).toBeNull();
    expect(boundary.snapshot(now+20001).authorityEligible).toBe(false);
    boundary.clear();expect(boundary.snapshot(now)).toBeNull();
});
it.each(['NaN','Infinity','0','-1'])('rejects an invalid authoritative browser value %s',valueUsd=>{
    const m=market(),v=canonicalValuation(native(),fx(),m,null,now);
    expect(createCanonicalValuationBoundary(m.tokenMint).accept({...v,valueUsd},m,now)).toBeNull();
});
it('uses real USDC/USD and allows a depeg rather than pinning one dollar',()=>{
    const s=samples.find(s=>s.canonicalMarket.quoteDecimals===6&&s.quoteUsd);
    // Official-formula normal-coin vector using the observed USDC oracle. The
    // retained live USDC coins themselves are Mayhem and remain ineligible.
    const v=canonicalValuation({...s.nativeValuation,supplyVerified:true},{...s.quoteUsd,price:'90000000',exponent:-8},s.canonicalMarket,null,s.receivedAt);
    expect(v.quoteUsdPrice).toBe('0.9');expect(v.authorityEligible).toBe(true);
});
it('withholds Mayhem curve valuation when displayed and live-mint supply conventions disagree',()=>{
    for(const s of samples.filter(s=>s.canonicalMarket.mayhem)){
        expect(s.nativeValuation.provenance.state.mintSupply).toBe('2000000000000000');
        expect(s.nativeValuation.provenance.state.curveSupply).toBe('1000000000000000');
        expect(s.nativeValuation.supplyDefinitionStatus).toBe('MAYHEM_CURVE_SUPPLY_CONVENTION_UNRESOLVED');
        expect(canonicalValuation(s.nativeValuation,s.quoteUsd,s.canonicalMarket,null,s.receivedAt).authorityEligible).toBe(false);
    }
});
it('accepts exactly 100K to 600K under unchanged supply and source',()=>{
    const m=market(),n={...native(),rawQuoteValue:'1000000000000',quoteDecimals:9},q={...fx(),price:'10000000000',exponent:-8};
    const before=canonicalValuation(n,q,m,null,now),after=canonicalValuation({...n,rawQuoteValue:'6000000000000'},q,m,before,now);
    expect(before.valueUsd).toBe('100000');expect(after.valueUsd).toBe('600000');expect(after.authorityEligible).toBe(true);
});
it.each(samples.map(s=>[s.mint,s]))('replays atomic state acquisition %s',async(_mint,s)=>{
    vi.spyOn(Date,'now').mockReturnValue(s.receivedAt);
    const reads=structuredClone(s.reads);
    const rpc=vi.fn(async(method,params)=>{const read=reads.shift();expect(method).toBe(read.method);expect(params).toEqual(read.params);return read.result;});
    const result=await probePumpCurve(s.mint,rpc);
    expect(result.canonicalMarket).toEqual(s.canonicalMarket);expect(result.nativeValuation).toEqual(s.nativeValuation);
    expect(reads).toHaveLength(0);
});
it('rejects a Pyth account with a wrong owner, partial verification, feed, timestamp or price',()=>{
    const read=sample.reads.at(-1),account=read.result.value.at(-1),mint=sample.canonicalMarket.quoteMint;
    expect(decodeQuoteUsd(account,mint,read.result.context.slot,now).verification).toBe('FULL');
    expect(()=>decodeQuoteUsd({...account,owner:sample.canonicalMarket.programId},mint,read.result.context.slot,now)).toThrow();
    for(const change of [b=>{b[40]=0;},b=>{b[41]^=1;},b=>{b.fill(0,73,81);},b=>{b.writeBigInt64LE(BigInt(Math.floor(now/1000)+30),93);}]){
        const b=Buffer.from(account.data[0],'base64');change(b);
        expect(()=>decodeQuoteUsd({...account,data:[b.toString('base64'),'base64']},mint,read.result.context.slot,now)).toThrow();
    }
});
it.each(load('public-chain/pump-valuation-states.json').filter(s=>s.result.canonicalMarket.protocol==='pumpswap'))('replays live PumpSwap atomic valuation $mint including virtual quote reserves',async s=>{
    const expected=s.result,read=s.reads.at(-1);
    vi.spyOn(Date,'now').mockReturnValue(expected.nativeValuation.observedAt);
    const rpc=vi.fn(async(method,params)=>{
        expect(method).toBe(read.method);expect(params).toEqual(read.params);return read.result;
    });
    const result=await pumpSwapValuation(expected.canonicalMarket,rpc,read.params[1].minContextSlot);
    expect(result.nativeValuation).toEqual(expected.nativeValuation);
    expect(result.quoteUsd).toEqual(expected.quoteUsd);
    expect(canonicalValuation(result.nativeValuation,result.quoteUsd,expected.canonicalMarket,null,expected.receivedAt).authorityEligible).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
});
