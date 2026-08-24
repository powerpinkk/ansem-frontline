import { describe, expect, it } from 'vitest';
import { parseTransaction } from '../worker/src/parser.js';
import { CONFIG } from '../js/config.js';

describe('Helius transaction parser', () => {
    it('uses the exact native SOL spent for a buy', () => {
        const parsed = parseTransaction(transaction({ beforeTokens: 0, afterTokens: 10_000, beforeSol: 30, afterSol: 4.999995 }), 'signature', pool('SOL'), CONFIG.TOKEN_MINT, market());
        expect(parsed).toMatchObject({ isBuy: true, tokenAmount: 10_000, solValue: 25, isWhale: true, provider: 'helius' });
    });

    it('normalizes a stablecoin-pool sell using verified token balance changes', () => {
        const parsed = parseTransaction(transaction({ beforeTokens: 10_000, afterTokens: 0, beforeSol: 2, afterSol: 2 }), 'signature', pool('USDC'), CONFIG.TOKEN_MINT, market());
        expect(parsed).toMatchObject({ isBuy: false, tokenAmount: 10_000, usdValue: 2500, solValue: 25, isWhale: true });
    });
});

function transaction({ beforeTokens, afterTokens, beforeSol, afterSol }) {
    const tokenBalance = (amount) => ({ mint: CONFIG.TOKEN_MINT, owner: 'wallet', uiTokenAmount: { uiAmountString: String(amount) } });
    return {
        blockTime: 1_787_500_000,
        transaction: { message: { accountKeys: [{ pubkey: 'wallet', signer: true }] } },
        meta: {
            err: null, fee: 5000,
            preBalances: [beforeSol * 1_000_000_000], postBalances: [afterSol * 1_000_000_000],
            preTokenBalances: [tokenBalance(beforeTokens)], postTokenBalances: [tokenBalance(afterTokens)],
        },
    };
}

function pool(quoteSymbol) { return { address: 'pool', dexId: 'dex', quoteSymbol }; }
function market() { return { tokenPriceUsd: 0.25, solPriceUsd: 100 }; }
