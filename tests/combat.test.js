import { describe, expect, it } from 'vitest';
import {
    COMBAT_POLICY,
    COMBAT_STATE,
    advanceCombatImpulse,
    advanceMeleeCombat,
    applyCombatImpulse,
    combatPresentationMass,
    createChargeContactRegistry,
    createCombatState,
    createImpactPresentationController,
    deriveBullChargeProfile,
    isLegalCombatTransition,
    mapMarketImpactToPresentation,
    pointToSegmentDistanceSquared,
    registerChargeContact,
    resetChargeContactRegistry,
    resetCombatState,
    resolveCombatImpulse,
    sampleCombatPose,
    stableContactNormal,
    sweptCircleIntersects,
} from '../js/combat.js';

function impactSnapshot(overrides = {}) {
    const impact = {
        direction: 'BULLISH',
        category: 'SHOCK',
        score: 0.94,
        verifiedExecutionCount: 12,
        cause: 'TOKEN_NATIVE_MARKET_MOVE',
        clusterType: 'CLUSTERED_BUY_WAVE',
        evidence: ['swap-1'],
        ...overrides.impact,
    };
    return {
        tokenMint: 'token-a',
        status: 'LIVE',
        sourceEpoch: 7,
        ...overrides,
        impact,
    };
}

function simulateMelee(fps, seconds = 3) {
    const state = createCombatState({ archetype: 'bear', seed: 4 });
    const states = new Set([state.state]);
    let edgeHits = 0;
    for (let frame = 0; frame < fps * seconds; frame++) {
        const result = advanceMeleeCombat(state, {
            targetIdentity: 'bull-a',
            targetValid: true,
            distance: 2,
            enterRange: 2.5,
            leaveRange: 3.4,
            contactRange: 2.6,
        }, 1 / fps);
        if (result.hit) edgeHits += 1;
        states.add(state.state);
    }
    return { state, edgeHits, states };
}

describe('giant bull charge', () => {
    it('uses swept collision so a low-FPS movement step cannot tunnel through a bear', () => {
        const collision = sweptCircleIntersects({
            pointX: 4,
            pointZ: 1.4,
            startX: -3,
            startZ: 0,
            endX: 11,
            endZ: 0,
            radius: 1.5,
        });
        expect(collision).toMatchObject({ hit: true });
        expect(collision.entryProjection).toBeGreaterThan(0);
        expect(collision.entryProjection).toBeLessThan(collision.projection);
        expect(sweptCircleIntersects({
            pointX: 4,
            pointZ: 2.1,
            startX: -3,
            startZ: 0,
            endX: 11,
            endZ: 0,
            radius: 1.5,
        })).toMatchObject({ hit: false });
    });

    it('orders impacts along the finite charge path', () => {
        const before = pointToSegmentDistanceSquared(-5, 0, 0, 0, 10, 0);
        const middle = pointToSegmentDistanceSquared(4, 0, 0, 0, 10, 0);
        const after = pointToSegmentDistanceSquared(14, 0, 0, 0, 10, 0);
        expect(before.projection).toBe(0);
        expect(middle.projection).toBeCloseTo(0.4);
        expect(after.projection).toBe(1);
        expect(after.distanceSquared).toBe(16);
    });

    it('requires a verified giant buy and suppresses charges under strong sell pressure', () => {
        expect(deriveBullChargeProfile({ solValue: 19.99, balance: 0.8 }).enabled).toBe(false);
        expect(deriveBullChargeProfile({ solValue: 40, balance: -0.7, flowIntensity: 1 }).enabled).toBe(false);
        expect(deriveBullChargeProfile({ solValue: 40, balance: 0.08, flowIntensity: 1 }).enabled).toBe(false);
        expect(deriveBullChargeProfile({ solValue: 40, balance: 0.4, flowIntensity: 0.8 }).enabled).toBe(true);
    });

    it('makes a high-volume buy wave more forceful without unbounded collisions', () => {
        const quiet = deriveBullChargeProfile({ solValue: 20, balance: 0.05, flowIntensity: 0.1, power: 1 });
        const surge = deriveBullChargeProfile({ solValue: 80, balance: 0.7, flowIntensity: 1, power: 1 });
        expect(surge.speed).toBeGreaterThan(quiet.speed);
        expect(surge.damage).toBeGreaterThan(quiet.damage);
        expect(surge.rankCapacity).toBeGreaterThan(quiet.rankCapacity);
        expect(surge.maxConcurrent).toBe(3);
        expect(surge.rankCapacity).toBeLessThanOrEqual(9);
    });
});

