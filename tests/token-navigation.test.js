import { describe, expect, it } from 'vitest';
import { buildTokenUrl, historyPath, readTokenRoute } from '../js/token-navigation.js';
import { DEFAULT_TOKEN_CONTEXT } from '../js/token-presets.js';

const ANSEM = DEFAULT_TOKEN_CONTEXT.identity.mint;
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

describe('token URL navigation', () => {
    it('maps the base URL to the ANSEM default route', () => {
        expect(readTokenRoute('https://example.test/ansem-frontline/')).toEqual({ kind: 'default', mint: null });
    });

    it('reads a valid deep-linked token', () => {
        expect(readTokenRoute(`https://example.test/?token=${USDC}`)).toEqual({ kind: 'token', mint: USDC });
    });

    it('reports an invalid URL mint without throwing', () => {
        expect(readTokenRoute('https://example.test/?token=javascript:alert(1)')).toMatchObject({
            kind: 'invalid',
            validation: { ok: false },
        });
    });

    it('does not silently turn an explicit empty token query into ANSEM', () => {
        expect(readTokenRoute('https://example.test/?token=')).toMatchObject({
            kind: 'invalid',
            validation: { code: 'MINT_EMPTY' },
        });
    });

    it('creates a query deep link while preserving a Pages base path and other state', () => {
        const url = buildTokenUrl('https://powerpinkk.github.io/ansem-frontline/?diagnostics=1#field', USDC, ANSEM);
        expect(url.pathname).toBe('/ansem-frontline/');
        expect(url.searchParams.get('token')).toBe(USDC);
        expect(url.searchParams.get('diagnostics')).toBe('1');
        expect(url.hash).toBe('#field');
    });

    it('represents default ANSEM by removing only the token query', () => {
        const url = buildTokenUrl(`https://example.test/app/?token=${USDC}&diagnostics=1`, ANSEM, ANSEM);
        expect(url.searchParams.has('token')).toBe(false);
        expect(url.searchParams.get('diagnostics')).toBe('1');
    });

    it('builds a history path without changing origin or requiring an SPA route', () => {
        expect(historyPath(`https://example.test/ansem-frontline/?token=${USDC}#field`))
            .toBe(`/ansem-frontline/?token=${USDC}#field`);
    });

    it('refuses to create a URL from an unvalidated mint', () => {
        expect(() => buildTokenUrl('https://example.test/', 'not-a-mint', ANSEM)).toThrow(/Mint/);
    });
});
