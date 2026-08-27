import { describe, expect, it } from 'vitest';
import { createPixelSnapshot, findPixelOverlaps, layoutPixelBattle } from '../js/pixel-engine.js';

describe('30-second pixel companion data', () => {
    it('uses only verified trades inside the rolling 30-second window', () => {
        const now = 100_000;
        const snapshot = createPixelSnapshot({
            connection: 'online',
            price: 0.25,
            mcap: 250_000_000,
            priceTicks30s: [
                { timestamp: now - 25_000, price: 0.24 },
                { timestamp: now - 1_000, price: 0.25 },
                { timestamp: now - 31_000, price: 9 },
            ],
            liveTrades: [
                { txHash: 'fresh-buy', isBuy: true, isWhale: false, solValue: 3, timestamp: now - 2_000 },
                { txHash: 'fresh-whale', isBuy: false, isWhale: true, solValue: 24, timestamp: now - 29_999 },
                { txHash: 'expired', isBuy: true, isWhale: false, solValue: 100, timestamp: now - 30_001 },
            ],
        }, now);
        expect(snapshot.trades.map((trade) => trade.id)).toEqual(['fresh-buy', 'fresh-whale']);
        expect(snapshot.buySol).toBe(3);
        expect(snapshot.sellSol).toBe(24);
        expect(snapshot.online).toBe(true);
        expect(snapshot.mcap).toBe(250_000_000);
        expect(snapshot.priceTicks).toEqual([
            { timestamp: now - 25_000, price: 0.24 },
            { timestamp: now - 1_000, price: 0.25 },
            { timestamp: now, price: 0.25 },
        ]);
    });

    it('keeps dense normal and whale sprites separated in every lane', () => {
        const now = 100_000;
        const liveTrades = Array.from({ length: 32 }, (_, index) => ({
            txHash: `trade-${index}`,
            isBuy: index % 2 === 0,
            isWhale: index % 7 === 0,
            solValue: index % 7 === 0 ? 25 : 1,
            timestamp: now - 8_000 - index * 10,
        }));
        const snapshot = createPixelSnapshot({ connection: 'online', price: 0.25, liveTrades }, now);
        const layout = layoutPixelBattle(snapshot, 640, 160, now);
        expect(layout.bulls).toHaveLength(6);
        expect(layout.bears).toHaveLength(6);
        expect(layout.bullTotal).toBe(16);
        expect(layout.bearTotal).toBe(16);
        expect(findPixelOverlaps(layout)).toEqual([]);
        expect(new Set(layout.units.map((unit) => unit.lane))).toEqual(new Set([0, 1]));
        expect(Math.min(...layout.units.map((unit) => unit.width))).toBeGreaterThanOrEqual(29);
    });

    it('remains collision-free and readable at the minimum compact surface', () => {
        const now = 100_000;
        const liveTrades = Array.from({ length: 28 }, (_, index) => ({
            txHash: `compact-${index}`,
            isBuy: index % 2 === 0,
            isWhale: index % 9 === 0,
            solValue: index % 9 === 0 ? 30 : 0.8,
            timestamp: now - 5_000 - index * 20,
        }));
        const snapshot = createPixelSnapshot({ connection: 'online', price: 0.25, mcap: 250_000_000, liveTrades }, now);
        const layout = layoutPixelBattle(snapshot, 320, 96, now);
        expect(findPixelOverlaps(layout)).toEqual([]);
        expect(Math.min(...layout.units.map((unit) => unit.width))).toBeGreaterThanOrEqual(23);
    });
});
