import { describe, expect, it } from 'vitest';
import { createTokenRuntime } from '../js/state.js';
import { DEFAULT_TOKEN_CONTEXT } from '../js/token-presets.js';
import { createBattleRuntime, FIXED_DT, BATTLE_BOUNDS } from '../js/battle-runtime.js';
import { demoTrade, initDemoAPI } from '../js/demo-source.js';
import { activeTrade, createTradeJournal } from '../js/market-evidence.js';
import { calculatePressure } from '../js/market.js';
import { assertPresentationFrame } from '../js/illustrated/presentation.js';
import { formatPriceDisplay } from '../js/market-health.js';

function setup(mode = 'demo') {
    const token = createTokenRuntime(DEFAULT_TOKEN_CONTEXT); token.state.mode = mode;
    const battle = createBattleRuntime({ state: token.state, mint: token.context.identity.mint });
    return { token, battle };
}
describe('Frontline presentation authority', () => {
    it('rejects synthetic events at every live financial boundary', () => {
        const { battle } = setup('live'), trade = demoTrade(0, 1000);
        expect(activeTrade(trade)).toBe(false);
        expect(createTradeJournal(trade.tokenMint).upsert(trade, 1000).accepted).toBe(false);
        expect(calculatePressure([trade], 1000).totalSol).toBe(0);
        expect(battle.admit(trade, 1000)).toBe(false);
    });
    it('deduplicates and rejects foreign, future and expired presentation events', () => {
        const { battle } = setup(), trade = demoTrade(0, 1000);
        expect(battle.admit(trade, 1000)).toBe(true);
        expect(battle.admit(trade, 1000)).toBe(false);
        expect(battle.admit({ ...trade, id: 'future', timestamp: 2000 }, 1000)).toBe(false);
        expect(battle.admit({ ...trade, id: 'old', timestamp: -100000 }, 1000)).toBe(false);
        expect(battle.admit({ ...trade, id: 'foreign', tokenMint: 'foreign' }, 1000)).toBe(false);
        battle.dispose(); battle.dispose(); expect(battle.diagnostics()).toMatchObject({ actors: 0, dedup: 0, disposed: true });
    });
    it('produces identical facts at different render cadences without mutating finance', () => {
        const a = setup(), b = setup();
        for (const s of [a, b]) {
            s.token.state.activity1h = { buyCount: 20, sellCount: 20 };
            for (let i = 0; i < 8; i++) s.battle.admit(demoTrade(i, 0), 20000);
        }
        const facts = JSON.stringify(a.token.state);
        for (let tick = 0; tick < 600; tick++) {
            const at = 20000 + tick * FIXED_DT * 1000;
            a.battle.step(at); b.battle.step(at);
            if (tick % 2 === 0) assertPresentationFrame(a.battle.frame());
            if (tick % 4 === 0) assertPresentationFrame(b.battle.frame());
        }
        expect(a.battle.frame()).toEqual(b.battle.frame());
        expect(JSON.stringify(a.token.state)).toBe(facts);
        for (const actor of a.battle.frame().actors) {
            expect(actor.x).toBeGreaterThanOrEqual(BATTLE_BOUNDS.minX);
            expect(actor.x).toBeLessThanOrEqual(BATTLE_BOUNDS.maxX);
            expect(actor.z).toBeGreaterThanOrEqual(BATTLE_BOUNDS.minZ);
            expect(actor.z).toBeLessThanOrEqual(BATTLE_BOUNDS.maxZ);
        }
        for (const contact of a.battle.frame().events) expect(contact.distance).toBeLessThanOrEqual(contact.range);
    });
    it('removes active contacts immediately when a swap is evicted between fixed steps', () => {
        const { battle } = setup();
        for (let i = 0; i < 8; i++) battle.admit(demoTrade(i, 0), 20000);
        let contacted = null;
        for (let tick = 0; tick < 1200 && !contacted; tick++) {
            battle.step(20000 + tick * FIXED_DT * 1000);
            const frame = battle.frame();
            for (const event of frame.events) {
                contacted = frame.actors.find(a => a.trade && [event.sourceId, event.targetId].includes(a.id));
                if (contacted) break;
            }
        }
        expect(contacted).not.toBeNull();
        battle.removeTrade(contacted.trade.id);
        // No numerical step occurs before the next copied frame is published.
        const frame = battle.frame();
        expect(frame.actors.some(a => a.id === contacted.id)).toBe(false);
        expect(frame.events.some(e => [e.sourceId, e.targetId].includes(contacted.id))).toBe(false);
        expect(assertPresentationFrame(frame)).toBe(true);
    });
    it('caps detailed swaps independently of aggregate forces and never promotes size to a role', () => {
        const { battle } = setup();
        for (let i = 0; i < 30; i++) battle.admit(demoTrade(i, 0), 60000);
        const actors = battle.frame().actors;
        expect(actors.filter(a => a.side === 0).length).toBeLessThanOrEqual(8);
        expect(actors.filter(a => a.side === 1).length).toBeLessThanOrEqual(8);
        expect(actors.some(a => ['commander', 'user-champion'].includes(a.identity))).toBe(false);
    });
    it('keeps configured Commander and expiring User Champion contracts distinct', () => {
        const { token, battle } = setup(), mint = token.context.identity.mint;
        battle.setRoles({ role: 'commander', present: true, tokenMint: mint }, {
            status: 'active', presentationRole: 'user-champion', source: 'test', mint, expiresAt: 105000,
        });
        battle.step(100000);
        expect(battle.frame().actors.map(a => a.identity).sort()).toEqual(['commander', 'user-champion']);
        battle.step(106000);
        expect(battle.frame().actors.map(a => a.identity)).toEqual(['commander']);
    });
    it('bounds demo suspension catch-up, closes its only timer and never emits a signature', () => {
        let time = 100000, pump, closed = 0;
        const token = createTokenRuntime(DEFAULT_TOKEN_CONTEXT), trades = [];
        const demo = initDemoAPI({ onTrade: t => trades.push(t) }, { runtime: token, now: () => time,
            interval: fn => { pump = fn; return 7; }, clear: id => { expect(id).toBe(7); closed++; } });
        time += 10000000; pump();
        expect(token.state.liveTrades.length).toBeLessThanOrEqual(36);
        expect(trades.every(t => t.signature === null && t.synthetic)).toBe(true);
        demo.destroy(); demo.destroy(); expect(closed).toBe(1);
    });
    it('keeps quiet, representative and full 260-per-side populations finite with real contact geometry', () => {
        for (const count of [0, 40, 10000]) {
            const { token, battle } = setup();
            token.state.activity1h = { buyCount: count, sellCount: count };
            for (let tick = 0; tick < 600; tick++) battle.step(100000 + tick * 1000 / 60);
            const frame = battle.frame(); assertPresentationFrame(frame);
            if (count === 0) expect(frame.actors).toHaveLength(0);
            if (count === 10000) expect(frame.actors).toHaveLength(520);
            for (const actor of frame.actors) expect([actor.x, actor.z, actor.speed, actor.facing, actor.distance].every(Number.isFinite)).toBe(true);
            for (const contact of frame.events) expect(contact.distance).toBeLessThanOrEqual(contact.range);
            battle.dispose();
        }
    }, 15_000);
});
describe('Magnitude-aware prices', () => {
    it('retains tiny positive prices and distinguishes unknown', () => {
        for (const value of [1e-8, 1e-15, 5e-7]) expect(Number(formatPriceDisplay(value).slice(1))).toBeGreaterThan(0);
        for (const value of [null, 0, -1, NaN]) expect(formatPriceDisplay(value)).toBe('—');
    });
});
