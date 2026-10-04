import { describe, expect, it, vi } from 'vitest';
import { createCommanderController, COMMANDER_LIFECYCLE } from '../js/commander-controller.js';
import { COMMANDER_PROFILE_REGISTRY } from '../js/commander-profile.js';
import { createTokenContext } from '../js/token-context.js';
import { ANSEM_MINT } from '../js/token-presets.js';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const context = (mint, symbol = 'TEST') => createTokenContext({ mint, symbol, name: `${symbol} token` });

describe('token-scoped Commander lifecycle', () => {
    it('spawns exactly one ANSEM Commander and does not duplicate identical observations', () => {
        const instantiate = vi.fn((profile, identity) => ({ profile, ...identity }));
        const controller = createCommanderController({ registry: COMMANDER_PROFILE_REGISTRY, instantiate });
        const first = controller.setTokenContext(context(ANSEM_MINT, 'ANSEM'));
        const second = controller.setTokenContext(context(ANSEM_MINT, 'ANSEM'));
        expect(first).toMatchObject({ present: true, lifecycleState: COMMANDER_LIFECYCLE.ACTIVE, role: 'commander' });
        expect(second.actorId).toBe(first.actorId);
        expect(instantiate).toHaveBeenCalledTimes(1);
        expect(controller.getDiagnostics()).toMatchObject({ spawnCount: 1, destroyCount: 0 });
    });

    it('supports ANSEM to generic to ANSEM without leaking identity or state', () => {
        const destroyed = [];
        const controller = createCommanderController({
            registry: COMMANDER_PROFILE_REGISTRY,
            instantiate: (_profile, identity) => ({ ...identity, destroy: () => destroyed.push(identity.actorId) }),
        });
        const first = controller.setTokenContext(context(ANSEM_MINT, 'ANSEM'));
        const generic = controller.setTokenContext(context(USDC, 'USDC'));
        const second = controller.setTokenContext(context(ANSEM_MINT, 'ANSEM'));
        expect(generic).toMatchObject({ present: false, lifecycleState: COMMANDER_LIFECYCLE.EMPTY, tokenMint: USDC });
        expect(first.actorId).not.toBe(second.actorId);
        expect(destroyed).toEqual([first.actorId]);
        expect(controller.getDiagnostics()).toMatchObject({ spawnCount: 2, destroyCount: 1 });
    });

    it('rejects an old async ANSEM completion after a JUP switch', async () => {
        let resolve;
        const late = new Promise((done) => { resolve = done; });
        const controller = createCommanderController({
            registry: COMMANDER_PROFILE_REGISTRY,
            instantiate: () => late,
        });
        expect(controller.setTokenContext(context(ANSEM_MINT, 'ANSEM')).lifecycleState).toBe(COMMANDER_LIFECYCLE.LOADING);
        expect(controller.setTokenContext(context(JUP, 'JUP'))).toMatchObject({ present: false, tokenMint: JUP });
        resolve({});
        await late;
        await Promise.resolve();
        expect(controller.getDiagnostics()).toMatchObject({ present: false, tokenMint: JUP, staleCompletions: 1 });
    });

    it('keeps role identity and market truth independent', () => {
        const canonicalMarket = Object.freeze({
            valuation: 42,
            frontierTarget: 3,
            sourceEpoch: 7,
            canonicalExecutions: 11,
            buyPressure: 5,
            sellPressure: 2,
            impactScore: 0.4,
        });
        const controller = createCommanderController({ registry: COMMANDER_PROFILE_REGISTRY });
        const commander = controller.setTokenContext(context(ANSEM_MINT, 'ANSEM'));
        const normalTroop = { role: 'normal-troop', actorId: 'troop:1' };
        const impactActor = { role: 'market-impact-actor', actorId: 'impact:1' };
        const champion = { role: 'user-champion', actorId: 'champion:1' };
        expect(new Set([commander.role, normalTroop.role, impactActor.role, champion.role]).size).toBe(4);
        expect(new Set([commander.actorId, normalTroop.actorId, impactActor.actorId, champion.actorId]).size).toBe(4);
        expect(canonicalMarket).toEqual({
            valuation: 42,
            frontierTarget: 3,
            sourceEpoch: 7,
            canonicalExecutions: 11,
            buyPressure: 5,
            sellPressure: 2,
            impactScore: 0.4,
        });
    });
});