describe('deterministic melee combat', () => {
    it('follows the legal bear windup, active swipe, impact and recovery sequence', () => {
        const state = createCombatState({ archetype: 'bear', seed: 11 });
        expect(advanceMeleeCombat(state, {
            targetIdentity: 'bull-a', targetValid: true, distance: 5,
            enterRange: 2.5, leaveRange: 3.4, contactRange: 2.6,
        }, 1 / 60).state).toBe(COMBAT_STATE.APPROACH);
        advanceMeleeCombat(state, {
            targetIdentity: 'bull-a', targetValid: true, distance: 2,
            enterRange: 2.5, leaveRange: 3.4, contactRange: 2.6,
        }, 0);
        expect(state.state).toBe(COMBAT_STATE.WINDUP);
        advanceMeleeCombat(state, {
            targetIdentity: 'bull-a', targetValid: true, distance: 2,
            enterRange: 2.5, leaveRange: 3.4, contactRange: 2.6,
        }, COMBAT_POLICY.bear.windup * 0.6);
        const pose = sampleCombatPose(state, {});
        expect(pose.bodyY).toBeGreaterThan(0.25);
        expect(pose.frontLeft).toBeLessThan(-0.2);

        const visited = new Set([state.state]);
        let hits = 0;
        for (let frame = 0; frame < 180 && state.sequence === 1; frame++) {
            const result = advanceMeleeCombat(state, {
                targetIdentity: 'bull-a', targetValid: true, distance: 2,
                enterRange: 2.5, leaveRange: 3.4, contactRange: 2.6,
                canAttack: !visited.has(COMBAT_STATE.RECOVERY),
            }, 1 / 120);
            visited.add(state.state);
            if (result.hit) hits += 1;
            if (state.state === COMBAT_STATE.APPROACH) break;
        }
        expect([...visited]).toEqual(expect.arrayContaining([
            COMBAT_STATE.WINDUP, COMBAT_STATE.ACTIVE, COMBAT_STATE.IMPACT, COMBAT_STATE.RECOVERY, COMBAT_STATE.APPROACH,
        ]));
        expect(hits).toBe(1);
        expect(state.totalHits).toBe(1);
        expect(state.invalidTransitions).toBe(0);
        expect(isLegalCombatTransition(COMBAT_STATE.APPROACH, COMBAT_STATE.IMPACT)).toBe(false);
        expect(isLegalCombatTransition(COMBAT_STATE.ACTIVE, COMBAT_STATE.IMPACT)).toBe(true);
    });

    it('misses when the target leaves hysteresis range and never emits a hit', () => {
        const state = createCombatState({ archetype: 'bear' });
        advanceMeleeCombat(state, {
            targetIdentity: 'bull-a', targetValid: true, distance: 2,
            enterRange: 2.5, leaveRange: 3.4, contactRange: 2.6,
        }, COMBAT_POLICY.bear.windup * 0.6);
        const result = advanceMeleeCombat(state, {
            targetIdentity: 'bull-a', targetValid: true, distance: 3.6,
            enterRange: 2.5, leaveRange: 3.4, contactRange: 2.6,
        }, 1 / 60);
        expect(result).toMatchObject({ hit: false, miss: true, state: COMBAT_STATE.RECOVERY });
        expect(state.totalHits).toBe(0);
        expect(state.totalMisses).toBe(1);
        expect(state.knockbacks).toBe(0);
    });

    it('emits only one hit edge while a target overlaps the entire active window', () => {
        const { state, edgeHits } = simulateMelee(120, 1.05);
        expect(edgeHits).toBe(1);
        expect(state.totalHits).toBe(1);
    });

    it('keeps attack cadence equivalent at 30, 60 and 120 fps', () => {
        const runs = [30, 60, 120].map((fps) => simulateMelee(fps));
        expect(new Set(runs.map((run) => run.edgeHits)).size).toBe(1);
        expect(runs[0].edgeHits).toBeGreaterThan(1);
        for (const run of runs) {
            expect(run.states.has(COMBAT_STATE.ACTIVE)).toBe(true);
            expect(run.states.has(COMBAT_STATE.IMPACT)).toBe(true);
            expect(run.state.invalidTransitions).toBe(0);
        }
    });

    it('clears attacks, hit reactions and impulses when a pooled unit is reset', () => {
        const state = createCombatState({ archetype: 'bear', seed: 8 });
        advanceMeleeCombat(state, {
            targetIdentity: 'bull-a', targetValid: true, distance: 1,
            enterRange: 2.5, leaveRange: 3.4, contactRange: 2.6,
        }, 0.5);
        applyCombatImpulse(state, { x: 4, z: -2 });
        resetCombatState(state, { archetype: 'bull', seed: 91 });
        expect(state).toMatchObject({
            archetype: 'bull', seed: 91, state: COMBAT_STATE.APPROACH,
            targetIdentity: null, totalHits: 0, impulseX: 0, impulseZ: 0, hitReactionTime: 0,
        });
    });
});

