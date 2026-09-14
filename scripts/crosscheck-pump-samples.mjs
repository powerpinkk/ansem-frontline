/* global fetch, AbortSignal, setTimeout, console */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const names=['pump-curve-cgMX4NjunkUd','pump-curve-3rsYiLdMmhg4','pump-current-2YWDvuzevLrH','pump-current-3uTurnfFuFMj','pump-current-3Xu7LTsLZ6nC','pump-current-54FJGWyCYcFK'];
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
        pre:same(raw.meta.preTokenBalances,s.transaction.meta.preTokenBalances),post:same(raw.meta.postTokenBalances,s.transaction.meta.postTokenBalances),
        preLamports:same(raw.meta.preBalances,s.transaction.meta.preBalances),postLamports:same(raw.meta.postBalances,s.transaction.meta.postBalances),failed:same(raw.meta.err,s.transaction.meta.err)};
    if(Object.values(checks).some(v=>!v))throw Error('Cross-check mismatch '+name);
    const vaultDeltas=s.market.vaults.map((vault,i)=>{
        const index=keys.indexOf(vault);
        if(i===1&&vault===s.market.address)return {vault,mint:s.market.quoteMint,rawDelta:String(BigInt(raw.meta.postBalances[index])-BigInt(raw.meta.preBalances[index])),native:true};
        const pre=raw.meta.preTokenBalances.find(b=>b.accountIndex===index),post=raw.meta.postTokenBalances.find(b=>b.accountIndex===index);
        return {vault,mint:pre.mint,decimals:pre.uiTokenAmount.decimals,rawDelta:String(BigInt(post.uiTokenAmount.amount)-BigInt(pre.uiTokenAmount.amount))};
    });
    results.push({name,signature:s.signature,slot:raw.slot,checkedAt:Date.now(),checks,vaultDeltas,
        method:'Separate finalized compiled read; independent static+ALT indexing, token-vault and curve-lamport subtraction; no production decoder',
        sha256:createHash('sha256').update(JSON.stringify(raw)).digest('hex')});console.log(name,'PASS');
    await new Promise(r=>setTimeout(r,3400));
}
writeFileSync('docs/pump-crosschecks.json',JSON.stringify(results,null,2));
