import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {verifyPoolExecutions} from '../worker/src/pool-executions.js';
import {decodeBase58} from '../worker/src/protocol-verifiers.js';
import {encodeBase58} from '../worker/src/pool-identity.js';
import {curveAddress,decodeCurve,migrationAddress,PUMP_PROGRAM,SOL_MINT} from '../worker/src/pump-state.js';
import {isCanonicalTrade} from '../js/market-evidence.js';
import {calculatePressure} from '../js/market.js';
const load=name=>JSON.parse(readFileSync(new URL('./fixtures/'+name,import.meta.url)));
const current=load('pump-current-index.json');
const old=['pump-curve-5PLzrxBbYJ7v.json'];
const supported=[...old,...current.filter(name=>!load('public-chain/'+name).market.mayhem)];
const mayhem=current.find(name=>load('public-chain/'+name).market.mayhem);
const verify=f=>verifyPoolExecutions(f.transaction,f.signature,f.market,'FINALIZED');
const pumpInstruction=f=>[...f.transaction.transaction.message.instructions,
    ...f.transaction.meta.innerInstructions.flatMap(group=>group.instructions)].find(i=>i.programId===PUMP_PROGRAM&&i.data);
describe('current Pump curve execution proof',()=>{
    it.each(supported)('verifies retained supported public invocation %s',name=>{
        const f=load('public-chain/'+name),r=verify(f);
        expect(r.status).toBe('VERIFIED');expect(r.events).toHaveLength(1);expect(isCanonicalTrade(r.events[0])).toBe(true);
        expect(r.events[0]).toMatchObject({poolAddress:f.market.address,sourceEpoch:1,usdValue:null,userEconomicAttribution:'INDEPENDENT_NOT_EVALUATED'});
    });
    it('keeps native quote separate from ATA rent, network fee, creator and protocol fees',()=>{
        const f=load('public-chain/'+current[0]),r=verify(f).events[0];
        expect(BigInt(r.rawQuoteAmount)).toBeGreaterThan(0n);expect(BigInt(r.rawTokenAmount)).toBeGreaterThan(0n);
        f.transaction.meta.fee+=99999;f.transaction.meta.postBalances[0]-=99999;
        expect(verify(f).events[0].rawQuoteAmount).toBe(r.rawQuoteAmount);
    });
    it('rejects Mayhem before it can become canonical pressure, even if market metadata is omitted',()=>{
        const f=load('public-chain/'+mayhem),direct=verify(f);
        expect(direct).toMatchObject({status:'UNSUPPORTED',reason:'UNSUPPORTED_MAYHEM',events:[]});
        delete f.market.mayhem;
        const eventGuard=verify(f);
        expect(eventGuard.events).toEqual([]);
        expect(eventGuard.executions).toContainEqual(expect.objectContaining({status:'UNVERIFIED',reason:'UNSUPPORTED_MAYHEM'}));
        expect(calculatePressure(eventGuard.events,Date.now())).toMatchObject({buySol:0,sellSol:0});
    });
    it('verifies supported non-native quote directions without inventing SOL pressure',()=>{
        const events=supported.flatMap(name=>verify(load('public-chain/'+name)).events).filter(e=>e.quoteMint!==SOL_MINT);
        expect(events.map(e=>e.isBuy).sort()).toEqual([false,true]);
        expect(events.every(e=>e.solValue===null)).toBe(true);
        const pressure=calculatePressure(events,events[0].timestamp);
        expect(pressure.buySol).toBe(0);expect(pressure.sellSol).toBe(0);
    });
    it.each([
        ['failed transaction',f=>{f.transaction.meta.err={InstructionError:[3,'failed']};}],
        ['signature substitution',f=>{f.signature=f.signature.slice(1)+f.signature[0];}],
        ['pool substitution',f=>{f.market.address=f.market.globalAddress;}],
        ['mint substitution',f=>{f.market.tokenMint=f.market.quoteMint;}],
        ['quote substitution',f=>{f.market.quoteMint=f.market.tokenMint;}],
        ['vault substitution',f=>{f.market.vaults[0]=f.market.eventAuthority;}],
        ['token program substitution',f=>{f.market.tokenPrograms[0]=PUMP_PROGRAM;}],
        ['missing epoch',f=>{f.market.sourceEpoch=0;}],
        ['quote decimals substitution',f=>{f.market.quoteDecimals=6;}],
        ['missing invocation proof',f=>{f.transaction.meta.logMessages=[];}],
        ['curve conservation',f=>{const i=f.transaction.transaction.message.accountKeys.findIndex(k=>k.pubkey===f.market.address);f.transaction.meta.postBalances[i]++;}],
        ['base conservation',f=>{const b=f.transaction.meta.postTokenBalances.find(b=>b.owner===f.market.address&&b.mint===f.market.tokenMint);b.uiTokenAmount.amount=String(BigInt(b.uiTokenAmount.amount)+1n);}],
        ['missing transfers',f=>{for(const g of f.transaction.meta.innerInstructions)g.instructions=g.instructions.filter(i=>!i.parsed?.type?.startsWith('transfer'));}],
        ['missing event',f=>{for(const g of f.transaction.meta.innerInstructions)g.instructions=g.instructions.filter(i=>i.programId!==PUMP_PROGRAM);}],
        ['spoofed event bytes',f=>{for(const g of f.transaction.meta.innerInstructions)for(const i of g.instructions)if(i.programId===PUMP_PROGRAM){const b=decodeBase58(i.data);b[48]^=1;i.data=encodeBase58(b);}}],
        ['unknown instruction',f=>{const i=pumpInstruction(f);const b=decodeBase58(i.data);b[0]^=1;i.data=encodeBase58(b);}],
    ])('rejects %s',(_name,mutate)=>{const f=load('public-chain/'+current[0]);mutate(f);expect(verify(f).events).toEqual([]);});
    it('slippage limit never supplies executed amount',()=>{
        const f=load('public-chain/'+current[0]),before=verify(f).events[0];
        const ix=pumpInstruction(f);
        const b=decodeBase58(ix.data);b.fill(255,16,24);ix.data=encodeBase58(b);
        expect(verify(f).events[0].rawQuoteAmount).toBe(before.rawQuoteAmount);
    });
    it('requires every successful ancestor, including caught failures',()=>{
        const f=load('public-chain/'+current[1]);
        const wrapper=f.transaction.transaction.message.instructions[2].programId;
        f.transaction.meta.logMessages=f.transaction.meta.logMessages.map(l=>l===`Program ${wrapper} success`?`Program ${wrapper} failed: custom error`:l);
        expect(verify(f).events).toEqual([]);
    });
    it('decodes an official SDK legacy exact-SOL vector without confusing budget with execution',()=>{
        const f=load('pump-legacy-exact-sdk.json'),result=verify(f);
        expect(f.testOnly.sdk).toBe('@pump-fun/pump-sdk@2.0.0');
        expect(result.events).toHaveLength(1);
        expect(result.events[0].instructions[0].name).toBe('buy_exact_sol_in');
        expect(result.events[0].rawQuoteAmount).toBe(f.testOnly.rawQuoteAmount);
        expect(BigInt(f.testOnly.budget)).toBeGreaterThan(BigInt(result.events[0].rawQuoteAmount));
    });
});
it.each(load('pump-pda-vectors.json'))('matches independent SDK PDA $mint',async v=>{
    expect(await curveAddress(v.mint)).toBe(v.curve);
});
it('derives the four retained actual canonical migration pools from completed curves',async()=>{
    for(const proof of load('public-chain/pump-graduation-proofs.json')){
        expect(decodeCurve(proof.account).complete).toBe(true);
        expect(await curveAddress(proof.mint)).toBe(proof.curve);
        expect(await migrationAddress(proof.mint,SOL_MINT)).toBe(proof.pool);
    }
});
it('decodes old prefix state defaults, and rejects invalid owner/partial unknown layout',()=>{
    const state=load('public-chain/pump-current-states.json').find(s=>s.canonicalMarket.mayhem);
    const a=state.reads[0].result.value[0];
    const bytes=Buffer.from(a.data[0],'base64');
    expect(decodeCurve(a).is_mayhem_mode).toBe(true);
    expect(decodeCurve({...a,data:[bytes.subarray(0,49).toString('base64'),'base64']})).toMatchObject({complete:false,is_mayhem_mode:false,quote_mint:'11111111111111111111111111111111'});
    expect(()=>decodeCurve({...a,owner:state.canonicalMarket.tokenPrograms[0]})).toThrow('CURVE_OWNER');
    expect(()=>decodeCurve({...a,data:[bytes.subarray(0,100).toString('base64'),'base64']})).toThrow('CURVE_LAYOUT_VERSION');
});