describe('bounded combat impulse physics', () => {
    it('displaces a small troop more than a giant under the same impulse', () => {
        const attackerMass = combatPresentationMass({ isWhale: true, archetype: 'bull' });
        const small = resolveCombatImpulse({ directionX: 1, magnitude: 4, attackerMass, defenderMass: 1.2 });
        const giant = resolveCombatImpulse({ directionX: 1, magnitude: 4, attackerMass, defenderMass: 8 });
        expect(small.x).toBeGreaterThan(giant.x);
        expect(giant.x).toBeGreaterThan(0);
    });

    it('clamps extreme and non-finite inputs and decays safely', () => {
        const impulse = resolveCombatImpulse({ directionX: 1, directionZ: 1, magnitude: Number.POSITIVE_INFINITY, attackerMass: 999, defenderMass: 0 });
        expect(impulse.speed).toBeLessThanOrEqual(COMBAT_POLICY.maxImpulseSpeed);
        expect(Number.isFinite(impulse.x)).toBe(true);
        const state = createCombatState();
        expect(applyCombatImpulse(state, impulse)).toBe(true);
        for (let index = 0; index < 300; index++) advanceCombatImpulse(state, 1 / 60);
        expect(state).toMatchObject({ impulseX: 0, impulseZ: 0, hitReactionTime: 0 });
        expect(applyCombatImpulse(state, { x: Number.NaN, z: 1 })).toBe(false);
        expect(state.nonFinite).toBe(1);
    });

    it('returns finite deterministic normals for axial, diagonal and exact-overlap contacts', () => {
        expect(stableContactNormal({ sourceX: 0, sourceZ: 0, targetX: 4, targetZ: 0 })).toEqual({ x: 1, z: 0 });
        const diagonal = stableContactNormal({ sourceX: 0, sourceZ: 0, targetX: 2, targetZ: 2 });
        expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(1);
        const overlapA = stableContactNormal({ sourceX: 2, sourceZ: 2, targetX: 2, targetZ: 2, seed: 19 });
        const overlapB = stableContactNormal({ sourceX: 2, sourceZ: 2, targetX: 2, targetZ: 2, seed: 19 });
        expect(overlapA).toEqual(overlapB);
        expect(Math.hypot(overlapA.x, overlapA.z)).toBeCloseTo(1);
    });
});

