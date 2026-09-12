import { describe, expect, it } from 'vitest';
import { verifyTransaction } from '../worker/src/transaction-evidence.js';
import { parseTransaction } from '../worker/src/parser.js';
import { swapFixture, MINT, USDC, TOKEN2022, signatureFor } from './fixtures/integrity.js';

const verify = (fixture, settlement = 'CONFIRMED') => verifyTransaction(fixture.transaction, fixture.signature, fixture.mint, settlement);
describe('positive economic swap evidence', () => {
    it.each(['pumpswap', 'dlmm', 'orca'].flatMap((protocol) => [true, false].map((isBuy) => ({ protocol, isBuy }))))(
        '$protocol direction $isBuy requires successful protocol and quote transfers', (options) => {
            const result = verify(swapFixture(options));
            expect(result.status).toBe('VERIFIED');
            expect(result.event).toMatchObject({ isBuy: options.isBuy, rawTokenAmount: '10000000000',
                rawQuoteAmount: '25000000000', solValue: 25, usdValue: null, slot: 100, settlement: 'CONFIRMED' });
            expect(result.event.nativeBalanceDeltas[0].lamports).toBe('-5000');
        });
    it.each(['pumpswap', 'dlmm', 'orca'])('normalizes a nested routed %s leg once', (protocol) => {
        const f = swapFixture({ protocol, routed: true, quoteMint: USDC, rawQuote: '2500000000' });
        const e = verify(f).event;
        expect(e).toMatchObject({ quoteSymbol: 'USDC', quoteAmount: 2500, solValue: null, usdValue: null });
        expect(e.instructions).toHaveLength(1);
        expect(e.instructions[0].innerIndex).toBe(0);
    });
    it('client prices and spoofed pool labels cannot change verified evidence', () => {
        const f = swapFixture();
        const results = [.001, .02, 999].map((price) => parseTransaction(f.transaction, f.signature,
            { dexId: 'fake', quoteSymbol: 'fake', address: 'fake' }, MINT, { tokenPriceUsd: price, solPriceUsd: price }));
        expect(results[0]).not.toBeNull();
        expect(results[1]).toEqual(results[0]); expect(results[2]).toEqual(results[0]);
    });
    it.each(['transfer', 'airdrop', 'mint', 'burn', 'LP deposit', 'LP withdrawal', 'native transfer'])('never infers a swap from %s deltas', () => {
        const f = swapFixture(); f.transaction.transaction.message.instructions[0].data = '111111111111111111111111';
        expect(verify(f).event).toBeNull();
    });
    it('rejects failed transactions and caught failed swap CPI', () => {
        const failed = swapFixture(); failed.transaction.meta.err = { InstructionError: [0, 'Custom'] };
        expect(verify(failed).status).toBe('FAILED');
        const caught = swapFixture({ routed: true });
        caught.transaction.meta.logMessages[5] = caught.transaction.meta.logMessages[5].replace('success', 'failed: custom program error');
        // Replace the swap's own success explicitly; outer router still succeeds.
        caught.transaction.meta.logMessages = caught.transaction.meta.logMessages.map((l) => l.includes('pAMMB') && l.endsWith('success') ? l.replace('success', 'failed: custom') : l);
        expect(verify(caught).event).toBeNull();
    });
    it('requires counterflow, matching vault mints and complete invocation evidence', () => {
        const absent = swapFixture(); absent.transaction.meta.innerInstructions[0].instructions.pop();
        expect(verify(absent).event).toBeNull();
        const wrong = swapFixture(); wrong.transaction.transaction.message.instructions[0].accounts[3] = USDC;
        expect(verify(wrong).reason).toBe('POOL_MINT_MISMATCH');
        const missing = swapFixture(); missing.transaction.meta.logMessages = [];
        expect(verify(missing).reason).toBe('SWAP_INVOCATION_NOT_SUCCESSFUL');
    });
    it.each(['9007199254740993', '1'])('preserves exact raw quantity %s beyond floating precision', (rawAmount) => {
        // Vault reserves must remain within u64.
        const event = verify(swapFixture({ rawAmount, decimals: 9 })).event;
        expect(event.rawTokenAmount).toBe(rawAmount);
    });
    it('accepts checked Token-2022 with matching net flows; rejects fees and hooks', () => {
        expect(verify(swapFixture({ token2022: true })).status).toBe('VERIFIED');
        const fee = swapFixture({ token2022: true });
        fee.transaction.meta.postTokenBalances[0].uiTokenAmount.amount = '9999999999';
        expect(verify(fee).event).toBeNull();
        const hook = swapFixture({ token2022: true });
        hook.transaction.meta.innerInstructions[0].instructions.splice(1, 0, { programId: TOKEN2022, stackHeight: 3 });
        expect(verify(hook).reason).toBe('TOKEN_2022_HOOK_UNSUPPORTED');
    });
    it('rejects net-zero routes, unrelated same-transaction transfers and mismatched signatures', () => {
        const zero = swapFixture(); zero.transaction.meta.postTokenBalances[0].uiTokenAmount.amount = '0';
        expect(verify(zero).event).toBeNull();
        const unrelated = swapFixture(); unrelated.transaction.meta.postTokenBalances[0].uiTokenAmount.amount = '10000000001';
        expect(verify(unrelated).event).toBeNull();
        const f = swapFixture();
        expect(verifyTransaction(f.transaction, signatureFor(2), MINT).event).toBeNull();
    });
    it('does not fabricate chain time when blockTime is absent', () => {
        expect(verify(swapFixture({ blockTime: null })).event).toMatchObject({ blockTime: null, timestamp: null });
    });
});
