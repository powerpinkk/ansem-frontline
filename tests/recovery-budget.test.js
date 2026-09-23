import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { StreamHub } from '../worker/src/stream-hub.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('measures PumpSwap cold and steady standard-RPC budgets with discovery/native/history split', async () => {
    const samples = JSON.parse(readFileSync(new URL('./fixtures/public-chain/pump-valuation-states.json', import.meta.url)));
    const sample = samples.find((item) => item.result.canonicalMarket.protocol === 'pumpswap');
    let now = sample.observedAt, epoch = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const stored = new Map();
    const ctx = { storage: { get: async (key) => stored.get(key), put: async (key, value) => stored.set(key, value),
        setAlarm: async () => {} }, getWebSockets: () => [] };
    const hub = new StreamHub(ctx, { DEFAULT_TOKEN_MINT: sample.mint });
    hub.tokenMint = sample.mint;
    const calls = [];
    hub.policy = { run: async (group, key, operation) => { calls.push({ at: now, group, key }); return operation(); }, snapshot: () => ({}) };
    const reads = sample.reads;
    hub.rawRpc = vi.fn(async (method, params) => {
        if (method === 'getSignaturesForAddress') return [];
        const matched = reads.find((read) => read.method === method
            && JSON.stringify(read.params[0]) === JSON.stringify(params[0]));
        if (!matched) throw new Error(`Unexpected ${method}`);
        return structuredClone(matched.result);
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ chainId: 'solana',
        pairAddress: sample.result.canonicalMarket.address, dexId: 'pumpswap',
        baseToken: { address: sample.mint }, quoteToken: { address: sample.result.canonicalMarket.quoteMint },
        priceUsd: '0.1', liquidity: { usd: 1000 }, volume: { h24: 100 } }] })));

    await hub.ensureMarket(); await hub.catchUp();
    expect(calls.filter((call) => call.group === 'standard')).toHaveLength(5);
    const coldEnd = calls.length;
    for (epoch = 3_000; epoch < 120_000; epoch += 3_000) {
        now = sample.observedAt + epoch;
        await hub.ensureMarket(); await hub.catchUp(); await hub.ingestion?.tick();
    }
    const afterCold = calls.slice(coldEnd).filter((call) => call.group === 'standard');
    const windows = [0, 1].map((index) => afterCold.filter((call) => {
        const elapsed = call.at - sample.observedAt;
        return elapsed >= index * 60_000 && elapsed < (index + 1) * 60_000;
    }));
    expect(windows[0].length).toBe(7); // cold window tail: four atomic + three history reads
    expect(windows[1].length).toBe(12); // one full 4-read refresh, four atomic reads, four history reads
    expect(windows[1].filter((call) => call.key === 'getSignaturesForAddress')).toHaveLength(4);
    expect(hub.sourceEpoch).toBe(1);
    hub.ingestion?.destroy();
});
