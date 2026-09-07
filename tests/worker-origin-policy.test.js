import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { configuredOrigins, corsHeaders, isAllowedOrigin } from '../worker/src/origin-policy.js';

const wrangler = JSON.parse(readFileSync(new URL('../worker/wrangler.jsonc', import.meta.url), 'utf8'));
const productionOrigins = wrangler.vars.ALLOWED_ORIGINS;

describe('worker origin policy', () => {
    it('allows both production deployments configured for the worker', () => {
        expect(configuredOrigins(productionOrigins)).toEqual([
            'https://ansem-frontline.vercel.app',
            'https://powerpinkk.github.io',
        ]);
        expect(isAllowedOrigin('https://ansem-frontline.vercel.app', productionOrigins)).toBe(true);
        expect(isAllowedOrigin('https://powerpinkk.github.io', productionOrigins)).toBe(true);
    });

    it('reflects an allowed origin without opening access to lookalike hosts', () => {
        const pagesOrigin = 'https://powerpinkk.github.io';
        expect(corsHeaders(pagesOrigin, productionOrigins)['access-control-allow-origin']).toBe(pagesOrigin);
        expect(isAllowedOrigin('https://powerpinkk.github.io.attacker.example', productionOrigins)).toBe(false);
        expect(isAllowedOrigin('http://localhost:4173', productionOrigins)).toBe(true);
        expect(isAllowedOrigin('http://localhost:4173.attacker.example', productionOrigins)).toBe(false);
    });
});
