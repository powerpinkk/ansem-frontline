import { describe, expect, it } from 'vitest';
import { selectMarket, eligiblePairs } from '../js/market-selection.js';
import { createValuationBoundary, providerValuation, corroborateValuation } from '../js/market-valuation.js';
import { resolveDexScreenerPayload } from '../js/token-discovery.js';
import { DEFAULT_TOKEN_CONTEXT, ANSEM_FALLBACK_POOLS } from '../js/token-presets.js';
import { MINT, SOL, USDC } from './fixtures/integrity.js';
import { estimateNotional } from '../js/notional.js';

const pair = (i, liquidity = 100_000) => ({ chainId: 'solana', pairAddress: ANSEM_FALLBACK_POOLS[i].address,
    dexId: 'meteora', baseToken: { address: MINT, symbol: 'ANSEM' }, quoteToken: { address: SOL, symbol: 'SOL' },
    priceUsd: '1', priceNative: '.01', liquidity: { usd: liquidity }, marketCap: (i + 1) * 1e6, fdv: 5e6, volume: { h1: 100, h24: 1000 } });
function permutations(items) { return items.length < 2 ? [items] : items.flatMap((x, i) => permutations(items.filter((_, j) => i !== j)).map((p) => [x, ...p])); }
const valuation = (args = {}) => providerValuation({ tokenMint: MINT, marketIdentity: pair(0).pairAddress,
    source: 'dexscreener', priceUsd: 1, marketCap: 1e6, receivedAt: 1000, ...args });

describe('deterministic primary market', () => {
    it('is identical across all 24 permutations including ties', () => {
        const sets = permutations([pair(0), pair(1), pair(2), pair(3, 99_999)]);
        const first = selectMarket(sets[0], MINT, null, 1000);
        for (const p of sets) expect(selectMarket(p, MINT, null, 1000)).toEqual(first);
        for (const p of sets) expect(resolveDexScreenerPayload(DEFAULT_TOKEN_CONTEXT, p).market.valuation)
            .toMatchObject({ valueUsd: first.pair.marketCap, marketIdentity: first.pair.pairAddress, kind: 'MARKET_CAP' });
    });
    it('retains an incumbent through small oscillations and switches on superiority/invalidation', () => {
        const first = selectMarket([pair(0, 110_000), pair(1, 100_000)], MINT, null, 1000);
        let current = first.selection;
        for (let i = 0; i < 30; i += 1) {
            current = selectMarket([pair(1, 100_002), pair(0, 100_001 + i % 2 * 2)], MINT, current, 2000 + i).selection;
            expect(current.pairAddress).toBe(first.selection.pairAddress);
            expect(current.sourceEpoch).toBe(1);
        }
        const superior = selectMarket([pair(0), pair(1, 130_000)], MINT, current, 3000).selection;
        expect(superior.pairAddress).toBe(pair(1).pairAddress); expect(superior.sourceEpoch).toBe(2);
        expect(selectMarket([pair(0)], MINT, superior, 4000).selection.sourceEpoch).toBe(3);
    });
    it('rejects spoofed quote symbols, invalid liquidity and conflicting identities', () => {
        expect(eligiblePairs([{ ...pair(0), quoteToken: { address: MINT, symbol: 'SOL' } }], MINT)).toEqual([]);
        for (const usd of [null, -1, 0, Infinity, NaN]) expect(eligiblePairs([{ ...pair(0), liquidity: { usd } }], MINT)).toEqual([]);
        expect(eligiblePairs([pair(0), { ...pair(0), marketCap: 20e6 }], MINT)).toEqual([]);
        expect(selectMarket([pair(0)], USDC)).toBeNull();
    });
});

