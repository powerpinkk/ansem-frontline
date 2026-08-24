import { describe, expect, it } from 'vitest';
import { calculatePressure, deriveSolPrice, parseGeckoTrade, selectTrackedPools } from '../js/market.js';
import { CONFIG } from '../js/config.js';

const pool = { address: 'pool-1', dexId: 'pumpswap', quoteSymbol: 'SOL' };

function trade(attributes, id = 'trade-1') {
    return { id, attributes: { tx_hash: 'signature', block_number: 1, tx_from_address: 'wallet', block_timestamp: '2026-08-24T10:00:00Z', ...attributes } };
}

describe('market parsing', () => {
    it('derives the SOL/USD price from an ANSEM/SOL pair', () => {
        expect(deriveSolPrice([{ quoteToken: { symbol: 'SOL' }, priceUsd: '0.25', priceNative: '0.0025' }])).toBe(100);
    });

    it('parses a buy paid in SOL and marks 20 SOL as a giant trade', () => {
        const parsed = parseGeckoTrade(trade({
            kind: 'buy',
            from_token_address: CONFIG.SOL_MINT,
            from_token_amount: '20',
            to_token_address: CONFIG.TOKEN_MINT,
            to_token_amount: '8000',
            volume_in_usd: '2000',
        }), pool, 100);
        expect(parsed).toMatchObject({ isBuy: true, tokenAmount: 8000, solValue: 20, isWhale: true });
    });

    it('parses a token sell returning SOL', () => {
        const parsed = parseGeckoTrade(trade({
            kind: 'sell',
            from_token_address: CONFIG.TOKEN_MINT,
            from_token_amount: '4000',
            to_token_address: CONFIG.SOL_MINT,
            to_token_amount: '9.5',
            volume_in_usd: '950',
        }), pool, 100);
        expect(parsed).toMatchObject({ isBuy: false, tokenAmount: 4000, solValue: 9.5, isWhale: false });
    });

    it('converts stablecoin pool volume to its SOL equivalent', () => {
        const parsed = parseGeckoTrade(trade({
            kind: 'buy',
            from_token_address: 'USDC',
            from_token_amount: '2500',
            to_token_address: CONFIG.TOKEN_MINT,
            to_token_amount: '10000',
            volume_in_usd: '2500',
        }), { ...pool, quoteSymbol: 'USDC' }, 100);
        expect(parsed.solValue).toBe(25);
        expect(parsed.isWhale).toBe(true);
    });
});

describe('pool selection and pressure', () => {
    it('selects active supported Solana markets instead of trusting API order', () => {
        const pairs = [
            { chainId: 'solana', pairAddress: 'low', dexId: 'a', baseToken: { address: CONFIG.TOKEN_MINT }, quoteToken: { symbol: 'SOL' }, volume: { h1: 1, h24: 10 }, liquidity: { usd: 10 } },
            { chainId: 'solana', pairAddress: 'high', dexId: 'b', baseToken: { address: CONFIG.TOKEN_MINT }, quoteToken: { symbol: 'USDC' }, volume: { h1: 100, h24: 1000 }, liquidity: { usd: 1000 } },
            { chainId: 'ethereum', pairAddress: 'wrong-chain', baseToken: { address: CONFIG.TOKEN_MINT }, quoteToken: { symbol: 'USDC' }, volume: { h1: 9999 } },
        ];
        expect(selectTrackedPools(pairs, 1)[0].address).toBe('high');
    });

    it('weights dominance by real SOL size, not transaction count', () => {
        const now = Date.now();
        const pressure = calculatePressure([
            { isBuy: true, solValue: 2, timestamp: now },
            { isBuy: true, solValue: 3, timestamp: now },
            { isBuy: false, solValue: 15, timestamp: now },
        ], now);
        expect(pressure.bullPercent).toBe(25);
        expect(pressure.bearPercent).toBe(75);
    });
});
