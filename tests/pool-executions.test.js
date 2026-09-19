import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { verifyPoolExecutions } from '../worker/src/pool-executions.js';
import { verifyTransaction } from '../worker/src/transaction-evidence.js';
import { createEvidenceIngestion } from '../worker/src/evidence-ingestion.js';
import { decodePoolIdentity, verifyPoolVaults } from '../worker/src/pool-identity.js';
import { summarizePoolCoverage } from '../worker/src/pool-coverage.js';
import { activeTrade, createTradeJournal } from '../js/market-evidence.js';
import { calculatePressure } from '../js/market.js';
import { base58, swapFixture, MINT, SOL, USDC } from './fixtures/integrity.js';
import { routerFixture } from './fixtures/router.js';
import { arbitrageFixture } from './fixtures/pool.js';
const identities = JSON.parse(readFileSync(new URL('./fixtures/public-chain/pool-identities.json', import.meta.url)));
const verify = (f) => verifyPoolExecutions(f.transaction, f.signature, f.market);
describe('canonical market effect independent of user attribution', () => {
    it('rejects a Mayhem PumpSwap market before it can create pressure',()=>{
        const f=swapFixture({protocol:'pumpswap'});f.market={...f.market,mayhem:true};
        expect(verify(f)).toMatchObject({status:'UNSUPPORTED',reason:'UNSUPPORTED_MAYHEM',events:[]});
    });
    it.each(['pumpswap','dlmm','orca'])('direct and Jupiter CPI have equivalent %s pool quantities', (protocol) => {
        for (const isBuy of [true,false]) {
            const direct = verify(swapFixture({ protocol, isBuy })).events[0];
            const routed = verify(swapFixture({ protocol, isBuy, routed: true })).events[0];
            expect(routed).toMatchObject({ isBuy, rawTokenAmount: direct.rawTokenAmount, rawQuoteAmount: direct.rawQuoteAmount,
                wallet: null, economicScope: 'CANONICAL_POOL_EXECUTION', routeKind: 'CPI' });
        }
    });
    it('an unknown wrapper cannot veto positively proven pool execution', () => {
        const f = swapFixture({ routed: true }); f.transaction.transaction.message.instructions[0].data = '111';
        expect(verifyTransaction(f.transaction,f.signature,MINT).event).toBeNull();
        expect(verify(f).events).toHaveLength(1);
    });
    it('an intermediate token has a real BUY and SELL at its respective canonical pools', () => {
        const f=routerFixture({intermediate:true});
        expect(verifyTransaction(f.transaction,f.signature,MINT)).toMatchObject({status:'NON_DIRECTIONAL',event:null});
        const legs=f.transaction.meta.innerInstructions[0].instructions.filter(i=>i.accounts?.[0] && i.programId.startsWith('LBUZ'));
        const outcomes=legs.map(ix=>verifyPoolExecutions(f.transaction,f.signature,{
            ...swapFixture({protocol:'dlmm'}).market, address:ix.accounts[0], mints:[ix.accounts[6],ix.accounts[7]],
            vaults:[ix.accounts[2],ix.accounts[3]], quoteMint:ix.accounts[6]===MINT?ix.accounts[7]:ix.accounts[6],
        }));
        expect(outcomes.map(r=>r.events[0].isBuy)).toEqual([true,false]);
        expect(outcomes.map(r=>r.events.length)).toEqual([1,1]);
        expect(verifyPoolExecutions(f.transaction,f.signature,swapFixture().market).events).toEqual([]);
    });
    it('preserves BUY then SELL in one signature even when all account net deltas are zero', () => {
        const f = arbitrageFixture(), result = verify(f);
        expect(result.events.map(e=>e.isBuy)).toEqual([true,false]);
        expect(result.events.map(e=>e.invocationPath)).toEqual(['0.outer','1.outer']);
        const journal = createTradeJournal(MINT);
        for (const event of [...result.events].reverse()) journal.upsert(event);
        for (const event of result.events) journal.upsert({ ...event, settlement: 'FINALIZED' });
        expect(journal.values().map(e=>e.invocationPath)).toEqual(['0.outer','1.outer']);
        expect(calculatePressure(journal.values())).toMatchObject({ buySol: 25, sellSol: 25 });
        expect(verifyTransaction(f.transaction,f.signature,MINT).event).toBeNull();
    });
    it('preserves two ordered CPI invocations of the same pool under one router', () => {
        const f=arbitrageFixture({routed:true}),tx=f.transaction;
        tx.transaction.message.instructions.pop();
        const second=tx.meta.innerInstructions.pop();tx.meta.innerInstructions[0].instructions.push(...second.instructions);
        const half=tx.meta.logMessages.length/2;
        tx.meta.logMessages.splice(half-1,2);
        const r=verify(f);
        expect(r.events.map(e=>e.isBuy)).toEqual([true,false]);
        expect(r.events.map(e=>e.invocationPath)).toEqual(['0.0','0.3']);
    });
    it.each(['deposit','withdraw','create_pool','collect_coin_creator_fee','migrate_pool_coin_creator'])('%s is not swap pressure even with token flows', (name) => {
        const f = swapFixture(); const bytes = Buffer.alloc(24); createHash('sha256').update('global:'+name).digest().copy(bytes,0,0,8);
        f.transaction.transaction.message.instructions[0].data = base58(bytes);
        expect(verify(f)).toMatchObject({ events: [], executions: [], nonSwaps: 1 });
    });
    it('unknown discriminators stay unclassified instead of improving the swap denominator', () => {
        const f=swapFixture();f.transaction.transaction.message.instructions[0].data='111';
        expect(verify(f)).toMatchObject({ status: 'UNVERIFIED', events: [], executions: [], unclassified: 1 });
    });
    it.each(['mint','vault','quote','program','epoch'])('rejects wrong canonical %s', (kind) => {
        const f=swapFixture();
        if(kind==='mint')f.market.tokenMint=USDC;
        if(kind==='vault')f.market.vaults[0]=USDC;
        if(kind==='quote')f.market.quoteMint=USDC;
        if(kind==='program')f.market.programId=USDC;
        if(kind==='epoch')f.market.sourceEpoch=0;
        expect(verify(f).events).toEqual([]);
    });
    it('failed transactions and failed child invocation cannot create executions', () => {
        const f=swapFixture();f.transaction.meta.err={failed:true};expect(verify(f)).toMatchObject({status:'FAILED',events:[]});
        f.transaction.meta.err=null;f.transaction.meta.logMessages[2]=f.transaction.meta.logMessages[2].replace('success','failed: rejected');
        expect(verify(f).events).toEqual([]);
    });
    it('Token-2022 transfer fees are excluded, including zero-net multi-execution transactions', () => {
        const f=arbitrageFixture({token2022:true});expect(verify(f).events).toHaveLength(2);
        f.transaction.meta.postTokenBalances[2].uiTokenAmount.amount=String(BigInt(f.transaction.meta.postTokenBalances[2].uiTokenAmount.amount)-1n);
        expect(verify(f).events).toEqual([]);
    });
    it('fees, rent and native wallet deltas are never quote amounts', () => {
        const f=swapFixture();const before=verify(f).events[0];
        f.transaction.meta.fee=2e8;f.transaction.meta.postBalances[0]=0;
        expect(verify(f).events[0]).toEqual(before);
        expect(activeTrade(verifyTransaction(f.transaction,f.signature,MINT).event)).toBe(false);
    });
    it('finalization and rejection reconcile every invocation without collapsing the signature', async () => {
        let now=10000;const f=arbitrageFixture({blockTime:10}),changes=[];let finalized=false;
        const service=createEvidenceIngestion({tokenMint:MINT,canonicalMarket:f.market,now:()=>now,onChange:e=>changes.push(e),
            rpc:async(method)=>method==='getTransaction'?f.transaction:{value:[finalized?{confirmationStatus:'finalized'}:{err:{failed:true}}]} });
        service.observeSignature(f.signature);await service.drain();expect(service.snapshot()).toHaveLength(2);
        now+=4000;await service.tick();expect(service.snapshot().every(e=>e.settlement==='REJECTED')).toBe(true);
        expect(calculatePressure(service.snapshot(),now).totalSol).toBe(0);service.destroy();
        finalized=true;const final=createEvidenceIngestion({tokenMint:MINT,canonicalMarket:f.market,now:()=>now,
            rpc:async(method)=>method==='getTransaction'?f.transaction:{value:[{confirmationStatus:'finalized'}]} });
        final.observeSignature(f.signature);await final.drain();now+=4000;await final.tick();await final.drain();
        expect(final.snapshot().map(e=>e.settlement)).toEqual(['FINALIZED','FINALIZED']);final.destroy();
    });
    it('a rebase destroys pending RPC callbacks and keeps the new market journal empty', async () => {
        const f=swapFixture();let release;
        const service=createEvidenceIngestion({tokenMint:MINT,canonicalMarket:f.market,rpc:()=>new Promise(r=>release=r)});
        service.observeSignature(f.signature);service.destroy();release(f.transaction);await service.drain();expect(service.snapshot()).toEqual([]);
        const next=createEvidenceIngestion({tokenMint:MINT,canonicalMarket:{...f.market,sourceEpoch:2},rpc:async()=>f.transaction});
        expect(next.snapshot()).toEqual([]);next.observeSignature(f.signature);await next.drain();expect(next.snapshot()[0].sourceEpoch).toBe(2);next.destroy();
    });
});
describe('public pool identity and retained real evidence', () => {
    it.each(['current-pumpswap','current-meteora-dlmm','current-orca-whirlpool','current-raydium-clmm','current-fresh-pumpswap'])(
        '%s agrees with independently cross-checked finalized vault deltas', name => {
            const s=JSON.parse(readFileSync(new URL('./fixtures/public-chain/'+name+'.json',import.meta.url)));
            const checks=JSON.parse(readFileSync(new URL('../docs/pool-crosschecks.json',import.meta.url))).find(c=>c.name===name);
            const e=verifyPoolExecutions(s.transaction,s.signature,s.market,'FINALIZED').events[0];
            const base=checks.vaultDeltas.find(d=>d.mint===e.tokenMint),quote=checks.vaultDeltas.find(d=>d.mint===e.quoteMint);
            expect(BigInt(base.rawDelta)).toBe(BigInt(e.rawTokenAmount)*(e.isBuy?-1n:1n));
            expect(BigInt(quote.rawDelta)).toBe(BigInt(e.rawQuoteAmount)*(e.isBuy?1n:-1n));
            expect(Object.values(checks.checks).every(Boolean)).toBe(true);
        });
    it.each(identities)('$market.protocol is verified from state and both vault identities', s => {
        const p=decodePoolIdentity(s.market.address,s.poolAccount,MINT,s.market.quoteMint);
        expect(verifyPoolVaults(p,s.vaultAccounts.value,s.vaultAccounts.context.slot)).toMatchObject({address:s.market.address,vaults:s.market.vaults});
        expect(()=>decodePoolIdentity(s.market.address,{...s.poolAccount,owner:SOL},MINT,s.market.quoteMint)).toThrow();
        const bad=structuredClone(s.vaultAccounts.value);bad[0].data=bad[1].data;
        expect(()=>verifyPoolVaults(p,bad,s.vaultAccounts.context.slot)).toThrow();
    });
    it.each(['pumpswap-4YquguNEKkyk.json','pumpswap-4hRRByUJeR5c.json','meteora-dlmm-doqiTDJ9hQ24.json'])('real direct/CPI/intermediate execution %s', file => {
        const tx=JSON.parse(readFileSync(new URL('./fixtures/public-chain/'+file,import.meta.url))).transaction;
        const market=identities[file.startsWith('meteora')?1:0].market;
        const r=verifyPoolExecutions(tx,tx.transaction.signatures[0],market);
        expect(r.events).toHaveLength(1);expect(r.events[0].isBuy).toBe(file.startsWith('meteora'));
        if(file.startsWith('meteora'))expect(r.events[0]).toMatchObject({rawQuoteAmount:'194917910',rawTokenAmount:expect.any(String),routeKind:'CPI'});
    });
    it('uses actual swap invocations, never account mentions, as verification denominator', () => {
        const f=swapFixture(), r=verify(f);
        const c=summarizePoolCoverage([{state:'CONFIRMED',poolResult:r},{poolResult:{status:'NON_SWAP',nonSwaps:4,executions:[]}},{poolResult:{status:'FAILED'}},{}]);
        expect(c).toMatchObject({mentions:4,fetched:3,actualSwapCandidates:1,verifiedExecutions:1,verifiedSwapFraction:1,pendingUnavailable:1,confidence:'DEGRADED'});
        expect(summarizePoolCoverage([{poolResult:{status:'NON_SWAP',executions:[]}}]).verifiedSwapFraction).toBeNull();
    });
});
