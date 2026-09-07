import { describe, expect, it } from 'vitest';
import { fallbackPoolsForMint, normalizeHeliusMarket } from '../worker/src/market-fallback.js';
import { TOKEN_DISCOVERY_STATUS } from '../js/token-context.js';
import { DEFAULT_TOKEN_CONTEXT } from '../js/token-presets.js';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

describe('Helius market fallback normalization', () => {
    it('derives market cap from raw supply and decimals', () => {
        const market = normalizeHeliusMarket(
            { token_info: { price_info: { price_per_token: 0.25 }, supply: '1000000000', decimals: 2 } },
            { token_info: { price_info: { price_per_token: 95 } } },
        );
        expect(market).toMatchObject({ price: 0.25, solPriceUsd: 95, mcap: 2_500_000, source: 'helius-fallback' });
        expect(market.pools).toHaveLength(5);
        expect(market.token.identity.mint).toBe(DEFAULT_TOKEN_CONTEXT.identity.mint);
    });

    it('rejects incomplete price data', () => {
        expect(normalizeHeliusMarket({}, {})).toBeNull();
    });

    it('does not attribute ANSEM fallback pools to another mint', () => {
        const market = normalizeHeliusMarket(
            { token_info: { price_info: { price_per_token: 1 }, supply: '1000000', decimals: 6 }, content: { metadata: { symbol: 'USDC', name: 'USD Coin' } } },
            { token_info: { price_info: { price_per_token: 95 } } },
            { mint: USDC_MINT },
        );
        expect(fallbackPoolsForMint(USDC_MINT)).toEqual([]);
        expect(market.pools).toEqual([]);
        expect(market.status).toBe(TOKEN_DISCOVERY_STATUS.UNSUPPORTED);
        expect(market.token.identity).toMatchObject({ mint: USDC_MINT, symbol: 'USDC', name: 'USD Coin' });
    });
});
