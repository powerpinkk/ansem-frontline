/* global fetch, AbortSignal, setTimeout, console */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const files = ['pumpswap-4YquguNEKkyk', 'meteora-dlmm-doqiTDJ9hQ24', 'jupiter-2ZfyGQ1Znbti', 'jupiter-5TMkJvPGVbaT'];
const results = [];
for (const file of files) {
    const sample = JSON.parse(await readFile(`tests/fixtures/public-chain/${file}.json`, 'utf8'));
    await new Promise((resolve) => setTimeout(resolve, 3100));
    const r = await fetch('https://api.mainnet-beta.solana.com', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [sample.signature,
            { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 0 }] }), signal: AbortSignal.timeout(12000) });
    const payload = await r.json(); const raw = payload.result;
    if (!r.ok || !raw) throw new Error(`Cross-check RPC ${r.status} ${payload.error?.code}`);
    const keys = [...raw.transaction.message.accountKeys, ...(raw.meta.loadedAddresses?.writable || []), ...(raw.meta.loadedAddresses?.readonly || [])];
    const expected = sample.transaction;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const checks = { slot: raw.slot === expected.slot, signatures: same(raw.transaction.signatures, expected.transaction.signatures),
        resolvedKeys: same(keys, expected.transaction.message.accountKeys.map((k) => k.pubkey)),
        preTokenBalances: same(raw.meta.preTokenBalances, expected.meta.preTokenBalances),
        postTokenBalances: same(raw.meta.postTokenBalances, expected.meta.postTokenBalances),
        logs: same(raw.meta.logMessages, expected.meta.logMessages), failedStatus: same(raw.meta.err, expected.meta.err) };
    if (Object.values(checks).some((c) => !c)) throw new Error(`Cross-check mismatch ${file}`);
    results.push({ file, signature: sample.signature, slot: raw.slot, checkedAt: new Date().toISOString(),
        method: 'Independent compiled JSON read vs captured jsonParsed; static + writable + readonly, without production resolver',
        checks, loadedWritable: raw.meta.loadedAddresses?.writable.length || 0, loadedReadonly: raw.meta.loadedAddresses?.readonly.length || 0,
        compiledResponseSha256: createHash('sha256').update(JSON.stringify(raw)).digest('hex') });
    console.log(file, 'PASS');
}
await writeFile('docs/router-crosschecks.json', JSON.stringify(results, null, 2));