describe('charge contacts and MarketImpact presentation', () => {
    it('registers each crossed enemy once and bounds a multi-enemy charge registry', () => {
        const registry = createChargeContactRegistry(3);
        const crossed = ['a', 'b', 'c', 'd'].filter((identity, index) => {
            const contact = sweptCircleIntersects({
                pointX: 2 + index * 2, pointZ: 0, startX: 0, startZ: 0, endX: 12, endZ: 0, radius: 1,
            });
            return contact.hit && registerChargeContact(registry, identity);
        });
        expect(crossed).toEqual(['a', 'b', 'c']);
        expect(registerChargeContact(registry, 'a')).toBe(false);
        expect(registry.hits.size).toBe(3);
        expect(registry.rejected).toBe(1);
        resetChargeContactRegistry(registry);
        expect(registry.hits.size).toBe(0);
    });

    it.each([
        ['NORMAL', false, 0], ['STRONG', false, 0], ['EXTREME', true, 6], ['SHOCK', true, 10],
    ])('maps %s without changing the canonical impact score', (category, majorCharge, contacts) => {
        const snapshot = impactSnapshot({ impact: { category, score: 0.61 } });
        const before = JSON.stringify(snapshot);
        const mapped = mapMarketImpactToPresentation(snapshot.impact, snapshot);
        expect(mapped).toMatchObject({ category, majorCharge, maxContacts: contacts, score: 0.61 });
        expect(JSON.stringify(snapshot)).toBe(before);
    });

    it('rejects FX, degraded, unverified and initialization impacts', () => {
        const base = impactSnapshot();
        expect(mapMarketImpactToPresentation({ ...base.impact, cause: 'QUOTE_FX_MOVE' }, base)).toBeNull();
        expect(mapMarketImpactToPresentation(base.impact, { ...base, status: 'DEGRADED' })).toBeNull();
        expect(mapMarketImpactToPresentation({ ...base.impact, verifiedExecutionCount: 0 }, base)).toBeNull();
        expect(mapMarketImpactToPresentation(base.impact, { ...base, initializing: true })).toBeNull();
    });

    it('suppresses the attached historical impact and does not treat a missing epoch as a rebase', () => {
        const controller = createImpactPresentationController();
        const historical = impactSnapshot();
        controller.establishContext(historical);
        expect(controller.observe(historical, 1_000)).toMatchObject({ accepted: false, cancelActive: false });
        expect(controller.getDiagnostics(1_000).queueDepth).toBe(0);

        const live = impactSnapshot({ impact: { evidence: ['swap-2'] } });
        expect(controller.observe(live, 1_100).accepted).toBe(true);
        controller.activatePending(1_100);
        expect(controller.observe({ tokenMint: 'token-a', status: 'WAITING', sourceEpoch: null }, 1_150))
            .toMatchObject({ accepted: false, cancelActive: false });
        expect(controller.getDiagnostics(1_150).active.direction).toBe('BULLISH');
    });

    it('cancels an obsolete bullish charge and keeps only the latest bearish request', () => {
        const controller = createImpactPresentationController();
        const bullish = impactSnapshot();
        controller.establishContext({ tokenMint: bullish.tokenMint, sourceEpoch: bullish.sourceEpoch });
        expect(controller.observe(bullish, 1_000).accepted).toBe(true);
        expect(controller.activatePending(1_000)?.direction).toBe('BULLISH');
        const bearish = impactSnapshot({ impact: {
            direction: 'BEARISH', evidence: ['swap-2'], clusterType: 'CLUSTERED_SELL_WAVE',
        } });
        expect(controller.observe(bearish, 1_050)).toMatchObject({ accepted: true, cancelActive: true });
        expect(controller.cancelActive(1_050)?.direction).toBe('BULLISH');
        expect(controller.peekPending(1_050)?.direction).toBe('BEARISH');
        expect(controller.getDiagnostics(1_050)).toMatchObject({ queueDepth: 1, superseded: 1 });
    });

    it('bounds an impact flood to one active request and one latest pending request', () => {
        const controller = createImpactPresentationController();
        controller.establishContext({ tokenMint: 'token-a', sourceEpoch: 7 });
        for (let index = 0; index < 200; index++) {
            controller.observe(impactSnapshot({ impact: {
                direction: index % 2 ? 'BEARISH' : 'BULLISH',
                evidence: [`swap-${index}`],
            } }), 2_000 + index);
        }
        const diagnostics = controller.getDiagnostics(2_250);
        expect(diagnostics.queueDepth).toBe(1);
        expect(diagnostics.active).toBeNull();
        expect(diagnostics.pending.direction).toBe('BEARISH');
        expect(diagnostics.superseded + diagnostics.coalesced).toBe(199);
    });

    it('treats source rebase and token switch as context changes, not new impacts', () => {
        const controller = createImpactPresentationController();
        const initial = impactSnapshot();
        controller.establishContext({ tokenMint: initial.tokenMint, sourceEpoch: initial.sourceEpoch });
        controller.observe(initial, 1_000);
        controller.activatePending(1_000);
        const rebase = controller.observe(impactSnapshot({ sourceEpoch: 8 }), 1_100);
        expect(rebase).toMatchObject({ accepted: false, cancelActive: true, contextChanged: true });
        controller.cancelActive(1_100);
        expect(controller.getDiagnostics(1_100).queueDepth).toBe(0);
        const tokenSwitch = controller.observe(impactSnapshot({ tokenMint: 'token-b', sourceEpoch: 1 }), 1_200);
        expect(tokenSwitch).toMatchObject({ accepted: false, contextChanged: true });
        expect(controller.getDiagnostics(1_200)).toMatchObject({ queueDepth: 0, contextTokenMint: 'token-b', contextSourceEpoch: 1 });
        controller.reset();
        expect(controller.getDiagnostics()).toMatchObject({ queueDepth: 0, active: null, contextTokenMint: null });
    });
});
