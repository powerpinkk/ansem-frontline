/* global WebSocket, setTimeout, clearTimeout, fetch, AbortSignal, console */
// Public, fixed-address, bounded acquisition probe. No inference of swap counts.
import { writeFileSync } from 'node:fs';
const address='FnzKY6x7entQ1eR3D225dQyT7ybfka4PskBMQhb8L3CC', windows=[];
for(let attempt=0;attempt<2;attempt++){
    const result=await new Promise(resolve=>{
        const result={attempt,startedAt:Date.now(),acknowledged:false,mentions:[]};
        const socket=new WebSocket('wss://api.mainnet-beta.solana.com');
        const timer=setTimeout(()=>{socket.close();resolve({...result,endedAt:Date.now()});},20000);
        socket.addEventListener('open',()=>socket.send(JSON.stringify({jsonrpc:'2.0',id:1,method:'logsSubscribe',params:[{mentions:[address]},{commitment:'confirmed'}]})));
        socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id===1)result.acknowledged=Number.isInteger(m.result);
            if(m.method==='logsNotification'&&result.mentions.length<256)result.mentions.push({slot:m.params.result.context.slot,signature:m.params.result.value.signature,failed:!!m.params.result.value.err});});
        socket.addEventListener('error',()=>{clearTimeout(timer);socket.close();resolve({...result,error:'PUBLIC_WEBSOCKET_UNAVAILABLE',endedAt:Date.now()});});
    });windows.push(result);console.log('window',attempt,result.acknowledged,result.mentions.length,result.error||'');
}
const payload=await(await fetch('https://api.mainnet-beta.solana.com',{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(12000),body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getSignaturesForAddress',params:[address,{commitment:'confirmed',limit:12}]})})).json();
const history=payload.result||[], unique=new Set([...windows.flatMap(w=>w.mentions),...history].map(r=>r.signature));
writeFileSync('docs/pool-acquisition-probe.json',JSON.stringify({address,windows,history,historyError:payload.error||null,uniqueMentions:unique.size,historyPageFull:history.length===12,swapDenominator:null,scope:'ACQUISITION_ONLY_NOT_EXECUTION_VERIFICATION'},null,2));
