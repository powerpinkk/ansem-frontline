import { describe, expect, it } from 'vitest';
import { resolveDexScreenerPayload } from '../js/token-discovery.js';
import { parseTransaction } from '../worker/src/parser.js';
import { normalizeHeliusMarket } from '../worker/src/market-fallback.js';
import { DEFAULT_TOKEN_CONTEXT, ANSEM_FALLBACK_POOLS } from '../js/token-presets.js';

const mint = DEFAULT_TOKEN_CONTEXT.identity.mint;
const pair = (index, marketCap, liquidity = 100_000) => ({
    chainId: 'solana', pairAddress: ANSEM_FALLBACK_POOLS[index].address, dexId: 'meteora',
    baseToken: { address: mint, symbol: 'ANSEM' },
    quoteToken: { address: 'So11111111111111111111111111111111111111112', symbol: 'SOL' },
    priceUsd: '1', priceNative: '.01', marketCap, liquidity: { usd: liquidity }, volume: { h1: 10, h24: 100 },
});

function balanceOnly(before, after) {
    const balance = (amount) => ({ mint, owner: 'wallet', accountIndex: 1,
        uiTokenAmount: { amount: String(amount), decimals: 0, uiAmountString: String(amount) } });
    return { slot: 123, blockTime: 1_787_500_000,
        transaction: { message: { accountKeys: [{ pubkey: 'wallet', signer: true }], instructions: [] } },
        meta: { err: null, fee: 5000, preBalances: [2e9], postBalances: [2e9 - 5000],
            preTokenBalances: [balance(before)], postTokenBalances: [balance(after)] } };
}

describe('M10 audit regressions (recorded before implementation)', () => {
    it('does not change valuation when the same provider set is reversed', () => {
        const pairs = [pair(0, 1e6), pair(1, 20e6, 1000)];
        const a = resolveDexScreenerPayload(DEFAULT_TOKEN_CONTEXT, pairs).market;
        const b = resolveDexScreenerPayload(DEFAULT_TOKEN_CONTEXT, [...pairs].reverse()).market;
        expect(b.mcap).toBe(a.mcap);
        expect(b.valuation).toMatchObject({ kind: 'MARKET_CAP', valueUsd: 1e6, marketIdentity: a.referencePool.address });
    });
    it('retains FDV semantics instead of passing it through mcap', () => {
        const market = resolveDexScreenerPayload(DEFAULT_TOKEN_CONTEXT, [{ ...pair(0, null), fdv: 5e6 }]).market;
        expect(market.mcap).toBeNull();
        expect(market.valuation).toMatchObject({ kind: 'FDV', valueUsd: 5e6 });
    });
    it('does not call total supply times price circulating market cap', () => {
        const market = normalizeHeliusMarket({ token_info: { supply: 1e12, decimals: 6, price_info: { price_per_token: 1 } } },
            { token_info: { price_info: { price_per_token: 100 } } });
        expect(market.mcap).toBeNull();
        expect(market.valuation).toMatchObject({ kind: 'FDV', valueUsd: 1e6 });
    });
    it('client price cannot change canonical evidence for the same transaction', () => {
        const tx = balanceOnly(10_000, 0);
        const results = [0.001, 0.020, 999].map((tokenPriceUsd) => parseTransaction(tx, 'audit',
            { ...ANSEM_FALLBACK_POOLS[0], quoteSymbol: 'USDC' }, mint, { tokenPriceUsd, solPriceUsd: 100 }));
        expect(results[1]).toEqual(results[0]);
        expect(results[2]).toEqual(results[0]);
    });
    it.each([['transfer', 10_000, 0], ['airdrop', 0, 10_000], ['mint', 0, 100], ['burn', 100, 0], ['LP action', 100, 200]])(
        '%s balance changes alone never prove a swap', (_kind, before, after) => {
            expect(parseTransaction(balanceOnly(before, after), 'audit', ANSEM_FALLBACK_POOLS[0], mint,
                { tokenPriceUsd: .25, solPriceUsd: 100 })).toBeNull();
        });
});
