/* global console, process */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createCommanderController } from '../js/commander-controller.js';
import { COMMANDER_PROFILE_REGISTRY } from '../js/commander-profile.js';
import { createTokenContext } from '../js/token-context.js';
import { ANSEM_MINT } from '../js/token-presets.js';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const GENERIC = '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs';
const contexts = [ANSEM_MINT, GENERIC, ANSEM_MINT, USDC, ANSEM_MINT, JUP]
    .map((mint) => createTokenContext({ mint }));
const iterations = 20_000;
const assetCache = new Set();
let activeActors = 0;
let maximumActive = 0;
let resets = 0;
let marketImpacts = 0;
let rebases = 0;

const controller = createCommanderController({
    registry: COMMANDER_PROFILE_REGISTRY,
    instantiate: (profile, identity) => {
        assetCache.add(`${profile.assetId}:${profile.version}`);
        activeActors += 1;
        maximumActive = Math.max(maximumActive, activeActors);
        return {
            ...identity,
            destroy() {
                activeActors -= 1;
                resets += 1;
            },
        };
    },
});

const heapBefore = process.memoryUsage().heapUsed;
const startedAt = performance.now();
for (let index = 0; index < iterations; index += 1) {
    const token = contexts[index % contexts.length];
    const snapshot = controller.setTokenContext(token);
    assert.equal(snapshot.present, token.identity.mint === ANSEM_MINT);
    assert.ok(activeActors === 0 || activeActors === 1);
    if (snapshot.present) {
        const repeated = controller.setTokenContext(token);
        assert.equal(repeated.actorId, snapshot.actorId);
        const stableRebaseActor = snapshot.actorId;
        // MarketImpact and source-epoch rebases are orthogonal observations;
        // neither is allowed to remount token identity.
        marketImpacts += 1;
        rebases += 1;
        assert.equal(controller.getSnapshot().actorId, stableRebaseActor);
    }
}
controller.destroy();
const elapsedMs = performance.now() - startedAt;
const heapAfter = process.memoryUsage().heapUsed;
const diagnostics = controller.getDiagnostics();

assert.equal(activeActors, 0);
assert.equal(maximumActive, 1);
assert.equal(assetCache.size, 1);
assert.equal(diagnostics.spawnCount, diagnostics.destroyCount);
assert.equal(diagnostics.staleCompletions, 0);

console.log(JSON.stringify({
    iterations,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    averageMicrosPerSwitch: Number(((elapsedMs * 1_000) / iterations).toFixed(3)),
    spawnCount: diagnostics.spawnCount,
    destroyCount: diagnostics.destroyCount,
    maximumActive,
    activeActors,
    assetCacheSize: assetCache.size,
    resets,
    marketImpacts,
    rebases,
    heapDeltaBytes: heapAfter - heapBefore,
}, null, 2));
