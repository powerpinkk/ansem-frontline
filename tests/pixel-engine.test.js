import { describe, expect, it } from 'vitest';
import { createPixelSnapshot } from '../js/pixel-engine.js';

describe('30-second pixel companion data', () => {
    it('uses only verified trades inside the rolling 30-second window', () => {
        const now = 100_000;
        const snapshot = createPixelSnapshot({
            connection: 'online',
            price: 0.25,
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
    });
});
