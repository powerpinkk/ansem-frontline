import { describe, expect, it } from 'vitest';
import { ARENA, clampArenaPosition, formationTarget, isUnitStranded, tacticalPatrolTarget, tradeLane, unitHasExpired } from '../js/navigation.js';

describe('battlefield navigation', () => {
    it('keeps every unit inside the playable arena', () => {
        expect(clampArenaPosition({ x: 900, z: -900 }, 2)).toEqual({ x: ARENA.maxX - 2, z: ARENA.minZ + 2 });
    });

    it('creates stable lanes from the real transaction signature', () => {
        const trade = { txHash: 'real-solana-signature' };
        expect(tradeLane(trade)).toBe(tradeLane(trade));
        expect(tradeLane(trade)).toBeGreaterThanOrEqual(-11.5);
        expect(tradeLane(trade)).toBeLessThanOrEqual(11.5);
    });

    it('holds bulls and bears on their respective side of the pressure frontline', () => {
        const bull = formationTarget('bull', 20, -3, 0, false);
        const bear = formationTarget('bear', 20, 3, 0, false);
        expect(bull.x).toBeLessThan(20);
        expect(bear.x).toBeGreaterThan(20);
    });

    it('detects units isolated behind a moved pressure frontline', () => {
        expect(isUnitStranded('bear', -4, 10)).toBe(true);
        expect(isUnitStranded('bear', 8, 10)).toBe(false);
        expect(isUnitStranded('bull', 18, 10)).toBe(true);
        expect(isUnitStranded('bull', 8, 10)).toBe(false);
    });

    it('lets units patrol across the imaginary line while market control shifts their operating area', () => {
        const neutralA = tacticalPatrolTarget('bull', 0, 0, 0, false, -1, 0);
        const neutralB = tacticalPatrolTarget('bull', 0, 0, 0, false, 1, 4);
        expect(neutralA.x).toBeLessThan(0);
        expect(neutralB.x).toBeGreaterThan(0);
        expect(tacticalPatrolTarget('bear', 20, 0, 1, false, -1, 0).x).toBeLessThan(20);
        expect(tacticalPatrolTarget('bear', 20, 0, 1, false, 1, 0).x).toBeGreaterThan(20);
    });

    it('expires normal activity before giant trades', () => {
        const now = 200_000;
        expect(unitHasExpired({ bornAt: 120_000, isWhale: false }, now)).toBe(true);
        expect(unitHasExpired({ bornAt: 120_000, isWhale: true }, now)).toBe(false);
    });
});
