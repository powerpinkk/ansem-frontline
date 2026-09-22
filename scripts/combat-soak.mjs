/* global console */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
    COMBAT_POLICY,
    advanceCombatImpulse,
    advanceMeleeCombat,
    applyCombatImpulse,
    createChargeContactRegistry,
    createCombatState,
    createImpactPresentationController,
    registerChargeContact,
    resetCombatState,
    resolveCombatImpulse,
    stableContactNormal,
} from '../js/combat.js';

const AGENT_COUNT = 192;
const FPS = 60;
const SIMULATION_SECONDS = 600;
const FRAME_COUNT = FPS * SIMULATION_SECONDS;
const delta = 1 / FPS;

const financialTruth = Object.freeze({
    canonicalValuation: 250_000_000,
    authoritativeFrontierTarget: 31.75,
    sourceEpoch: 44,
    canonicalExecutionCount: 812,
    buyPressure: 19.4,
    sellPressure: 12.1,
    impactScore: 0.71,
});
const financialTruthBefore = JSON.stringify(financialTruth);
const agents = Array.from({ length: AGENT_COUNT }, (_, index) => ({
    identity: `agent-${index}`,
    mass: index % 24 === 0 ? 6.4 : index % 2 ? 1.35 : 1.2,
    combat: createCombatState({ archetype: index % 2 ? 'bear' : 'bull', seed: index + 1 }),
}));
const controller = createImpactPresentationController();
const initialSnapshot = makeImpactSnapshot('BULLISH', 44, 0);
controller.establishContext(initialSnapshot);

let hitEdges = 0;
let misses = 0;
let duplicateHits = 0;
let nonFinite = 0;
let maxImpulseSpeed = 0;
let maxQueueDepth = 0;
let maxRegistrySize = 0;
let reversals = 0;
let rebases = 0;
let tokenSwitches = 0;
const hitSequences = new Set();
let activePresentationUntil = 0;
const startedAt = performance.now();

for (let frame = 0; frame < FRAME_COUNT; frame++) {
    const now = frame * (1_000 / FPS);
    const phase = frame % 360;
    const inRange = phase < 292;
    for (let index = 0; index < agents.length; index++) {
        const agent = agents[index];
        const target = agents[(index + 1) % agents.length];
        const result = advanceMeleeCombat(agent.combat, {
            targetIdentity: target.identity,
            targetValid: true,
            distance: inRange ? 2.1 + (index % 3) * 0.08 : 4.5,
            enterRange: 2.6,
            leaveRange: 3.5,
            contactRange: 2.7,
            timingScale: 0.82 + (index % 5) * 0.07,
        }, delta);
        if (result.hit) {
            hitEdges += 1;
            const key = `${agent.identity}:${result.sequence}`;
            if (hitSequences.has(key)) duplicateHits += 1;
            hitSequences.add(key);
            const normal = stableContactNormal({
                sourceX: index % 7,
                sourceZ: index % 11,
                targetX: (index + 1) % 7,
                targetZ: (index + 1) % 11,
                seed: index,
            });
            const impulse = resolveCombatImpulse({
                directionX: normal.x,
                directionZ: normal.z,
                magnitude: index % 24 === 0 ? 11 : 4,
                attackerMass: agent.mass,
                defenderMass: target.mass,
                currentX: target.combat.impulseX,
                currentZ: target.combat.impulseZ,
            });
            maxImpulseSpeed = Math.max(maxImpulseSpeed, impulse.speed);
            applyCombatImpulse(target.combat, impulse);
        }
        if (result.miss) misses += 1;
        const impulse = advanceCombatImpulse(agent.combat, delta);
        if (!Number.isFinite(impulse.x) || !Number.isFinite(impulse.z)) nonFinite += 1;
    }

    if (frame > 0 && frame % 30 === 0) {
        const direction = (frame / 30) % 2 ? 'BEARISH' : 'BULLISH';
        const observation = controller.observe(makeImpactSnapshot(direction, 44, frame), now);
        if (observation.cancelActive) {
            reversals += 1;
            controller.cancelActive(now);
            activePresentationUntil = 0;
        }
        maxQueueDepth = Math.max(maxQueueDepth, controller.getDiagnostics(now).queueDepth);
        const active = controller.activatePending(now);
        if (active) {
            activePresentationUntil = now + 900;
            const registry = createChargeContactRegistry(active.maxContacts);
            for (let contact = 0; contact < 24; contact++) registerChargeContact(registry, `rank-${contact}`);
            maxRegistrySize = Math.max(maxRegistrySize, registry.hits.size);
        }
    }
    if (activePresentationUntil && now >= activePresentationUntil) {
        controller.completeActive(now);
        activePresentationUntil = 0;
    }
    if (frame > 0 && frame % 5_000 === 0) {
        rebases += 1;
        const rebase = controller.observe(makeImpactSnapshot('BULLISH', 44 + rebases, frame), now);
        if (rebase.cancelActive) controller.cancelActive(now);
        activePresentationUntil = 0;
    }
    if (frame > 0 && frame % 9_000 === 0) {
        tokenSwitches += 1;
        controller.reset();
        controller.establishContext({ tokenMint: `token-${tokenSwitches}`, sourceEpoch: 1 });
        for (const agent of agents) {
            resetCombatState(agent.combat, { archetype: agent.combat.archetype, seed: agent.combat.seed });
        }
        hitSequences.clear();
    }
    maxQueueDepth = Math.max(maxQueueDepth, controller.getDiagnostics(now).queueDepth);
}

