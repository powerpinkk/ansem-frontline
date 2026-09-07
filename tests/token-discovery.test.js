import { describe, expect, it } from 'vitest';
import { discoverToken, resolveDexScreenerPayload } from '../js/token-discovery.js';
import { TOKEN_DISCOVERY_STATUS, createTokenContext } from '../js/token-context.js';
import { DEFAULT_TOKEN_CONTEXT } from '../js/token-presets.js';
import { CONFIG } from '../js/config.js';
import { parseGeckoTrade } from '../js/market.js';

const USDC = createTokenContext({ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' });
const JUP = createTokenContext({ mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN' });
const POOLS = [
    '6e7V9eegCHw997T72MxgwwJipZ6GJyZF8NvjkzT1rvpN',
    '4pANrqEvjad4xEghrCbAAJfBm8KyNvYMKk1cuGW8erE4',
    'FnzKY6x7entQ1eR3D225dQyT7ybfka4PskBMQhb8L3CC',
];

describe('token-agnostic discovery', () => {
    it('resolves ANSEM, USDC and JUP independently with correct metadata and pools', async () => {
        const definitions = [
            { context: DEFAULT_TOKEN_CONTEXT, symbol: 'ANSEM', name: 'The Black Bull', price: 0.25 },
            { context: USDC, symbol: 'USDC', name: 'USD Coin', price: 1 },
            { context: JUP, symbol: 'JUP', name: 'Jupiter', price: 0.8 },
        ];
        const resolutions = await Promise.all(definitions.map((definition, index) => discoverToken(definition.context, {
            fetchPairs: async (mint) => [pair({ ...definition, mint, pool: POOLS[index] })],
        })));

        expect(resolutions.every((resolution) => resolution.ok)).toBe(true);
        expect(resolutions.map((resolution) => resolution.context.identity.symbol)).toEqual(['ANSEM', 'USDC', 'JUP']);
        expect(resolutions.map((resolution) => resolution.context.identity.name)).toEqual(['The Black Bull', 'USD Coin', 'Jupiter']);
        expect(resolutions.map((resolution) => resolution.context.resources.referencePool.address)).toEqual(POOLS);
        expect(new Set(resolutions.map((resolution) => resolution.context.identity.mint)).size).toBe(3);
        expect(new Set(resolutions.map((resolution) => resolution.market.trackedPools[0].address)).size).toBe(3);
    });

    it('distinguishes invalid, unavailable, unsupported, temporary and malformed-upstream results', async () => {
        const invalid = await discoverToken('not-a-mint', { fetchPairs: async () => [] });
        const unavailable = resolveDexScreenerPayload(USDC, []);
        const unsupported = resolveDexScreenerPayload(USDC, [{
            ...pair({ context: JUP, mint: JUP.identity.mint, symbol: 'JUP', name: 'Jupiter', price: 1, pool: POOLS[0] }),
            quoteToken: { address: USDC.identity.mint, symbol: 'USDC', name: 'USD Coin' },
        }]);
        const temporary = await discoverToken(USDC, { fetchPairs: async () => { const error = new Error('rate limited'); error.status = 429; throw error; } });
        const malformed = await discoverToken(USDC, { fetchPairs: async () => ({ unexpected: true }) });

        expect(invalid.status).toBe(TOKEN_DISCOVERY_STATUS.INVALID);
        expect(unavailable.status).toBe(TOKEN_DISCOVERY_STATUS.UNAVAILABLE);
        expect(unsupported.status).toBe(TOKEN_DISCOVERY_STATUS.UNSUPPORTED);
        expect(temporary.status).toBe(TOKEN_DISCOVERY_STATUS.TEMPORARY_ERROR);
        expect(malformed.status).toBe(TOKEN_DISCOVERY_STATUS.UPSTREAM_FAILURE);
    });

    it('never accepts a Gecko trade whose token addresses do not match its context', async () => {
        const resolution = await discoverToken(USDC, {
            fetchPairs: async () => [pair({ context: USDC, mint: USDC.identity.mint, symbol: 'USDC', name: 'USD Coin', price: 1, pool: POOLS[1] })],
        });
        expect(resolution.context.identity.mint).toBe(USDC.identity.mint);
        expect(resolution.context.resources.pools[0].quoteSymbol).toBe('SOL');
        const foreignTrade = parseGeckoTrade({ attributes: {
            tx_hash: 'foreign-signature',
            kind: 'buy',
            from_token_address: CONFIG.SOL_MINT,
            from_token_amount: '1',
            to_token_address: JUP.identity.mint,
            to_token_amount: '100',
            volume_in_usd: '100',
            block_timestamp: '2026-09-07T00:00:00Z',
        } }, resolution.context.resources.pools[0], 100, resolution.context);
        expect(foreignTrade).toBeNull();
    });

    it('reuses a valid pool set between scheduled discovery refreshes', () => {
        const first = pair({ mint: JUP.identity.mint, symbol: 'JUP', name: 'Jupiter', price: 0.8, pool: POOLS[0] });
        const second = pair({ mint: JUP.identity.mint, symbol: 'JUP', name: 'Jupiter', price: 0.8, pool: POOLS[2] });
        second.volume.h1 = 9_000_000;
        const existing = [{
            address: POOLS[0],
            dexId: 'fixture-dex',
            quoteSymbol: 'SOL',
            liquidityUsd: 100_000,
            volumeH24Usd: 100_000,
            volumeH1Usd: 10_000,
            url: `https://dex.example/${POOLS[0]}`,
        }];
        const resolution = resolveDexScreenerPayload(JUP, [first, second], 5, existing);
        expect(resolution.market.trackedPools).toEqual(existing);
        expect(resolution.context.resources.pools[0].address).toBe(POOLS[0]);
    });

    it('rejects cached pools that are not present in the requested token response', () => {
        const livePair = pair({ mint: USDC.identity.mint, symbol: 'USDC', name: 'USD Coin', price: 1, pool: POOLS[1] });
        const foreignCachedPool = [{ address: POOLS[2], dexId: 'foreign', quoteSymbol: 'SOL' }];
        const resolution = resolveDexScreenerPayload(USDC, [livePair], 5, foreignCachedPool);
        expect(resolution.ok).toBe(true);
        expect(resolution.market.trackedPools[0].address).toBe(POOLS[1]);
        expect(resolution.market.trackedPools.some((pool) => pool.address === POOLS[2])).toBe(false);
    });
});

function pair({ mint, symbol, name, price, pool }) {
    return {
        chainId: 'solana',
        pairAddress: pool,
        dexId: 'fixture-dex',
        url: `https://dex.example/${pool}`,
        baseToken: { address: mint, symbol, name },
        quoteToken: { address: CONFIG.SOL_MINT, symbol: 'SOL', name: 'Wrapped SOL' },
        priceUsd: String(price),
        priceNative: String(price / 100),
        marketCap: price * 1_000_000,
        priceChange: { h1: 1 },
        liquidity: { usd: 100_000 },
        volume: { h1: 10_000, h24: 100_000 },
        txns: { m5: { buys: 5, sells: 4 }, h1: { buys: 50, sells: 40 } },
        info: { imageUrl: `https://assets.example/${symbol.toLowerCase()}.png` },
    };
}
