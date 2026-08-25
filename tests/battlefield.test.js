import { describe, expect, it } from 'vitest';
import { deriveForceDoctrine, deriveKingDirective, deriveVisualForces } from '../js/battlefield.js';

describe('volume-weighted battlefield forces', () => {
    it('scales from quiet skirmishes to hundreds without claiming one whale is hundreds of swaps', () => {
        expect(deriveVisualForces({ buySol: 0, sellSol: 0 }).total).toBe(0);
        const low = deriveVisualForces({ buySol: 1, buyCount: 2, verifiedBuyCount: 1 });
        const medium = deriveVisualForces({ buySol: 25, sellSol: 8, buyCount: 40, sellCount: 30, verifiedBuyCount: 1, verifiedSellCount: 1 });
        const high = deriveVisualForces({ buySol: 400, sellSol: 320, buyCount: 200, sellCount: 200, verifiedBuyCount: 20, verifiedSellCount: 20 });
        expect(low.bull).toBeGreaterThanOrEqual(10);
        expect(medium.bull).toBeGreaterThan(medium.bear);
        expect(medium.total).toBeGreaterThan(100);
        expect(high.bull).toBe(260);
        expect(high.bear).toBe(260);
    });

    it('caps constrained battlefields independently per side', () => {
        expect(deriveVisualForces({ buySol: 10_000, sellSol: 10_000, buyCount: 5_000, sellCount: 5_000, maxPerSide: 120 }))
            .toMatchObject({ bull: 120, bear: 120, cap: 120 });
    });
});

describe('battle doctrines', () => {
    const market = { balance: 0.7, flowIntensity: 0.8, activityLevel: 0.9 };

    it('orders the winning side to surge and the losing side to fall back', () => {
        expect(deriveForceDoctrine('bull', market).stance).toBe('surge');
        expect(deriveForceDoctrine('bear', market).stance).toBe('fallback');
    });

    it('gives the king purposeful modes instead of random patrol motion', () => {
        expect(deriveKingDirective({ tactics: market }).mode).toBe('lead');
        expect(deriveKingDirective({ tactics: market, supporting: true }).mode).toBe('rally');
        expect(deriveKingDirective({ tactics: market, defending: true }).mode).toBe('defend');
        expect(deriveKingDirective({ tactics: { balance: -0.7, flowIntensity: 0.8 } }).mode).toBe('guard');
    });
});
