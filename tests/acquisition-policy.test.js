import { describe, expect, it, vi } from 'vitest';
import { AcquisitionError, createAcquisitionPolicy, createJsonRpcTransport, retryAfterMs } from '../worker/src/acquisition-policy.js';

function harness() {
    let time = 1_000;
    const stored = new Map();
    const storage = { get: async (key) => stored.get(key), put: async (key, value) => stored.set(key, structuredClone(value)) };
    return { now: () => time, advance: (ms) => { time += ms; }, storage,
        policy: createAcquisitionPolicy({ storage, now: () => time, random: () => 0.5,
            sleep: async (ms) => { time += ms; } }) };
}

describe('typed token acquisition policy', () => {
    it('parses Retry-After delta/date and never shortens a provider deadline', async () => {
        expect(retryAfterMs('12', 1_000)).toBe(12_000);
        expect(retryAfterMs(new Date(31_000).toUTCString(), 1_000)).toBe(30_000);
        const h = harness();
        await expect(h.policy.run('standard', 'history', async () => {
            throw new AcquisitionError('RPC_HTTP_429', { kind: 'RATE_LIMIT', status: 429, retryAfterMs: 420_000 });
        })).rejects.toMatchObject({ reason: 'RPC_HTTP_429', retryAt: 427_000 });
        expect(h.policy.snapshot().standard).toMatchObject({ status: 'RETRY_WAIT', probeKey: 'history', nextRetryAt: 427_000 });
    });

    it('isolates DAS, admits one affected half-open probe and rejects unrelated healing', async () => {
        const h = harness();
        await expect(h.policy.run('standard', 'transaction', async () => {
            throw new AcquisitionError('RPC_HTTP_429', { kind: 'RATE_LIMIT' });
        })).rejects.toMatchObject({ kind: 'RATE_LIMIT' });
        await expect(h.policy.run('standard', 'state', async () => 'wrong-heal')).rejects.toMatchObject({ deferred: true });
        await expect(h.policy.run('das', 'asset:token', async () => 'healthy-das')).resolves.toBe('healthy-das');
        const retryAt = h.policy.snapshot().standard.nextRetryAt;
        h.advance(retryAt - h.now());
        await expect(h.policy.run('standard', 'transaction', async () => 'verified')).resolves.toBe('verified');
        expect(h.policy.snapshot().standard).toMatchObject({ status: 'HEALTHY', reason: null, nextRetryAt: 0 });
    });

    it('keeps early transient backoff method-local and opens a shared cooldown after three failures', async () => {
        const h = harness();
        for (let attempt = 0; attempt < 3; attempt += 1) {
            await expect(h.policy.run('standard', 'valuation', async () => {
                throw new AcquisitionError('RPC_TIMEOUT', { kind: 'TIMEOUT' });
            })).rejects.toMatchObject({ kind: 'TIMEOUT' });
            if (attempt < 2) {
                const retryAt = h.policy.snapshot().standard.nextRetryAt;
                if (retryAt) h.advance(retryAt - h.now());
                else h.advance(5_000);
            }
        }
        expect(h.policy.snapshot().standard).toMatchObject({ status: 'RETRY_WAIT', probeKey: 'valuation' });
        expect(h.policy.snapshot().standard.nextRetryAt - h.now()).toBeGreaterThanOrEqual(60_000);
    });

    it('rejects malformed envelopes/results while accepting a valid transaction null', async () => {
        const malformed = createJsonRpcTransport({ HELIUS_API_KEY: 'test' }, vi.fn(async () => new Response(JSON.stringify({
            jsonrpc: '2.0', result: { value: 'not-an-array' },
        }), { headers: { 'content-type': 'application/json' } })));
        await expect(malformed('getMultipleAccounts', [])).rejects.toMatchObject({ kind: 'MALFORMED', reason: 'RPC_MALFORMED_RESULT' });
        const pending = createJsonRpcTransport({ HELIUS_API_KEY: 'test' }, vi.fn(async () => new Response(JSON.stringify({
            jsonrpc: '2.0', result: null,
        }), { headers: { 'content-type': 'application/json' } })));
        await expect(pending('getTransaction', [])).resolves.toBeNull();
    });

    it('enforces rolling standard/DAS ceilings across a fixed-window boundary', async () => {
        const h = harness(); const standardStarts = [];
        for (let i = 0; i < 162; i += 1) {
            await h.policy.run('standard', `work:${i}`, async () => { standardStarts.push(h.now()); return i; });
        }
        await expect(h.policy.run('standard', 'overflow', async () => true)).rejects.toMatchObject({ deferred: true });
        expect(standardStarts.every((at, index) => index === 0 || at - standardStarts[index - 1] >= 250)).toBe(true);
        h.advance(standardStarts[0] + 60_000 - h.now());
        await expect(h.policy.run('standard', 'boundary', async () => true)).resolves.toBe(true);

        const das = harness();
        for (let i = 0; i < 4; i += 1) await das.policy.run('das', `asset:${i}`, async () => i);
        await expect(das.policy.run('das', 'asset:overflow', async () => true)).rejects.toMatchObject({ deferred: true });
    });

    it('restores an active cooldown after a DO restart and keeps tokens isolated', async () => {
        const first = harness();
        await expect(first.policy.run('standard', 'history', async () => {
            throw new AcquisitionError('RPC_HTTP_429', { kind: 'RATE_LIMIT' });
        })).rejects.toMatchObject({ kind: 'RATE_LIMIT' });
        const restarted = createAcquisitionPolicy({ storage: first.storage, now: first.now, random: () => 0,
            sleep: async (ms) => first.advance(ms) });
        await expect(restarted.run('standard', 'history', async () => true)).rejects.toMatchObject({ deferred: true });
        const otherToken = createAcquisitionPolicy({ now: first.now, random: () => 0,
            sleep: async (ms) => first.advance(ms) });
        await expect(otherToken.run('standard', 'history', async () => 'isolated')).resolves.toBe('isolated');
    });
});
