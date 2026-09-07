import { describe, expect, it } from 'vitest';
import { parseClientConfiguration } from '../worker/src/configuration.js';
import { recentCacheUrl, resolveRequestMint, streamObjectName } from '../worker/src/token-routing.js';
import { DEFAULT_TOKEN_CONTEXT } from '../js/token-presets.js';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const POOL = '6e7V9eegCHw997T72MxgwwJipZ6GJyZF8NvjkzT1rvpN';

describe('Worker per-token routing', () => {
    it('maps different mints to different Durable Object names', () => {
        expect(streamObjectName(DEFAULT_TOKEN_CONTEXT.identity.mint)).not.toBe(streamObjectName(USDC_MINT));
        expect(streamObjectName(DEFAULT_TOKEN_CONTEXT.identity.mint)).toContain(DEFAULT_TOKEN_CONTEXT.identity.mint);
    });

    it('requires a valid request mint and supports the ANSEM default for legacy URLs', () => {
        expect(resolveRequestMint(new URL('https://relay.example/stream'), DEFAULT_TOKEN_CONTEXT.identity.mint)).toMatchObject({
            ok: true,
            mint: DEFAULT_TOKEN_CONTEXT.identity.mint,
        });
        expect(resolveRequestMint(new URL('https://relay.example/stream?mint=invalid'), DEFAULT_TOKEN_CONTEXT.identity.mint)).toMatchObject({
            ok: false,
            status: 400,
        });
    });

    it('namespaces recent-snapshot cache keys by mint as well as pools', () => {
        const configuration = (mint) => ({ token: { mint }, pools: [{ address: POOL }] });
        expect(recentCacheUrl(configuration(DEFAULT_TOKEN_CONTEXT.identity.mint)))
            .not.toBe(recentCacheUrl(configuration(USDC_MINT)));
    });

    it('rejects a socket configuration for a mint other than its routed runtime', () => {
        const raw = JSON.stringify({
            type: 'configure',
            token: { mint: USDC_MINT, chain: 'solana' },
            pools: [{ address: POOL, dexId: 'fixture', quoteSymbol: 'SOL' }],
            market: { tokenPriceUsd: 1, solPriceUsd: 100 },
        });
        expect(parseClientConfiguration(raw, { expectedMint: DEFAULT_TOKEN_CONTEXT.identity.mint })).toBeNull();
        expect(parseClientConfiguration(raw, { expectedMint: USDC_MINT })?.token.mint).toBe(USDC_MINT);
    });
});
