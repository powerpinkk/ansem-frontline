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

function controlledHarness() {
    let time = 1_000;
    let automatic = true;
    const sleepers = [];
    const stored = new Map();
    const storage = { get: async (key) => stored.get(key), put: async (key, value) => stored.set(key, structuredClone(value)) };
    const sleep = (ms) => {
        if (automatic) { time += ms; return Promise.resolve(); }
        return new Promise((resolve) => sleepers.push({ at: time + ms, resolve }));
    };
    const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
    return { now: () => time, storage, setControlled: () => { automatic = false; },
        async advance(ms) {
            time += ms;
            const due = [];
            for (let index = sleepers.length - 1; index >= 0; index -= 1) {
                if (sleepers[index].at <= time) due.push(...sleepers.splice(index, 1));
            }
            for (const item of due.reverse()) item.resolve();
            await flush();
        }, flush,
        policy: createAcquisitionPolicy({ storage, now: () => time, random: () => 0, sleep }),
    };
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

    it('atomically reserves standard admission near the rolling boundary under eight competing callers', async () => {
        const h = controlledHarness();
        const starts = [];
        for (let i = 0; i < 160; i += 1) await h.policy.run('standard', `warm:${i}`, async () => { starts.push(h.now()); return true; });
        h.setControlled();
        let active = 0, maximumActive = 0;
        const releases = [];
        const contenders = Array.from({ length: 270 }, (_, index) => h.policy.run('standard', `contender:${index}`, async () => {
            starts.push(h.now()); active += 1; maximumActive = Math.max(maximumActive, active);
            await new Promise((resolve) => releases.push(resolve)); active -= 1; return index;
        }));
        await h.flush();
        expect(h.policy.snapshot().standard).toMatchObject({ attemptsInRollingMinute: 160 });
        expect(h.policy.snapshot().standard).toMatchObject({queued:255,queueLimit:256});
        await h.advance(250);
        await h.advance(250);
        expect(starts).toHaveLength(162);
        expect(starts.every((at,index)=>index===0||at-starts[index-1]>=250)).toBe(true);
        expect(maximumActive).toBeLessThanOrEqual(2);
        releases.splice(0).forEach((release) => release());
        await h.flush();
        const results = await Promise.allSettled(contenders);
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
        expect(results.filter((result) => result.status === 'rejected')).toHaveLength(268);
        expect(results.some((result)=>result.status==='rejected'&&result.reason.reason==='STANDARD_QUEUE_FULL')).toBe(true);
        expect(h.policy.snapshot().standard.attemptsInRollingMinute).toBe(162);
        for (const windowStart of starts) {
            expect(starts.filter((at) => at >= windowStart && at < windowStart + 60_000).length).toBeLessThanOrEqual(162);
        }
    });

    it('serializes DAS admission and rechecks a new 429 before queued work can start', async () => {
        const h = controlledHarness();
        for (let i = 0; i < 3; i += 1) await h.policy.run('das', `warm:${i}`, async () => true);
        h.setControlled();
        let rejectFirst;
        const starts = [];
        const first = h.policy.run('das', 'asset:first', async () => {
            starts.push(h.now());
            await new Promise((_resolve, reject) => { rejectFirst = reject; });
        });
        const waiting = Array.from({ length: 7 }, (_, index) => h.policy.run('das', `asset:waiting:${index}`, async () => {
            starts.push(h.now()); return index;
        }));
        await h.flush();
        await h.advance(1_000);
        expect(starts).toHaveLength(1);
        rejectFirst(new AcquisitionError('RPC_HTTP_429', { kind: 'RATE_LIMIT' }));
        await expect(first).rejects.toMatchObject({ kind: 'RATE_LIMIT' });
        await h.flush();
        const results = await Promise.allSettled(waiting);
        expect(results.every((result) => result.status === 'rejected')).toBe(true);
        expect(starts).toHaveLength(1);
        expect(h.policy.snapshot().das).toMatchObject({ status: 'RETRY_WAIT', active: 0 });
    });

    it('admits one real alternate-key half-open probe and renews cooldown when it fails', async () => {
        const h = controlledHarness();
        await expect(h.policy.run('standard', 'getTransaction', async () => {
            throw new AcquisitionError('RPC_HTTP_429', { kind: 'RATE_LIMIT' });
        })).rejects.toMatchObject({ kind: 'RATE_LIMIT' });
        const retryAt = h.policy.snapshot().standard.nextRetryAt;
        await expect(h.policy.run('standard', 'getMultipleAccounts', async () => true)).rejects.toMatchObject({ deferred: true });
        h.setControlled();
        await h.advance(retryAt - h.now());
        let rejectProbe;
        const starts = [];
        const probe = h.policy.run('standard', 'getMultipleAccounts', async () => {
            starts.push(h.now());
            await new Promise((_resolve, reject) => { rejectProbe = reject; });
        });
        const competitors = Array.from({ length: 7 }, (_, index) => h.policy.run('standard', `other:${index}`, async () => {
            starts.push(h.now()); return index;
        }));
        await h.flush();
        expect(starts).toHaveLength(1);
        rejectProbe(new AcquisitionError('RPC_HTTP_429', { kind: 'RATE_LIMIT' }));
        await expect(probe).rejects.toMatchObject({ kind: 'RATE_LIMIT' });
        const renewed = h.policy.snapshot().standard.nextRetryAt;
        expect(renewed).toBeGreaterThan(retryAt);
        const results = await Promise.allSettled(competitors);
        expect(results.every((result) => result.status === 'rejected')).toBe(true);
        expect(starts).toHaveLength(1);
    });

    it('lets an alternate necessary read reopen only the persisted provider group', async () => {
        const first = harness();
        await expect(first.policy.run('standard', 'getTransaction', async () => {
            throw new AcquisitionError('RPC_HTTP_429', { kind: 'RATE_LIMIT' });
        })).rejects.toMatchObject({ kind: 'RATE_LIMIT' });
        const retryAt = first.policy.snapshot().standard.nextRetryAt;
        const restarted = createAcquisitionPolicy({ storage: first.storage, now: first.now, random: () => 0,
            sleep: async (ms) => first.advance(ms) });
        await restarted.ready();
        await expect(restarted.run('standard', 'getMultipleAccounts', async () => true)).rejects.toMatchObject({ deferred: true });
        first.advance(retryAt - first.now());
        await expect(restarted.run('standard', 'getMultipleAccounts', async () => 'bootstrap')).resolves.toBe('bootstrap');
        expect(restarted.snapshot().standard).toMatchObject({ status: 'HEALTHY', reason: null, probeKey: null });
    });

    it.each(['success-first', 'failure-first'])('retains a late shared throttle across concurrent %s completion and restart', async (order) => {
        const h = controlledHarness();
        let resolveState, rejectTransaction;
        const transaction = h.policy.run('standard', 'getTransaction', async () => new Promise((_resolve, reject) => {
            rejectTransaction = reject;
        }));
        await h.flush();
        h.setControlled();
        const state = h.policy.run('standard', 'getMultipleAccounts', async () => new Promise((resolve) => {
            resolveState = resolve;
        }));
        await h.advance(250);
        const rateLimit = () => rejectTransaction(new AcquisitionError('RPC_HTTP_429', {
            kind: 'RATE_LIMIT', status: 429, retryAfterMs: 420_000,
        }));
        if (order === 'success-first') {
            resolveState('state'); await expect(state).resolves.toBe('state');
            await h.advance(250); rateLimit();
        } else {
            rateLimit(); await expect(transaction).rejects.toMatchObject({ kind: 'RATE_LIMIT' });
            await h.advance(250); resolveState('state'); await expect(state).resolves.toBe('state');
        }
        if (order === 'success-first') await expect(transaction).rejects.toMatchObject({
            kind: 'RATE_LIMIT', retryAt: expect.any(Number),
        });
        const closed = h.policy.snapshot().standard;
        expect(closed).toMatchObject({ status: 'RETRY_WAIT', reason: 'RPC_HTTP_429' });
        expect(closed.nextRetryAt - h.now()).toBeGreaterThanOrEqual(419_750);
        await expect(h.policy.run('standard', 'history', async () => true)).rejects.toMatchObject({
            deferred: true, retryAt: closed.nextRetryAt,
        });
        const restarted = createAcquisitionPolicy({ storage: h.storage, now: h.now, random: () => 0,
            sleep: async () => {} });
        await expect(restarted.run('standard', 'history', async () => true)).rejects.toMatchObject({
            deferred: true, retryAt: closed.nextRetryAt,
        });
    });

    it.each([
        ['RATE_LIMIT', 10_000], ['TIMEOUT', null], ['NETWORK', null], ['UPSTREAM_5XX', null], ['AUTH', null],
    ])('never shortens a longer shared deadline when a concurrent %s arrives', async (kind, retryAfterMs) => {
        const h = controlledHarness();
        let rejectLong, rejectOther;
        const long = h.policy.run('standard', 'getTransaction', async () => new Promise((_resolve, reject) => { rejectLong = reject; }));
        await h.flush(); h.setControlled();
        const other = h.policy.run('standard', 'getMultipleAccounts', async () => new Promise((_resolve, reject) => { rejectOther = reject; }));
        await h.advance(250);
        rejectLong(new AcquisitionError('RPC_HTTP_429', { kind: 'RATE_LIMIT', retryAfterMs: 420_000 }));
        await expect(long).rejects.toMatchObject({ kind: 'RATE_LIMIT' });
        const established = h.policy.snapshot().standard.nextRetryAt;
        await h.advance(250);
        rejectOther(new AcquisitionError(`RPC_${kind}`, { kind, retryAfterMs }));
        await expect(other).rejects.toMatchObject({ kind, retryAt: established });
        expect(h.policy.snapshot().standard).toMatchObject({ status: 'RETRY_WAIT', nextRetryAt: established });
        await expect(h.policy.run('standard', 'history', async () => true)).rejects.toMatchObject({
            deferred: true, retryAt: established,
        });
    });

    it('allows only an eligible due probe to reopen and ignores older success after a failed probe', async () => {
        const h = controlledHarness();
        let resolveOld;
        const old = h.policy.run('standard', 'old-state', async () => new Promise((resolve) => { resolveOld = resolve; }));
        await h.flush(); h.setControlled();
        const initial = h.policy.run('standard', 'history', async () => {
            throw new AcquisitionError('RPC_HTTP_429', { kind: 'RATE_LIMIT' });
        });
        await h.advance(250); await expect(initial).rejects.toMatchObject({ kind: 'RATE_LIMIT' });
        const firstDeadline = h.policy.snapshot().standard.nextRetryAt;
        await h.advance(firstDeadline - h.now());
        let rejectProbe;
        const probe = h.policy.run('standard', 'valuation', async () => new Promise((_resolve, reject) => { rejectProbe = reject; }));
        const waiter = h.policy.run('standard', 'history:waiting', async () => true);
        await h.flush();
        rejectProbe(new AcquisitionError('RPC_TIMEOUT', { kind: 'TIMEOUT' }));
        await expect(probe).rejects.toMatchObject({ kind: 'TIMEOUT', retryAt: expect.any(Number) });
        const renewed = h.policy.snapshot().standard.nextRetryAt;
        expect(renewed).toBeGreaterThan(firstDeadline);
        resolveOld('late-success'); await expect(old).resolves.toBe('late-success');
        await expect(waiter).rejects.toMatchObject({ deferred: true });
        expect(h.policy.snapshot().standard).toMatchObject({ status: 'RETRY_WAIT', nextRetryAt: renewed });
        await h.advance(renewed - h.now());
        await expect(h.policy.run('standard', 'history', async () => 'recovered')).resolves.toBe('recovered');
        expect(h.policy.snapshot().standard).toMatchObject({ status: 'HEALTHY', nextRetryAt: 0 });
    });
});
