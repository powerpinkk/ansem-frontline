import { expect, it } from 'vitest';
import { parseTransaction } from '../worker/src/parser.js';
import { swapFixture, USDC } from './fixtures/integrity.js';
it('returns actual SOL pool transfers independent of native fees or client price', () => {
    const f = swapFixture();
    expect(parseTransaction(f.transaction, f.signature, null, f.mint, { tokenPriceUsd: 999 }))
        .toMatchObject({ isBuy: true, rawQuoteAmount: '25000000000', solValue: 25,
            usdValue: null, slot: 100, settlement: 'CONFIRMED', evidenceLevel: 'CHAIN_VERIFIED' });
});
it('stablecoin quotes retain their units and never invent equivalent SOL', () => {
    const f = swapFixture({ quoteMint: USDC, isBuy: false, rawQuote: '2500000000' });
    expect(parseTransaction(f.transaction, f.signature, null, f.mint, { solPriceUsd: 100 }))
        .toMatchObject({ isBuy: false, quoteAmount: 2500, quoteSymbol: 'USDC', solValue: null, usdValue: null });
});
