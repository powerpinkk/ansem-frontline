import { describe, expect, it, vi } from 'vitest';
import { createChampionController } from '../js/champion-controller.js';
import { createChampionPolicy } from '../js/champion-policy.js';
import { inactiveChampionState } from '../js/champion-state.js';
import { acceptChampionMessage, sanitizeChampionSnapshot } from '../js/champion-sync.js';

const ANSEM = '9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';

describe('User Champion lifecycle', () => {
    it('starts inactive and keeps canonical state separate from TokenContext', () => {
        const harness = controllerHarness();
        const tokenContext = Object.freeze({ identity: Object.freeze({ mint: ANSEM, symbol: 'ANSEM' }) });
        harness.controller.setActiveMint(ANSEM);
        expect(harness.controller.getSnapshot()).toMatchObject({ status: 'inactive', mint: ANSEM, activationId: null });
        expect(harness.controller.getSnapshot()).not.toBe(tokenContext);
        expect(tokenContext).toEqual({ identity: { mint: ANSEM, symbol: 'ANSEM' } });
    });

    it('activates an explicitly simulated, token-scoped Champion with a stable identity', () => {
        const harness = controllerHarness({ start: 10_000, durationMs: 2_000 });
        harness.controller.setActiveMint(ANSEM);
        const activation = harness.controller.activateSimulatedChampion({ mint: ANSEM, displayLabel: 'Local pilot' });
        expect(activation).toMatchObject({
            status: 'active', mint: ANSEM, activationId: 'simulation:1', source: 'simulation',
            activatedAt: 10_000, expiresAt: 12_000, durationMs: 2_000,
            presentationRole: 'user-champion', displayLabel: 'Local pilot',
        });
        expect(harness.controller.getDiagnostics()).toMatchObject({ activeCount: 1, trackedMints: 1, timerCount: 1 });
    });

    it('refreshes one Champion on reactivation instead of stacking entities', () => {
        const harness = controllerHarness({ durationMs: 2_000 });
        harness.controller.setActiveMint(ANSEM);
        const first = harness.controller.activateSimulatedChampion({ mint: ANSEM });
        harness.clock.advance(800);
        const second = harness.controller.activateSimulatedChampion({ mint: ANSEM });
        expect(second.activationId).not.toBe(first.activationId);
        expect(second.expiresAt).toBe(2_800);
        expect(harness.controller.getDiagnostics()).toMatchObject({ activeCount: 1, trackedMints: 1, timerCount: 1, reactivations: 1 });
        expect(harness.scheduler.size()).toBe(1);
    });

    it('expires by wall clock, emits the transition and clears the only timer', () => {
        const harness = controllerHarness({ durationMs: 1_000 });
        const events = [];
        harness.controller.setActiveMint(ANSEM);
        harness.controller.subscribe((snapshot) => events.push(snapshot.status));
        harness.controller.activateSimulatedChampion({ mint: ANSEM });
        harness.clock.advance(1_000);
        expect(harness.controller.getSnapshot()).toMatchObject({ status: 'expired', reason: 'expired' });
        expect(events).toContain('active');
        expect(events.at(-1)).toBe('expired');
        expect(harness.controller.getDiagnostics()).toMatchObject({ activeCount: 0, timerCount: 0, expirations: 1 });
    });

    it('isolates ANSEM, USDC and JUP and restores only an unexpired mint', () => {
        const harness = controllerHarness({ durationMs: 2_000 });
        harness.controller.setActiveMint(ANSEM);
        harness.controller.activateSimulatedChampion({ mint: ANSEM });
        harness.controller.setActiveMint(USDC);
        expect(harness.controller.getSnapshot()).toMatchObject({ mint: USDC, status: 'inactive' });
        harness.controller.setActiveMint(JUP);
        expect(harness.controller.getSnapshot()).toMatchObject({ mint: JUP, status: 'inactive' });
        harness.clock.advance(800);
        harness.controller.setActiveMint(ANSEM);
        expect(harness.controller.getSnapshot()).toMatchObject({ mint: ANSEM, status: 'active', expiresAt: 2_000 });
        harness.controller.setActiveMint(USDC);
        harness.clock.advance(1_200);
        harness.controller.setActiveMint(ANSEM);
        expect(harness.controller.getSnapshot()).toMatchObject({ mint: ANSEM, status: 'expired' });
    });

    it('does not mutate market state, create trades, change TokenContext or open sockets', () => {
        const harness = controllerHarness();
        const tokenContext = structuredClone({ identity: { mint: ANSEM }, metadata: { symbol: 'ANSEM' } });
        const market = structuredClone({ price: 0.2, mcap: 10_000, liveTrades: [{ id: 'real' }], pools: ['pool'] });
        const beforeContext = structuredClone(tokenContext);
        const beforeMarket = structuredClone(market);
        const socketFactory = vi.fn();
        harness.controller.setActiveMint(ANSEM);
        harness.controller.activateSimulatedChampion({ mint: ANSEM });
        expect(tokenContext).toEqual(beforeContext);
        expect(market).toEqual(beforeMarket);
        expect(socketFactory).not.toHaveBeenCalled();
    });

    it('rejects invalid and wallet-shaped simulated requests', () => {
        const harness = controllerHarness();
        expect(() => harness.controller.activateSimulatedChampion({ mint: 'invalid' })).toThrow(/canonical/);
        expect(() => harness.controller.activateSimulatedChampion({ mint: ANSEM, wallet: 'wallet' })).toThrow(/unknown field/);
        expect(() => harness.controller.activateSimulatedChampion({ mint: ANSEM, signature: 'tx' })).toThrow(/unknown field/);
        expect(() => harness.controller.activateSimulatedChampion({ mint: ANSEM, displayLabel: '<script>' })).toThrow(/label/);
    });

    it('uses test activation only through the controlled source and shared policy', () => {
        const harness = controllerHarness({ durationMs: 2_000, testDurationMs: 300 });
        harness.controller.setActiveMint(USDC);
        const activation = harness.controller.activateTestChampion({ mint: USDC });
        expect(activation).toMatchObject({ source: 'test', durationMs: 300, expiresAt: 300 });
        harness.clock.advance(300);
        expect(harness.controller.getSnapshot()).toMatchObject({ status: 'expired' });
    });

    it('cleans timers and listeners on explicit deactivation and destroy', () => {
        const harness = controllerHarness();
        harness.controller.setActiveMint(ANSEM);
        const unsubscribe = harness.controller.subscribe(() => {});
        harness.controller.activateSimulatedChampion({ mint: ANSEM });
        expect(harness.controller.deactivate()).toBe(true);
        expect(harness.controller.getDiagnostics()).toMatchObject({ activeCount: 0, timerCount: 0, listenerCount: 1 });
        unsubscribe();
        harness.controller.activateSimulatedChampion({ mint: ANSEM });
        harness.controller.destroy();
        expect(harness.scheduler.size()).toBe(0);
        expect(harness.controller.getDiagnostics()).toMatchObject({ destroyed: true, activeCount: 0, timerCount: 0, listenerCount: 0 });
    });

    it('keeps 100 activation/expiry cycles and storage deterministically bounded', () => {
        const harness = controllerHarness({ durationMs: 100, maxTrackedMints: 3 });
        const mints = [ANSEM, USDC, JUP];
        harness.controller.setActiveMint(ANSEM);
        for (let index = 0; index < 100; index += 1) {
            const mint = mints[index % mints.length];
            harness.controller.activateSimulatedChampion({ mint });
            if (index % 4 === 0) harness.clock.advance(100);
        }
        const diagnostics = harness.controller.getDiagnostics();
        expect(diagnostics.trackedMints).toBeLessThanOrEqual(3);
        expect(diagnostics.timerCount).toBeLessThanOrEqual(1);
        expect(diagnostics.states.filter((state) => state.status === 'active')).toHaveLength(diagnostics.activeCount);
        expect(new Set(diagnostics.states.map((state) => state.mint)).size).toBe(diagnostics.states.length);
        expect(harness.scheduler.size()).toBeLessThanOrEqual(1);
    });

    it('evicts old mint history at the policy bound without cross-token reuse', () => {
        const harness = controllerHarness({ maxTrackedMints: 2 });
        harness.controller.setActiveMint(ANSEM);
        harness.controller.activateSimulatedChampion({ mint: ANSEM });
        harness.controller.activateSimulatedChampion({ mint: USDC });
        harness.controller.activateSimulatedChampion({ mint: JUP });
        expect(harness.controller.getDiagnostics()).toMatchObject({ trackedMints: 2, evictions: 1 });
        expect(harness.controller.getSnapshot(USDC).status).toBe('inactive');
        expect(harness.controller.getSnapshot(JUP).mint).toBe(JUP);
    });
});

