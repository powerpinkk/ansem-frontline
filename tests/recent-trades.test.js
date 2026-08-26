import { describe, expect, it } from 'vitest';
import { fetchRecentTrades, normalizeRecentTransactions } from '../worker/src/recent-trades.js';
import { CONFIG } from '../js/config.js';

describe('Helius recent transaction snapshot', () => {
    it('normalizes full history entries and ignores malformed transactions', () => {
        const transaction = fixtureTransaction();
        const result = normalizeRecentTransactions({
            data: [transaction, { transaction: fixtureTransaction('nested-signature') }, { slot: 1 }],
        }, pool(), CONFIG.TOKEN_MINT, { tokenPriceUsd: 0.25, solPriceUsd: 100 });

        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({
            txHash: 'direct-signature',
            isBuy: true,
            solValue: 25,
            poolAddress: pool().address,
            provider: 'helius',
        });
        expect(result[1].txHash).toBe('nested-signature');
    });

    it('uses the free Helius signature flow and one getTransaction batch', async () => {
        const requests = [];
        const pools = [pool(), { ...pool(), address: 'FnzKY6x7entQ1eR3D225dQyT7ybfka4PskBMQhb8L3CC' }];
        const fetchImpl = async (_url, options) => {
            const body = JSON.parse(options.body);
            requests.push(body);
            if (!Array.isArray(body)) {
                return jsonResponse({
                    jsonrpc: '2.0',
                    id: body.id,
                    result: [{
                        signature: `${body.id}-signature`,
                        err: null,
                        blockTime: Math.floor(Date.now() / 1_000),
                    }],
                });
            }
            return jsonResponse(body.map((request, index) => ({
                jsonrpc: '2.0',
                id: request.id,
                result: fixtureTransaction(`${pools[index].address}-signature`),
            })));
        };

        const result = await fetchRecentTrades({
            HELIUS_API_KEY: 'test-key',
            TOKEN_MINT: CONFIG.TOKEN_MINT,
        }, {
            pools,
            market: { tokenPriceUsd: 0.25, solPriceUsd: 100 },
        }, fetchImpl);

        expect(requests.slice(0, 2).map((request) => request.method)).toEqual([
            'getSignaturesForAddress',
            'getSignaturesForAddress',
        ]);
        expect(requests[2]).toHaveLength(2);
        expect(requests[2].every((request) => request.method === 'getTransaction')).toBe(true);
        expect(result).toMatchObject({ source: 'helius-history', pools: 2 });
        expect(result.trades).toHaveLength(2);
    });
});

function jsonResponse(payload) {
    return { ok: true, json: async () => payload };
}

function fixtureTransaction(signature = 'direct-signature') {
    const tokenBalance = (amount) => ({
        mint: CONFIG.TOKEN_MINT,
        owner: 'wallet',
        uiTokenAmount: { uiAmountString: String(amount) },
    });
    return {
        blockTime: Math.floor(Date.now() / 1_000),
        transaction: {
            signatures: [signature],
            message: { accountKeys: [{ pubkey: 'wallet', signer: true }] },
        },
        meta: {
            err: null,
            fee: 5_000,
            preBalances: [30_000_000_000],
            postBalances: [4_999_995_000],
            preTokenBalances: [tokenBalance(0)],
            postTokenBalances: [tokenBalance(10_000)],
        },
    };
}

function pool() {
    return {
        address: '6e7V9eegCHw997T72MxgwwJipZ6GJyZF8NvjkzT1rvpN',
        dexId: 'meteora',
        quoteSymbol: 'SOL',
    };
}
