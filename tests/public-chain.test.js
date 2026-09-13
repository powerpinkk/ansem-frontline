import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { verifyTransaction } from '../worker/src/transaction-evidence.js';
import { MINT } from './fixtures/integrity.js';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import idl from '../worker/src/idl/jupiter-v6.js';
import { decodeRouterInstruction, JUPITER_PROGRAM } from '../worker/src/router-decoder.js';

for (const [name, slot, rawTokenAmount, rawQuoteAmount, innerIndex] of [
    ['pumpswap-4YquguNEKkyk', 446437184, '126000000', '182115486', null],
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

it('pinned route layouts are identical to the retained program-owned mainnet IDL', () => {
    const p = JSON.parse(readFileSync(new URL('../docs/jupiter-idl-provenance.json', import.meta.url)));
    const b = Buffer.from(p.accountData[0], 'base64');
    const data = inflateSync(b.subarray(44, 44 + b.readUInt32LE(40)));
    expect(createHash('sha256').update(data).digest('hex')).toBe(p.sha256);
    expect(p.owner).toBe(JUPITER_PROGRAM);
    const original = JSON.parse(data);
    expect(idl.instructions).toEqual(original.instructions.filter((x) => x.name.includes('route') && !x.name.includes('ledger')));
    for (const instruction of idl.instructions) expect(instruction.discriminator).toEqual([...createHash('sha256').update(`global:${instruction.name}`).digest().subarray(0, 8)]);
});

it('current mainnet shared V2 intent decodes; unsupported execution cannot be promoted', () => {
    const s = JSON.parse(readFileSync(new URL('./fixtures/public-chain/jupiter-2ZfyGQ1Znbti.json', import.meta.url)));
    const ix = s.transaction.transaction.message.instructions.find((x) => x.programId === JUPITER_PROGRAM);
    const d = decodeRouterInstruction(ix);
    expect(d.name).toBe('shared_accounts_route_v2'); expect(d.shared).toBe(true);
    expect(d.args.route_plan.map((s) => s.swap.name)).toEqual(['BisonFiV2', 'GoonFiV3', 'RaydiumCP']);
    expect(d.accounts.user_transfer_authority).toBe(ix.accounts[1]);
    expect(verifyTransaction(s.transaction, s.signature, d.accounts.destination_mint).event).toBeNull();
});

it('current failed shared route retains failure even with known DLMM instruction', () => {
    const s = JSON.parse(readFileSync(new URL('./fixtures/public-chain/jupiter-5TMkJvPGVbaT.json', import.meta.url)));
    const ix = s.transaction.transaction.message.instructions.find((x) => x.programId === JUPITER_PROGRAM);
    const d = decodeRouterInstruction(ix);
    expect(d.name).toBe('shared_accounts_route');
    expect(d.args.route_plan[0].swap.name).toBe('MeteoraDlmm');
    expect(verifyTransaction(s.transaction, s.signature, d.accounts.destination_mint)).toMatchObject({ status: 'FAILED', event: null });
});

for (const [name, reason] of [
    ['meteora-dlmm-doqiTDJ9hQ24', 'UNSUPPORTED_ROUTER_FEES'],
    ['orca-whirlpool-2mDVSCJsYb2s', 'UNSUPPORTED_ROUTER'],
    // M10.1b deliberately closes the unknown-wrapper fallback, even when a
    // signer net delta matched in M10.1. Wrapper intent has no supported proof.
    ['pumpswap-4hRRByUJeR5c', 'UNSUPPORTED_ROUTER'],
]) it(`keeps unsupported public route ${name} out of authority`, () => {
    const s = JSON.parse(readFileSync(new URL(`./fixtures/public-chain/${name}.json`, import.meta.url)));
    expect(verifyTransaction(s.transaction, s.signature, MINT, 'FINALIZED')).toEqual({ status: 'UNVERIFIED', reason, event: null });
});
