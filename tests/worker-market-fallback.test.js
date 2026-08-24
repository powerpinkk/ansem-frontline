import { describe, expect, it } from 'vitest';
import { normalizeHeliusMarket } from '../worker/src/market-fallback.js';

describe('Helius market fallback normalization', () => {
    it('derives market cap from raw supply and decimals', () => {
        const market = normalizeHeliusMarket(
            { token_info: { price_info: { price_per_token: 0.25 }, supply: '1000000000', decimals: 2 } },
            { token_info: { price_info: { price_per_token: 95 } } },
        );
        expect(market).toMatchObject({ price: 0.25, solPriceUsd: 95, mcap: 2_500_000, source: 'helius-fallback' });
        expect(market.pools).toHaveLength(2);
    });

    it('rejects incomplete price data', () => {
        expect(normalizeHeliusMarket({}, {})).toBeNull();
    });
});
