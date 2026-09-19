/* global fetch, AbortSignal, console */
// Read-only drift check. A changed hash requires review; never update production
// instruction tables automatically from an RPC response.
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
const pinned = JSON.parse(await readFile('docs/jupiter-idl-provenance.json', 'utf8'));
const r = await fetch(pinned.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [pinned.address,
        { encoding: 'base64', commitment: 'finalized' }] }), signal: AbortSignal.timeout(12000) });
const j = await r.json();
if (!r.ok || j.result?.value?.owner !== pinned.owner) throw new Error('IDL account unavailable or owner mismatch');
const b = Buffer.from(j.result.value.data[0], 'base64');
const bytes = inflateSync(b.subarray(44, 44 + b.readUInt32LE(40)));
const hash = createHash('sha256').update(bytes).digest('hex');
console.log(JSON.stringify({ slot: j.result.context.slot, expected: pinned.sha256, actual: hash, matches: hash === pinned.sha256 }));
if (hash !== pinned.sha256) throw new Error('IDL_DRIFT_REQUIRES_REVIEW');
