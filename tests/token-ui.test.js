import { describe, expect, it, vi } from 'vitest';
import { copyText, createTokenViewModel, safeTokenImageUrl, shortenAddress } from '../js/token-ui.js';

const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

describe('safe token presentation', () => {
    it('bounds hostile name and symbol text without interpreting markup', () => {
        const view = createTokenViewModel(context({
            symbol: '<img src=x onerror=alert(1)>'.repeat(4),
            name: '<script>globalThis.pwned=true</script>'.repeat(6),
        }));
        expect(view.symbol.length).toBeLessThanOrEqual(16);
        expect(view.name.length).toBeLessThanOrEqual(80);
        expect(view.symbol).toContain('<img');
    });

    it('accepts only HTTPS token images', () => {
        expect(safeTokenImageUrl('https://cdn.example/token.png')).toBe('https://cdn.example/token.png');
        expect(safeTokenImageUrl('javascript:alert(1)')).toBeNull();
        expect(safeTokenImageUrl('data:image/svg+xml,<svg onload=alert(1)>')).toBeNull();
        expect(safeTokenImageUrl('http://cdn.example/token.png')).toBeNull();
    });

    it('provides a usable model when the logo is absent', () => {
        expect(createTokenViewModel(context({ imageUrl: null }))).toMatchObject({ imageUrl: null, symbol: 'TOK' });
    });

    it('distinguishes a real zero supply from unknown supply', () => {
        expect(createTokenViewModel(context({ supply: 0 })).supply).toBe('0');
        expect(createTokenViewModel(context({ supply: null })).supply).toBeNull();
    });

    it('shows only a shortened mint and reference pool in compact fields', () => {
        const view = createTokenViewModel(context({ pool: MINT }));
        expect(view.shortMint).toBe('EPjFWd…yTDt1v');
        expect(view.pool).toBe('orca · EPjFWd…yTDt1v');
    });

    it('copies a CA through the Clipboard API', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        await expect(copyText(MINT, { clipboard: { writeText } })).resolves.toBe(true);
        expect(writeText).toHaveBeenCalledWith(MINT);
    });

    it('copies a share URL without allowing unbounded payloads', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        const longValue = `https://example.test/?token=${MINT}${'x'.repeat(4_000)}`;
        await copyText(longValue, { clipboard: { writeText } });
        expect(writeText.mock.calls[0][0].length).toBe(2_048);
    });

    it('shortens addresses without changing short labels', () => {
        expect(shortenAddress('ANSEM')).toBe('ANSEM');
        expect(shortenAddress(MINT)).toMatch(/^EPjFWd…yTDt1v$/);
    });
});

function context({ symbol = 'TOK', name = 'Token', imageUrl = null, supply = null, pool = null } = {}) {
    return {
        identity: { mint: MINT, symbol, name },
        metadata: { imageUrl },
        supply,
        resources: { referencePool: pool ? { address: pool, dexId: 'orca' } : null },
        discovery: { source: 'dexscreener' },
    };
}
