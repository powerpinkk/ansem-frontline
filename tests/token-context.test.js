import { describe, expect, it } from 'vitest';
import {
    createTokenContext,
    tokenCacheKey,
    tokenNamespace,
    validateSolanaMint,
    withTokenResolution,
} from '../js/token-context.js';
import { DEFAULT_TOKEN_CONTEXT } from '../js/token-presets.js';
import { createTokenRuntime } from '../js/state.js';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const JUP_MINT = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';

describe('TokenContext identity and mint validation', () => {
    it('accepts three real Solana mints and preserves case-sensitive identity', () => {
        const contexts = [
            DEFAULT_TOKEN_CONTEXT,
            createTokenContext({ mint: USDC_MINT, symbol: 'USDC', name: 'USD Coin', decimals: 6 }),
            createTokenContext({ mint: JUP_MINT, symbol: 'JUP', name: 'Jupiter', decimals: 6 }),
        ];
        expect(contexts.map((context) => context.identity.mint)).toEqual([
            DEFAULT_TOKEN_CONTEXT.identity.mint,
            USDC_MINT,
            JUP_MINT,
        ]);
        expect(contexts.every(Object.isFrozen)).toBe(true);
    });

    it('rejects empty, malformed, whitespace-padded and oversized mints explicitly', () => {
        expect(validateSolanaMint('')).toMatchObject({ ok: false, code: 'MINT_EMPTY' });
        expect(validateSolanaMint('0'.repeat(44))).toMatchObject({ ok: false, code: 'MINT_ENCODING' });
        expect(validateSolanaMint(`${JUP_MINT} `)).toMatchObject({ ok: false, code: 'MINT_WHITESPACE' });
        expect(validateSolanaMint('2'.repeat(32))).toMatchObject({ ok: false, code: 'MINT_LENGTH' });
        expect(validateSolanaMint('A'.repeat(10_000))).toMatchObject({ ok: false, code: 'MINT_TOO_LONG' });
    });

    it('does not allow a runtime or resolution to change mint', () => {
        const runtime = createTokenRuntime(DEFAULT_TOKEN_CONTEXT);
        expect(() => runtime.updateContext(createTokenContext({ mint: USDC_MINT }))).toThrow(/another mint/);
        expect(() => withTokenResolution(DEFAULT_TOKEN_CONTEXT, { mint: USDC_MINT })).toThrow(/change its mint/);
    });
});

describe('per-token runtime isolation', () => {
    it('isolates state, deduplication sets and cache namespaces for ANSEM, USDC and JUP', () => {
        const contexts = [
            DEFAULT_TOKEN_CONTEXT,
            createTokenContext({ mint: USDC_MINT }),
            createTokenContext({ mint: JUP_MINT }),
        ];
        const runtimes = contexts.map(createTokenRuntime);
        runtimes[0].state.price = 0.25;
        runtimes[0].state.liveTrades.push({ txHash: 'ansem-trade' });
        runtimes[0].seenTradeHashes.add('ansem-trade');
        runtimes[0].bootstrappedPools.add('ansem-pool');

        expect(runtimes.slice(1).map((runtime) => runtime.state.price)).toEqual([0, 0]);
        expect(runtimes.slice(1).every((runtime) => runtime.state.liveTrades.length === 0)).toBe(true);
        expect(runtimes.slice(1).every((runtime) => runtime.seenTradeHashes.size === 0)).toBe(true);
        expect(runtimes.slice(1).every((runtime) => runtime.bootstrappedPools.size === 0)).toBe(true);
        expect(new Set(runtimes.map((runtime) => runtime.namespace)).size).toBe(3);
        expect(new Set(contexts.map((context) => tokenCacheKey('startup', context, 'v2'))).size).toBe(3);
        expect(tokenNamespace(DEFAULT_TOKEN_CONTEXT)).toContain(DEFAULT_TOKEN_CONTEXT.identity.mint);
    });
});
