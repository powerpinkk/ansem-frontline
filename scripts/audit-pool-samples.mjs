/* global console */
// Offline audit of the explicitly captured bounded cohort. No product imports of
// fixtures/artifacts; public transaction mentions are not the swap denominator.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { verifyPoolExecutions, classifyPoolInstruction } from '../worker/src/pool-executions.js';
import { resolveTransactionAccounts } from '../worker/src/transaction-accounts.js';
const dir='.artifacts/pool-truth';
const read=f=>JSON.parse(readFileSync(dir+'/'+f));
const cohorts=read('cohorts.json');
const result={observedAt:Date.now(),scope:'BOUNDED_ADDRESS_MENTIONS; NO MARKET-WIDE COVERAGE CLAIM',cohorts:[],fresh:[]};
for(const c of cohorts){
    const records=c.records.map(r=>{
        if(!r.available)return r;
        const tx=read(r.file),v=verifyPoolExecutions(tx,r.signature,c.market);
        return {...r,slot:tx.slot,blockTime:tx.blockTime,sha256:createHash('sha256').update(JSON.stringify(tx)).digest('hex'),
            status:v.status,reason:v.reason,nonSwaps:v.nonSwaps||0,unclassified:v.unclassified||0,executions:v.executions,
            events:v.events.map(e=>({id:e.id,isBuy:e.isBuy,rawTokenAmount:e.rawTokenAmount,rawQuoteAmount:e.rawQuoteAmount,invocationPath:e.invocationPath,routeKind:e.routeKind}))};
    });
    const swapCandidates=records.flatMap(r=>r.executions||[]).length,verified=records.flatMap(r=>r.events||[]).length;
    const summary={market:c.market,observedAt:c.observedAt,limit:c.limit,acquisitionPageFull:c.signatures.length===c.limit,
        mentions:c.records.length,available:records.filter(r=>r.available).length,failed:records.filter(r=>r.status==='FAILED').length,
        nonSwapTransactions:records.filter(r=>r.status==='NON_SWAP').length,actualSwapCandidates:swapCandidates,verifiedExecutions:verified,
        verifiedSwapFraction:swapCandidates?verified/swapCandidates:null,minSlot:Math.min(...records.filter(r=>r.slot).map(r=>r.slot)),maxSlot:Math.max(...records.filter(r=>r.slot).map(r=>r.slot)),records};
    result.cohorts.push(summary);
    const representative=records.find(r=>r.events?.length);
    if(representative)writeFileSync('tests/fixtures/public-chain/current-'+c.market.protocol+'.json',JSON.stringify({market:c.market,signature:representative.signature,transaction:read(representative.file)},null,2));
}
for(const s of read('fresh-amm.json')){
    const v=verifyPoolExecutions(s.tx,s.signature,s.market);
    result.fresh.push({market:s.market,signature:s.signature,observedAt:s.observedAt,providerPairCreatedAt:s.pairCreatedAt,
        providerPoolAgeHours:s.ageHours,actualSwapCandidates:v.executions.length,verifiedExecutions:v.events.length,
        sha256:createHash('sha256').update(JSON.stringify(s.tx)).digest('hex'),poolAccount:s.poolAccount,vaultAccounts:s.vaultAccounts});
}
const latest=read('fresh-amm.json').at(-1);
writeFileSync('tests/fixtures/public-chain/current-fresh-pumpswap.json',JSON.stringify({market:latest.market,signature:latest.signature,transaction:latest.tx},null,2));
const curves=read('curve-cohort.json');
result.curve={mentions:curves.records.length,failedTransactions:0,successfulSwapCandidates:0,verifiedExecutions:0,records:[]};
for(const r of curves.records){if(!r.file)continue;const tx=read(r.file);const ix=resolveTransactionAccounts(tx.transaction.message,tx.meta).groups.flat()
    .filter(i=>i.programId==='6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P').map(classifyPoolInstruction);
    if(tx.meta.err)result.curve.failedTransactions++;else result.curve.successfulSwapCandidates+=ix.filter(i=>i.kind==='SWAP').length;
    result.curve.records.push({...r,slot:tx.slot,blockTime:tx.blockTime,failed:!!tx.meta.err,instructions:ix,sha256:createHash('sha256').update(JSON.stringify(tx)).digest('hex')});}
result.curve.states=read('curve-states.json');result.graduation=read('graduation-proofs.json');
result.freshSelections=read('fresh-selection.json').map(({mint,observedAt,executedPool,selection,canonicalMatches})=>({mint,observedAt,executedPool,selection,canonicalMatches}));
writeFileSync('docs/pool-mainnet-samples.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result.cohorts.map(({market,mentions,failed,nonSwapTransactions,actualSwapCandidates,verifiedExecutions})=>({protocol:market.protocol,mentions,failed,nonSwapTransactions,actualSwapCandidates,verifiedExecutions}))));
