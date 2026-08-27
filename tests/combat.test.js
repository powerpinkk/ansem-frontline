import { describe, expect, it } from 'vitest';
import { deriveBullChargeProfile, pointToSegmentDistanceSquared, sweptCircleIntersects } from '../js/combat.js';

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