describe('Champion companion synchronization', () => {
    it('sanitizes a minimal token-scoped snapshot and expires stale active input', () => {
        const state = {
            ...inactiveChampionState(ANSEM, 1, 0),
            status: 'active', activationId: 'simulation:1', source: 'simulation',
            activatedAt: 0, expiresAt: 1_000, durationMs: 1_000, reason: 'activated',
        };
        expect(sanitizeChampionSnapshot(state, ANSEM, 500)).toMatchObject({ status: 'active', mint: ANSEM });
        expect(sanitizeChampionSnapshot(state, ANSEM, 1_000)).toMatchObject({ status: 'expired', reason: 'expired' });
        expect(sanitizeChampionSnapshot(state, USDC, 500)).toBeNull();
    });

    it('rejects stale messages and cross-token BroadcastChannel payloads', () => {
        const previous = inactiveChampionState(ANSEM, 4, 400);
        const stale = inactiveChampionState(ANSEM, 3, 300);
        const foreign = inactiveChampionState(USDC, 5, 500);
        expect(acceptChampionMessage(previous, stale, ANSEM, 600)).toMatchObject({ accepted: false, reason: 'stale', snapshot: previous });
        expect(acceptChampionMessage(previous, foreign, ANSEM, 600)).toMatchObject({ accepted: false, reason: 'cross-token', snapshot: previous });
        expect(acceptChampionMessage(previous, inactiveChampionState(ANSEM, 5, 500), ANSEM, 600)).toMatchObject({ accepted: true, reason: 'accepted' });
    });

    it('rejects inactive companion snapshots that retain activation-shaped data', () => {
        expect(() => sanitizeChampionSnapshot({
            ...inactiveChampionState(ANSEM, 2, 200),
            activationId: 'simulation:stale',
        }, ANSEM, 300)).toThrow(/must not retain/);
    });
});

function controllerHarness({
    start = 0,
    durationMs = 1_000,
    testDurationMs = durationMs,
    maxTrackedMints = 12,
} = {}) {
    const clock = fakeClock(start);
    let activationSequence = 0;
    const controller = createChampionController({
        policy: createChampionPolicy({ durationMs, testDurationMs, maxTrackedMints }),
        clock,
        scheduler: clock.scheduler,
        createActivationId: ({ source }) => `${source}:${++activationSequence}`,
    });
    return { controller, clock, scheduler: clock.scheduler };
}

function fakeClock(start) {
    let current = start;
    let timerId = 0;
    const timers = new Map();
    const scheduler = {
        setTimeout(callback, delay) {
            const id = ++timerId;
            timers.set(id, { callback, at: current + delay });
            return id;
        },
        clearTimeout(id) { timers.delete(id); },
        size: () => timers.size,
    };
    return {
        now: () => current,
        scheduler,
        advance(ms) {
            const target = current + ms;
            while (true) {
                const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
                if (!next || next[1].at > target) break;
                current = next[1].at;
                timers.delete(next[0]);
                next[1].callback();
            }
            current = target;
        },
    };
}