describe('typed valuation and source epochs', () => {
    it.each([
        [1e6, null, 'MARKET_CAP', 1e6], [null, 2e6, 'FDV', 2e6], [1e6, 2e6, 'MARKET_CAP', 1e6],
        [null, null, 'UNKNOWN', null], [-1, 2e6, 'FDV', 2e6], [0, 0, 'UNKNOWN', null],
        [NaN, 2e6, 'FDV', 2e6], [Infinity, Infinity, 'UNKNOWN', null], [null, -1, 'UNKNOWN', null],
    ])('preserves semantics for MC=%s FDV=%s', (marketCap, fdv, kind, valueUsd) => {
        expect(valuation({ marketCap, fdv })).toMatchObject({ kind, valueUsd, authorityEligible: false });
    });
    it('rebases provider, pool, kind and implied valuation basis without creating trades', () => {
        const boundary = createValuationBoundary(MINT);
        expect(boundary.accept(valuation(), 1000).sourceEpoch).toBe(1);
        expect(boundary.accept(valuation({ marketCap: 20e6, priceUsd: 20, receivedAt: 2000 }), 2000)).toMatchObject({ sourceEpoch: 1, movementCause: 'PROVIDER_UPDATE' });
        expect(boundary.accept(valuation({ marketCap: 20e6, priceUsd: 1, receivedAt: 3000 }), 3000)).toMatchObject({ sourceEpoch: 2, movementCause: 'VALUATION_BASIS_REBASE' });
        expect(boundary.accept(valuation({ marketIdentity: pair(1).pairAddress, receivedAt: 4000 }), 4000).sourceEpoch).toBe(3);
        expect(boundary.accept(valuation({ marketIdentity: pair(1).pairAddress, marketCap: null, fdv: 1e6, receivedAt: 5000 }), 5000).sourceEpoch).toBe(4);
        expect(boundary.accept(valuation({ source: 'helius-fallback', receivedAt: 6000 }), 6000).sourceEpoch).toBe(5);
    });
    it('rejects time/mint regression and becomes stale without extrapolation', () => {
        const b = createValuationBoundary(MINT);
        b.accept(valuation({ observedAt: 900 }), 1000);
        expect(b.accept(valuation({ receivedAt: 999 }), 1000)).toBeNull();
        expect(b.accept(valuation({ observedAt: 899, receivedAt: 1001 }), 1001)).toBeNull();
        expect(b.accept(valuation({ tokenMint: USDC }), 1001)).toBeNull();
        expect(b.snapshot(40_000)).toMatchObject({ valueUsd: 1e6, freshness: 'STALE' });
        expect(b.accept(valuation({ receivedAt: 40_001 }), 40_001).valueUsd).toBe(1e6);
    });
    it('does not corroborate a browser estimate or mistake execution-price support for verified circulation', () => {
        const a = { ...valuation(), sourceEpoch: 1 };
        const b = { ...valuation({ priceUsd: 50, marketCap: 50e6, receivedAt: 2000 }), sourceEpoch: 1 };
        expect(corroborateValuation(a, b, { price: 50 }, 2000).status).toBe('UNCORROBORATED');
        const evidence = { id: 'chain', evidenceLevel: 'CHAIN_VERIFIED', tokenMint: MINT, settlement: 'CONFIRMED',
            poolAddress: a.marketIdentity, blockTime: 2, executionPriceUsd: 50, priceProvenance: 'INDEPENDENT_QUOTE' };
        expect(corroborateValuation(a, b, evidence, 2000)).toMatchObject({ priceCorroborated: true, authorityEligible: false });
        expect(corroborateValuation(a, b, { ...evidence, executionPriceUsd: 1 }, 2000).status).toBe('DISAGREEMENT');
    });
    it('keeps USD estimates separate and rejects stale/untrusted quotes', () => {
        const event = { evidenceLevel: 'CHAIN_VERIFIED', quoteAmount: 25, quoteSymbol: 'SOL' };
        expect(estimateNotional(event, { source: 'client', priceUsd: 100, receivedAt: 1000 }, 1000)).toBeNull();
        expect(estimateNotional(event, { source: 'dexscreener-sol-usd', priceUsd: 100, receivedAt: 1000 }, 1000).valueUsd).toBe(2500);
        expect(estimateNotional(event, { source: 'dexscreener-sol-usd', priceUsd: 100, receivedAt: 1000 }, 62_000)).toBeNull();
        expect(estimateNotional({ ...event, quoteSymbol: 'USDC' }, null, 1000).source).toBe('STABLECOIN_PARITY_ASSUMPTION');
    });
});
