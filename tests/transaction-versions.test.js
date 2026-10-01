import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { verifyPoolExecutions } from '../worker/src/pool-executions.js';
import { verifyTransaction } from '../worker/src/transaction-evidence.js';
import { base58, swapFixture, signatureFor } from './fixtures/integrity.js';
import { routerFixture } from './fixtures/router.js';

// Synthetic RPC-contract variants, NOT captures of live v1 transactions.
// JSON v1 has static accounts and transactionConfig; binary wire decoding is
// performed by the trusted RPC. Reference: https://solana.com/upgrades/larger-transaction-sizes
function withVersion(fixture, version, compiled = false) {
    const f = structuredClone(fixture), tx = f.transaction, message = tx.transaction.message;
    if (version === undefined) delete tx.version; else tx.version = version;
    delete message.addressTableLookups;
    delete tx.meta.loadedAddresses;
    for (const key of message.accountKeys) key.source = 'transaction';
    if (version === 1) message.transactionConfig = {
        computeUnitLimit: 200_000, loadedAccountsDataSizeLimit: 64_000_000, heapSize: null, priorityFee: null,
    };
    if (compiled) {
        const keys = message.accountKeys.map((key) => key.pubkey);
        const signers = message.accountKeys.filter((key) => key.signer).map((key) => key.pubkey);
        expect(keys.slice(0, signers.length)).toEqual(signers);
        message.header = { numRequiredSignatures: signers.length, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 0 };
        message.accountKeys = keys;
        for (const ix of [...message.instructions, ...tx.meta.innerInstructions.flatMap((group) => group.instructions)]) {
            if (ix.parsed) {
                const checked = ix.parsed.type === 'transferChecked', info = ix.parsed.info;
                expect(['transfer', 'transferChecked']).toContain(ix.parsed.type);
                const data = Buffer.alloc(checked ? 10 : 9); data[0] = checked ? 12 : 3;
                data.writeBigUInt64LE(BigInt(checked ? info.tokenAmount.amount : info.amount), 1);
                if (checked) data[9] = info.tokenAmount.decimals;
                const authority = info.authority ?? tx.meta.preTokenBalances.find((balance) => keys[balance.accountIndex] === info.source)?.owner;
                expect(keys).toContain(authority);
                ix.accounts = checked ? [info.source, info.mint, info.destination, authority]
                    : [info.source, info.destination, authority];
                ix.data = base58(data); delete ix.parsed;
            }
            ix.programIdIndex = keys.indexOf(ix.programId); delete ix.programId;
            if (ix.accounts) ix.accounts = ix.accounts.map((key) => keys.indexOf(key));
        }
    }
    return f;
}
const pool = (f, settlement = 'CONFIRMED') => verifyPoolExecutions(f.transaction, f.signature, f.market, settlement);
const user = (f) => verifyTransaction(f.transaction, f.signature, f.mint);

describe.each([undefined, 'legacy', 0, 1])('transaction version %s', (version) => {
    it.each([false, true])('preserves verified pool effects and finality (compiled=%s)', (compiled) => {
        for (const protocol of ['pumpswap', 'dlmm', 'orca']) for (const routed of [false, true]) {
            const original = swapFixture({ protocol, routed });
            const expected = pool(original, 'FINALIZED');
            expect(expected.status).toBe('VERIFIED');
            expect(pool(withVersion(original, version, compiled), 'FINALIZED')).toEqual(expected);
        }
    });
    it.each([false, true])('preserves independent user attribution and router CPI (compiled=%s)', (compiled) => {
        for (const original of [swapFixture(), routerFixture({ multiHop: true })]) {
            const expected = user(original);
            expect(expected.event).not.toBeNull();
            expect(user(withVersion(original, version, compiled))).toEqual(expected);
        }
    });
});

describe('bounded v1 JSON verification', () => {
    it('preserves Pump curve economic evidence in a v1-shaped retained fixture', () => {
        const original = JSON.parse(readFileSync(new URL('./fixtures/public-chain/pump-curve-5PLzrxBbYJ7v.json', import.meta.url)));
        const expected = pool(original, 'FINALIZED');
        expect(expected.status).toBe('VERIFIED');
        const f = withVersion(original, 1);
        expect(pool(f, 'FINALIZED')).toEqual(expected);
        f.transaction.version = 2;
        expect(pool(f).events).toEqual([]);
        expect(pool(f).reason).toBe('UNSUPPORTED_TRANSACTION_VERSION');
    });

    it.each([null, -1, 2, '1', '0', 1.5, {}])('rejects unsupported or ambiguous version %s in both pipelines', (version) => {
        const f = swapFixture(); f.transaction.version = version;
        expect(pool(f)).toMatchObject({ events: [], reason: 'UNSUPPORTED_TRANSACTION_VERSION' });
        expect(user(f)).toMatchObject({ event: null, reason: 'UNSUPPORTED_TRANSACTION_VERSION' });
    });

    it.each([
        ['missing config', (f) => { delete f.transaction.transaction.message.transactionConfig; }],
        ['null config', (f) => { f.transaction.transaction.message.transactionConfig = null; }],
        ['array config', (f) => { f.transaction.transaction.message.transactionConfig = []; }],
        ['foreign signature', (f) => { f.transaction.transaction.signatures[0] = signatureFor(2); }],
        ['missing signer', (f) => { f.transaction.transaction.message.accountKeys.forEach((key) => { key.signer = false; }); }],
        ['ALT descriptor', (f) => { f.transaction.transaction.message.addressTableLookups = [{}]; }],
        ['ALT keys', (f) => { f.transaction.transaction.message.accountKeys[1].source = 'lookupTable'; }],
        ['loaded addresses', (f) => { f.transaction.meta.loadedAddresses = { writable: [f.pool], readonly: [] }; }],
        ['malformed ALT metadata', (f) => { f.transaction.transaction.message.addressTableLookups = {}; }],
        ['unproven CPI', (f) => { f.transaction.meta.logMessages = []; }],
        ['bad balance index', (f) => { f.transaction.meta.postTokenBalances[0].accountIndex = -1; }],
        ['wrong transfer amount', (f) => { f.transaction.meta.innerInstructions[0].instructions[0].parsed.info.tokenAmount.amount = '1'; }],
    ])('does not grant authority for %s', (_name, mutate) => {
        const f = withVersion(swapFixture(), 1); mutate(f);
        expect(pool(f).events).toEqual([]);
        expect(user(f).event).toBeNull();
    });

    it.each([undefined, 'legacy', 0])('does not accept v1 configuration under version %s', (version) => {
        const f = withVersion(swapFixture(), 1); f.transaction.version = version;
        expect(pool(f)).toMatchObject({ events: [], reason: 'TRANSACTION_VERSION_MISMATCH' });
        expect(user(f)).toMatchObject({ event: null, reason: 'TRANSACTION_VERSION_MISMATCH' });
    });

    it('does not include the v1 priority fee in pool quote notional', () => {
        const f = withVersion(swapFixture(), 1), expected = pool(f).events[0];
        f.transaction.transaction.message.transactionConfig.priorityFee = 50_000;
        f.transaction.meta.fee += 50_000; f.transaction.meta.postBalances[0] -= 50_000;
        expect(pool(f).events[0]).toEqual(expected);
    });
});