const elapsedMs = performance.now() - startedAt;
assert.equal(duplicateHits, 0, 'one swing emitted duplicate hit edges');
assert.equal(nonFinite, 0, 'combat produced a non-finite impulse');
assert.ok(maxImpulseSpeed <= COMBAT_POLICY.maxImpulseSpeed, 'impulse exceeded its policy bound');
assert.ok(maxRegistrySize <= COMBAT_POLICY.maxHitRegistrySize, 'charge registry exceeded its policy bound');
assert.ok(maxQueueDepth <= 1, 'impact presentation backlog exceeded one latest request');
assert.equal(JSON.stringify(financialTruth), financialTruthBefore, 'combat mutated financial truth');
assert.ok(hitEdges > 100_000, 'soak did not exercise enough melee impacts');
assert.ok(reversals > 0 && rebases > 0 && tokenSwitches > 0, 'soak lifecycle coverage was incomplete');

console.log(JSON.stringify({
    scenario: 'm11.2-combat-soak',
    agents: AGENT_COUNT,
    simulatedSeconds: SIMULATION_SECONDS,
    frames: FRAME_COUNT,
    combatUpdates: AGENT_COUNT * FRAME_COUNT,
    hitEdges,
    misses,
    duplicateHits,
    reversals,
    rebases,
    tokenSwitches,
    maxImpulseSpeed,
    maxHitRegistrySize: maxRegistrySize,
    maxQueueDepth,
    nonFinite,
    financialTruthUnchanged: true,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    updatesPerMs: Number((AGENT_COUNT * FRAME_COUNT / elapsedMs).toFixed(2)),
}, null, 2));

function makeImpactSnapshot(direction, sourceEpoch, sequence) {
    return {
        tokenMint: 'token-a',
        status: 'LIVE',
        sourceEpoch,
        impact: {
            direction,
            category: sequence % 4 ? 'EXTREME' : 'SHOCK',
            score: sequence % 4 ? 0.76 : 0.94,
            verifiedExecutionCount: 8 + (sequence % 5),
            cause: 'TOKEN_NATIVE_MARKET_MOVE',
            clusterType: direction === 'BULLISH' ? 'CLUSTERED_BUY_WAVE' : 'CLUSTERED_SELL_WAVE',
            evidence: [`verified-${sequence}`],
        },
    };
}
