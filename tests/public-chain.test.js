import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { verifyTransaction } from '../worker/src/transaction-evidence.js';
import { MINT } from './fixtures/integrity.js';

for (const [name, slot, rawTokenAmount, rawQuoteAmount, innerIndex] of [
    ['pumpswap-4YquguNEKkyk', 446437184, '126000000', '182115486', null],
    ['pumpswap-4hRRByUJeR5c', 446442038, '300000000', '433333074', 0],
]) it(`replays public finalized ${name} against independently checked quantities`, () => {
    const s = JSON.parse(readFileSync(new URL(`./fixtures/public-chain/${name}.json`, import.meta.url)));
    const result = verifyTransaction(s.transaction, s.signature, MINT, 'FINALIZED');
    expect(result.event).toMatchObject({ slot, isBuy: false, rawTokenAmount, rawQuoteAmount,
        settlement: 'FINALIZED', tokenBalanceDelta: `-${rawTokenAmount}`, usdValue: null });
    expect(result.event.instructions).toHaveLength(1);
    expect(result.event.instructions[0].innerIndex).toBe(innerIndex);
    // Independent ledger check: exact signer-owned token accounts, no parser helper.
    const owner = result.event.wallet;
    const sum = (balances) => balances.filter((b) => b.owner === owner && b.mint === MINT)
        .reduce((n, b) => n + BigInt(b.uiTokenAmount.amount), 0n);
    expect(sum(s.transaction.meta.postTokenBalances) - sum(s.transaction.meta.preTokenBalances)).toBe(-BigInt(rawTokenAmount));
});

for (const [name, reason] of [
    ['meteora-dlmm-doqiTDJ9hQ24', 'UNEXPLAINED_TRACKED_TOKEN_DELTA'],
    ['orca-whirlpool-2mDVSCJsYb2s', 'ECONOMIC_OWNER_NOT_SIGNER'],
]) it(`keeps unsupported public route ${name} out of authority`, () => {
    const s = JSON.parse(readFileSync(new URL(`./fixtures/public-chain/${name}.json`, import.meta.url)));
    expect(verifyTransaction(s.transaction, s.signature, MINT, 'FINALIZED')).toEqual({ status: 'UNVERIFIED', reason, event: null });
});
