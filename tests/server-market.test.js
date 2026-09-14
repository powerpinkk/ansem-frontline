import { expect, it, vi } from 'vitest';
import { resolveServerMarket, createRpcTransport } from '../worker/src/server-market.js';
import worker from '../worker/src/index.js';
import { MINT, SOL, swapFixture } from './fixtures/integrity.js';
import { readFileSync } from 'node:fs';

it('discovers independently and rejects pool owners outside fixed protocol adapters', async () => {
    const f = swapFixture();
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => [
        { chainId: 'solana', pairAddress: f.pool, dexId: 'client-label-not-proof', baseToken: { address: MINT },
            quoteToken: { address: SOL }, priceUsd: '1', liquidity: { usd: 100 } },
    ] }));
    const rpc = vi.fn(async (_method,[addresses]) => ({ context: { slot: 99 }, value: addresses.length===2?[null,null]:[{ owner: 'attacker', executable: false }] }));
    const rejected = await resolveServerMarket(MINT, rpc, null, fetchImpl);
    expect(rejected.pools).toEqual([]);
    expect(rejected.unsupportedPools).toBe(1);
    rpc.mockImplementation(async (_method,[addresses]) => ({ context: { slot: 100 }, value:addresses.length===2?[null,null]:[{
        owner: f.transaction.transaction.message.instructions[0].programId, executable: false }] }));
    expect((await resolveServerMarket(MINT, rpc, null, fetchImpl)).pools).toEqual([]);
    const sample = JSON.parse(readFileSync(new URL('./fixtures/public-chain/pool-identities.json', import.meta.url)))[0];
    rpc.mockResolvedValueOnce({context:{slot:99},value:[null,null]})
        .mockResolvedValueOnce({ context: { slot: 100 }, value: [sample.poolAccount] })
        .mockResolvedValueOnce({ context: { slot: 101 }, value: sample.vaultAccounts.value });
    const accepted = await resolveServerMarket(MINT, rpc, null, fetchImpl);
    expect(accepted.pools[0]).toMatchObject({ compatibility: 'POOL_STATE_AND_VAULTS_VERIFIED', verifiedAtSlot: 101 });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.dexscreener.com/token-pairs/v1/solana/' + MINT);
});

it('fixed RPC transport rejects HTTP and JSON-RPC failures', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ error: { code: -32000 } }) }));
    const rpc = createRpcTransport({ HELIUS_API_KEY: 'test-only' }, fetchImpl);
    await expect(rpc('getTransaction', [])).rejects.toThrow('RPC_ERROR');
    expect(new URL(fetchImpl.mock.calls[0][0]).hostname).toBe('mainnet.helius-rpc.com');
    fetchImpl.mockResolvedValue({ ok: false, status: 429 });
    await expect(rpc('getTransaction', [])).rejects.toThrow('429');
});

it('recent endpoint forwards only mint identifiers to the same token-scoped Durable Object', async () => {
    const forwarded = [];
    const fetchImpl = vi.fn(async (request) => { forwarded.push({ url: request.url, body: await request.json() });
        return Response.json({ version: 4, tokenMint: MINT, trades: [] }, { headers: { 'cache-control': 'no-store' } }); });
    const env = { DEFAULT_TOKEN_MINT: MINT, ALLOWED_ORIGINS: 'https://frontline.example',
        STREAM_HUB: { idFromName: (name) => name, get: () => ({ fetch: fetchImpl }) } };
    const response = await worker.fetch(new Request('https://relay.example/recent', { method: 'POST',
        headers: { Origin: 'https://frontline.example' }, body: JSON.stringify({ type: 'configure', token: { mint: MINT },
            pools: [{ address: 'attacker' }], market: { tokenPriceUsd: 999 } }) }), env);
    expect(response.status).toBe(200);
    expect(forwarded[0].body).toEqual({ type: 'configure', token: { mint: MINT, chain: 'solana' } });
    expect(new URL(forwarded[0].url).searchParams.get('mint')).toBe(MINT);
    expect(response.headers.get('cache-control')).toBe('no-store');
});
