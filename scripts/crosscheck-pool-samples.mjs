/* global fetch, AbortSignal, setTimeout, console */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const names=['current-pumpswap','current-meteora-dlmm','current-orca-whirlpool','current-raydium-clmm','current-fresh-pumpswap'];
const results=[];
for(const name of names){
    const s=JSON.parse(readFileSync('tests/fixtures/public-chain/'+name+'.json'));
    const response=await fetch('https://api.mainnet-beta.solana.com',{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getTransaction',params:[s.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]}),signal:AbortSignal.timeout(12000)});
    const raw=(await response.json()).result;if(!raw)throw Error('Cross-check unavailable');
    const keys=[...raw.transaction.message.accountKeys,...(raw.meta.loadedAddresses?.writable||[]),...(raw.meta.loadedAddresses?.readonly||[])];
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    const checks={signature:raw.transaction.signatures[0]===s.signature,slot:raw.slot===s.transaction.slot,
        accounts:same(keys,s.transaction.transaction.message.accountKeys.map(k=>k.pubkey)),logs:same(raw.meta.logMessages,s.transaction.meta.logMessages),
        pre:same(raw.meta.preTokenBalances,s.transaction.meta.preTokenBalances),post:same(raw.meta.postTokenBalances,s.transaction.meta.postTokenBalances),failed:same(raw.meta.err,s.transaction.meta.err)};
    if(Object.values(checks).some(v=>!v))throw Error('Cross-check mismatch '+name);
    const vaultDeltas=s.market.vaults.map(v=>{
        const index=keys.indexOf(v),pre=raw.meta.preTokenBalances.find(b=>b.accountIndex===index),post=raw.meta.postTokenBalances.find(b=>b.accountIndex===index);
        return {vault:v,mint:pre.mint,decimals:pre.uiTokenAmount.decimals,rawDelta:String(BigInt(post.uiTokenAmount.amount)-BigInt(pre.uiTokenAmount.amount))};
    });
    results.push({name,signature:s.signature,slot:raw.slot,checkedAt:Date.now(),checks,vaultDeltas,
        method:'Separate finalized compiled read; independent static+ALT indexing and vault balance subtraction; no production decoder',
        sha256:createHash('sha256').update(JSON.stringify(raw)).digest('hex')});console.log(name,'PASS');
    await new Promise(r=>setTimeout(r,3400));
}
writeFileSync('docs/pool-crosschecks.json',JSON.stringify(results,null,2));
