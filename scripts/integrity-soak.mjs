/* global console, setTimeout */
// Test-only transport and clock. Never connected to the product or a provider.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createEvidenceIngestion } from '../worker/src/evidence-ingestion.js';
import { calculatePressure } from '../js/market.js';
import { swapFixture, base58, MINT, USDC, SOL } from '../tests/fixtures/integrity.js';
import { routerFixture } from '../tests/fixtures/router.js';

const mints = [MINT, USDC, 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', SOL];
let now = Date.now(); let reads = 0; let updates = 0; let cycles = 0; let highWater = 0;
const fixtures = new Map();
const services = mints.map((tokenMint) => createEvidenceIngestion({ tokenMint, now: () => now,
    onChange: () => { updates += 1; }, rpc: async (method, params) => {
        reads += 1;
        if (method === 'getSignatureStatuses') return { value: params[0].map(() => ({ confirmationStatus: 'finalized', err: null })) };
        return fixtures.get(params[0]);
    } }));
const deadline = Date.now() + 60_000;
while (Date.now() < deadline) {
    now += 4000;
    for (let i = 0; i < services.length; i += 1) {
        const signature = base58(createHash('sha512').update(`${cycles}:${i}`).digest());
        const f = i < 3 ? routerFixture({ mint: mints[i], signature, shared: true,
            split: cycles % 2 === 0, multiHop: i !== 1 && cycles % 2 !== 0,
            blockTime: Math.floor(now / 1000), isBuy: cycles % 2 === 0 }) : swapFixture({ mint: mints[i], quoteMint: USDC, signature,
            blockTime: Math.floor(now / 1000), slot: cycles * 4 + i, isBuy: cycles % 2 === 0 });
        fixtures.set(signature, f.transaction);
        const service = services[i];
        assert.equal(service.observeSignature(signature), true);
        for (let replay = 0; replay < 20; replay += 1) assert.equal(service.observeSignature(signature), false);
        await service.drain(); await service.tick(); await service.drain();
        const events = service.snapshot();
        assert(events.some((e) => e.signature === signature), 'new shared/direct route must be verified');
        assert(events.every((e) => e.tokenMint === mints[i] && e.settlement === 'FINALIZED'));
        assert.equal(new Set(events.map((e) => e.id)).size, events.length);
        assert(Number.isFinite(calculatePressure(events, now).totalSol));
        const d = service.diagnostics(); highWater = Math.max(highWater, d.records);
        assert(d.records <= 1024 && d.running <= 2 && d.pendingReconciliations === 0);
    }
    fixtures.clear(); cycles += 1;
    await new Promise((resolve) => setTimeout(resolve, 50));
}
for (const s of services) { s.destroy(); assert.equal(s.snapshot().length, 0); }
console.log(JSON.stringify({ testOnly: true, realDurationSeconds: 60, virtualHours: cycles * 4 / 3600,
    tokens: services.length, cycles, replayDeliveries: cycles * 4 * 20, rpcReads: reads, updates, highWater, teardown: 'empty' }));
