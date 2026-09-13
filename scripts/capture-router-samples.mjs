/* global fetch, AbortSignal, console, setTimeout, process */
// Bounded read-only mainnet sample, without success/direction selection.
import { mkdir, writeFile } from 'node:fs/promises';
const jupiterCohort = process.argv.includes('--jupiter');
const directory = jupiterCohort ? '.artifacts/jupiter-mainnet' : '.artifacts/router-mainnet';
const endpoint = 'https://api.mainnet-beta.solana.com';
const pools = jupiterCohort ? ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'] : ['FnzKY6x7entQ1eR3D225dQyT7ybfka4PskBMQhb8L3CC',
    '6e7V9eegCHw997T72MxgwwJipZ6GJyZF8NvjkzT1rvpN', 'CNTPTpytHK9txrsPCvaEnc3PoN9ZVWDDcSnFSZZonMue'];
await mkdir(directory, { recursive: true });
const manifest = { startedAt: new Date().toISOString(), endpoint, limitPerPool: 20, pools, candidates: [], errors: [] };
async function rpc(method, params) {
    await new Promise((resolve) => setTimeout(resolve, 3100));
    const r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(12000) });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(`RPC ${r.status} ${j.error?.code ?? ''}`);
    return j.result;
}
const seen = new Set();
for (const pool of pools) {
    try {
        const candidates = await rpc('getSignaturesForAddress', [pool, { limit: 20, commitment: 'finalized' }]);
        for (const candidate of candidates) {
            const row = { pool, ...candidate, duplicate: seen.has(candidate.signature) };
            manifest.candidates.push(row);
            if (row.duplicate) continue;
            seen.add(candidate.signature);
            try {
                const transaction = await rpc('getTransaction', [candidate.signature,
                    { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
                row.available = !!transaction;
                if (transaction) await writeFile(`${directory}/${candidate.signature}.json`, JSON.stringify({
                    source: endpoint, fetchedAt: new Date().toISOString(), signature: candidate.signature, pool, transaction }));
            } catch (e) { row.error = e.message; }
            await writeFile(`${directory}/manifest.json`, JSON.stringify(manifest, null, 2));
            console.log(JSON.stringify({ count: seen.size, signature: candidate.signature, available: row.available, error: row.error }));
        }
    } catch (e) { manifest.errors.push({ pool, error: e.message }); }
}
manifest.finishedAt = new Date().toISOString();
await writeFile(`${directory}/manifest.json`, JSON.stringify(manifest, null, 2));
