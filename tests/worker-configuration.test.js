import { describe, expect, it } from 'vitest';
import { parseClientConfiguration } from '../worker/src/configuration.js';
import { DEFAULT_TOKEN_CONTEXT } from '../js/token-presets.js';

const address = '6e7V9eegCHw997T72MxgwwJipZ6GJyZF8NvjkzT1rvpN';

describe('worker client configuration', () => {
    it('accepts bounded public pool metadata and market prices', () => {
        const parsed = parseClientConfiguration(JSON.stringify({
            type: 'configure',
            token: { mint: DEFAULT_TOKEN_CONTEXT.identity.mint, chain: 'solana' },
            pools: [{ address, dexId: 'meteora', quoteSymbol: 'SOL' }],
            market: { tokenPriceUsd: 0.27, solPriceUsd: 96 },
        }));
        expect(parsed.pools[0]).toEqual({ address, dexId: 'meteora', quoteSymbol: 'SOL' });
        expect(parsed.market).toMatchObject({ tokenPriceUsd: 0.27, solPriceUsd: 96 });
        expect(parsed.token).toEqual({ mint: DEFAULT_TOKEN_CONTEXT.identity.mint, chain: 'solana' });
    });

    it('rejects malformed addresses, missing prices and non-configuration messages', () => {
        expect(parseClientConfiguration('{}')).toBeNull();
        expect(parseClientConfiguration(JSON.stringify({ type: 'configure', token: { mint: DEFAULT_TOKEN_CONTEXT.identity.mint }, pools: [{ address: 'invalid' }], market: { tokenPriceUsd: 1, solPriceUsd: 1 } }))).toBeNull();
        const unboundedPrice = `{"type":"configure","token":{"mint":"${DEFAULT_TOKEN_CONTEXT.identity.mint}"},"pools":[{"address":"${address}"}],"market":{"tokenPriceUsd":1e999,"solPriceUsd":1}}`;
        expect(parseClientConfiguration(unboundedPrice)).toBeNull();
    });
});
