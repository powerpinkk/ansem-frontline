import { expect, it } from 'vitest';
import { parseClientConfiguration } from '../worker/src/configuration.js';
import { MINT, SOL } from './fixtures/integrity.js';
it('accepts identifiers only and discards browser conclusions, pools and prices', () => {
    for (const price of [.001, .02, 999, Infinity]) {
        expect(parseClientConfiguration(JSON.stringify({ type: 'configure', token: { mint: MINT },
            pools: [{ address: 'malicious', programId: 'attacker' }], rpc: 'https://attacker.example',
            market: { tokenPriceUsd: price }, isBuy: true, settlement: 'FINALIZED' })))
            .toEqual({ token: { mint: MINT, chain: 'solana' } });
    }
});
it('rejects invalid identities, wrong chain, cross-token requests and oversized input', () => {
    for (const raw of ['{}', 'null', '{', 'x'.repeat(8001), JSON.stringify({ type: 'configure', token: { mint: 'invalid' } }),
        JSON.stringify({ type: 'configure', token: { mint: MINT, chain: 'ethereum' } })]) {
        expect(parseClientConfiguration(raw)).toBeNull();
    }
    expect(parseClientConfiguration(JSON.stringify({ type: 'configure', token: { mint: MINT } }), { expectedMint: SOL })).toBeNull();
});
