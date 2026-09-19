import { describe, expect, it } from 'vitest';
import worker from '../worker/src/index.js';

const env = {
    ALLOWED_ORIGINS: 'https://ansem-frontline.vercel.app,https://powerpinkk.github.io',
};

describe('Worker health endpoint', () => {
    it.each([
        'https://ansem-frontline.vercel.app',
        'https://powerpinkk.github.io',
    ])('is lightweight, public and readable from %s', async (origin) => {
        const response = await worker.fetch(new Request('https://relay.example/health', {
            headers: { Origin: origin },
        }), env);
        expect(response.status).toBe(200);
        expect(response.headers.get('access-control-allow-origin')).toBe(origin);
        expect(response.headers.get('cache-control')).toBe('no-store');
        await expect(response.json()).resolves.toEqual({
            ok: true,
            service: 'ansem-frontline-stream',
        });
    });

    it('rejects an untrusted browser origin before reporting health', async () => {
        const response = await worker.fetch(new Request('https://relay.example/health', {
            headers: { Origin: 'https://attacker.example' },
        }), env);
        expect(response.status).toBe(403);
    });
});
