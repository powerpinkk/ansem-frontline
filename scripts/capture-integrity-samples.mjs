/* global URL, setTimeout, fetch, AbortSignal, console */
// Read-only, bounded public-chain capture. Output is ignored, never a live feed.
import { mkdir, writeFile } from 'node:fs/promises';

const endpoint = 'https://api.mainnet-beta.solana.com';
const pools = [
    ['pumpswap', 'FnzKY6x7entQ1eR3D225dQyT7ybfka4PskBMQhb8L3CC'],
    ['meteora-dlmm', '6e7V9eegCHw997T72MxgwwJipZ6GJyZF8NvjkzT1rvpN'],
    ['orca-whirlpool', 'CNTPTpytHK9txrsPCvaEnc3PoN9ZVWDDcSnFSZZonMue'],
];
const directory = new URL('../.artifacts/integrity/', import.meta.url);
await mkdir(directory, { recursive: true });
async function rpc(method, params) {
    await new Promise((resolve) => setTimeout(resolve, 2800));
    const r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(12_000) });
    if (!r.ok) throw new Error(`Public RPC HTTP ${r.status}`);
    const payload = await r.json();
    if (payload.error) throw new Error(`Public RPC ${payload.error.code}: ${payload.error.message}`);
    return payload.result;
}
for (const [protocol, poolAddress] of pools) {
    const account = await rpc('getAccountInfo', [poolAddress, { encoding: 'base64', commitment: 'finalized' }]);
    const signatures = await rpc('getSignaturesForAddress', [poolAddress, { limit: 8, commitment: 'finalized' }]);
    for (const item of signatures.filter((s) => !s.err).slice(0, 8)) {
        const transaction = await rpc('getTransaction', [item.signature, { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
        if (!transaction) continue;
        const sample = { fetchedAt: new Date().toISOString(), source: endpoint, protocol, poolAddress,
            owner: account.value?.owner, signature: item.signature, transaction };
        await writeFile(new URL(`${protocol}-${item.signature.slice(0, 12)}.json`, directory), JSON.stringify(sample, null, 2));
        console.log(JSON.stringify({ protocol, signature: item.signature, slot: transaction.slot, poolAddress, owner: account.value?.owner }));
    }
}
