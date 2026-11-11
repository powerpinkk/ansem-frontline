import { describe, expect, it } from 'vitest';
import { GlobalBudget, GLOBAL_LIMITS, reserveGlobal } from '../worker/src/global-budget.js';
import { createJsonRpcTransport } from '../worker/src/acquisition-policy.js';
import { validateMarketResponse } from '../scripts/worker-production-smoke.mjs';
function storage() {
    const records = new Map(); let tail = Promise.resolve();
    const api = { get: async k => structuredClone(records.get(k)), put: async (k, v) => records.set(k, structuredClone(v)) };
    api.transaction = fn => { const p = tail.then(() => fn(api)); tail = p.catch(() => {}); return p; };
    return api;
}
describe('Account-wide upstream budget', () => {
    it('accepts truthful unsupported indicative fallback without assigning price authority', () => {
        const origin = 'https://powerpinkk.github.io', mint = '11111111111111111111111111111111';
        const body = { error: { code: 'NO_SAFE_FALLBACK_POOLS' }, token: { identity: { mint } } };
        const response = Response.json(body, { status: 422, headers: { 'access-control-allow-origin': origin, 'cache-control': 'no-store' } });
        expect(validateMarketResponse({ body, response }, { mint, expectedOrigin: origin })).toMatchObject({
            contractOk: true, status: 422, outcome: 'NO_SAFE_FALLBACK_POOLS',
        });
    });
    it('reserves atomically under concurrent traffic and survives object reconstruction', async () => {
        const store = storage(), ledger = new GlobalBudget({ storage: store });
        const request = () => new Request('https://budget/rpc');
        const results = await Promise.all(Array.from({ length: 80 }, () => ledger.fetch(request())));
        expect(results.filter(r => r.status === 200)).toHaveLength(GLOBAL_LIMITS.minute);
        expect((await new GlobalBudget({ storage: store }).fetch(request())).status).toBe(429);
    });
    it('fails closed without a binding and denies RPC before upstream fetch', async () => {
        expect(await reserveGlobal({})).toBe(false);
        let calls = 0;
        const transport = createJsonRpcTransport({ HELIUS_API_KEY: 'test-only', GLOBAL_BUDGET: {
            idFromName: () => 1, get: () => ({ fetch: async () => new Response('', { status: 429 }) }),
        } }, async () => { calls++; throw new Error('Should never reach upstream'); });
        await expect(transport('getAsset', {})).rejects.toMatchObject({ reason: 'GLOBAL_RPC_BUDGET', deferred: true });
        expect(calls).toBe(0);
    });
});
