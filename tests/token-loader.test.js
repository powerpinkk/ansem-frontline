import { describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../js/config.js';
import { resolveTokenInput } from '../js/token-loader.js';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT = 'Es9vMFrzaCERmJfrF4H2FYDCLDFAm19AetDjbYdoSZEd';
const POOL = '6e7V9eegCHw997T72MxgwwJipZ6GJyZF8NvjkzT1rvpN';

describe('token loading', () => {
    it('adds a verified SOL/USD quote when the selected token has only stablecoin pools', async () => {
        const fetchImpl = vi.fn(async (url) => Response.json(url.endsWith(CONFIG.SOL_MINT) ? [{
            chainId: 'solana',
            pairAddress: POOL,
            baseToken: { address: CONFIG.SOL_MINT, symbol: 'SOL', name: 'Wrapped SOL' },
            quoteToken: { address: USDC, symbol: 'USDC', name: 'USD Coin' },
            priceUsd: '104.64',
            priceNative: '104.64',
        }] : [{
            chainId: 'solana',
            pairAddress: POOL,
            dexId: 'fixture-dex',
            baseToken: { address: USDC, symbol: 'USDC', name: 'USD Coin' },
            quoteToken: { address: USDT, symbol: 'USDT', name: 'Tether' },
            priceUsd: '1',
            priceNative: '1',
            liquidity: { usd: 100_000 },
            volume: { h1: 10_000, h24: 100_000 },
            txns: { m5: { buys: 5, sells: 4 }, h1: { buys: 50, sells: 40 } },
        }]));

        const resolution = await resolveTokenInput(USDC, { fetchImpl });

        expect(resolution.ok).toBe(true);
        expect(resolution.market.solPriceUsd).toBe(104.64);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(fetchImpl.mock.calls[1][0]).toContain(CONFIG.SOL_MINT);
    });
});
