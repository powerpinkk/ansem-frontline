import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initAPI } from '../js/api.js';
import { createTokenRuntime } from '../js/state.js';
import { DEFAULT_TOKEN_CONTEXT } from '../js/token-presets.js';
import { providerValuation } from '../js/market-valuation.js';
import { canonicalEvent, swapFixture, MINT, USDC } from './fixtures/integrity.js';
let api;
beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', class { static OPEN=1; static CONNECTING=0; readyState=0; addEventListener() {} close() {this.readyState=3;} });
    vi.stubGlobal('window', { setTimeout, clearTimeout, location: { search: '' },
        localStorage: { getItem: () => null, setItem: vi.fn() } });
});
afterEach(() => { api?.destroy(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('bootstrap/replay/finality/invalidation share identity and rebuild pressure without opposite trades', async () => {
    const runtime = createTokenRuntime(DEFAULT_TOKEN_CONTEXT);
    const event = canonicalEvent(); let incoming = event;
    vi.stubGlobal('fetch', vi.fn(async (url) => ({ ok: true, json: async () => String(url).includes('/recent')
        ? { version: 4, tokenMint: MINT, canonicalMarket: swapFixture().market, trades: [incoming], pools: 1 } : [] })));
    const onTrade = vi.fn(), onSettlementUpdate = vi.fn(), onTradeReconciliation = vi.fn();
    api = initAPI({ onTrade, onSettlementUpdate, onTradeReconciliation }, { runtime,
        initialMarket: { price: 1, trackedPools: [], source: 'dexscreener',
            valuation: providerValuation({ tokenMint: MINT, source: 'dexscreener', priceUsd: 1, marketCap: 1e6 }) } });
    await vi.advanceTimersByTimeAsync(1);
    expect(onTrade).toHaveBeenCalledTimes(1); expect(runtime.state.buySol60s).toBe(25);
    incoming = { ...event, settlement: 'FINALIZED' };
    await api.refresh();
    expect(onTrade).toHaveBeenCalledTimes(1); expect(onSettlementUpdate).toHaveBeenCalledTimes(1);
    expect(runtime.state.buySol60s).toBe(25);
    // A separate provisional event becomes unknown; no synthetic sell.
    incoming = canonicalEvent({ signature: 'second', timestamp: Date.now() });
    await api.refresh();
    incoming = { ...incoming, settlement: 'RECONCILIATION_UNKNOWN' }; await api.refresh();
    expect(onTradeReconciliation).toHaveBeenCalledTimes(1);
    expect(runtime.state.buySol60s).toBe(25); expect(runtime.state.sellSol60s).toBe(0);
    expect(api.getDiagnostics().journal.size).toBe(2);
    incoming = { ...incoming, settlement: 'FINALIZED' }; await api.refresh();
    expect(onTradeReconciliation).toHaveBeenCalledTimes(2);
    expect(onTrade).toHaveBeenCalledTimes(2);
    expect(runtime.state.buySol60s).toBe(50);
});
it('rejects legacy history, foreign-token evidence and fake cached trade authority', async () => {
    const runtime = createTokenRuntime(DEFAULT_TOKEN_CONTEXT); const onTrade = vi.fn();
    let snapshot = { source: 'gecko', trades: [canonicalEvent()] };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => snapshot })));
    api = initAPI({ onTrade }, { runtime, initialMarket: { price: 1, trackedPools: [],
        valuation: providerValuation({ tokenMint: MINT, source: 'dexscreener', priceUsd: 1, fdv: 1e6 }) } });
    await vi.advanceTimersByTimeAsync(1);
    expect(runtime.state.tradesFailures).toBe(1);
    snapshot = { version: 4, tokenMint: MINT, canonicalMarket: swapFixture().market, trades: [canonicalEvent({ tokenMint: USDC })] };
    await api.refresh();
    expect(onTrade).not.toHaveBeenCalled();
    expect(runtime.state.liveTrades).toEqual([]);
    expect(runtime.state.mcap).toBeNull();
});

it('rebases the pool journal and rejects a late response from an older source epoch', async () => {
    const runtime = createTokenRuntime(DEFAULT_TOKEN_CONTEXT), onTradeReconciliation = vi.fn();
    const first = swapFixture().market;
    let snapshot = { version: 4, tokenMint: MINT, canonicalMarket: first, trades: [canonicalEvent()] };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => snapshot })));
    api = initAPI({ onTradeReconciliation }, { runtime, initialMarket: { price: 1, trackedPools: [],
        valuation: providerValuation({ tokenMint: MINT, source: 'dexscreener', priceUsd: 1, marketCap: 1e6 }) } });
    await vi.advanceTimersByTimeAsync(1); expect(runtime.state.buySol60s).toBe(25);
    const second = { ...first, address: USDC, sourceEpoch: 2 };
    snapshot = { ...snapshot, canonicalMarket: second, trades: [] }; await api.refresh();
    expect(runtime.state.buySol60s).toBe(0);
    expect(onTradeReconciliation).toHaveBeenCalledTimes(1);
    expect(onTradeReconciliation.mock.calls[0][0].reconciliationReason).toBe('MARKET_REBASE');
    snapshot = { ...snapshot, canonicalMarket: first, trades: [canonicalEvent()] }; await api.refresh();
    expect(runtime.state.buySol60s).toBe(0); expect(runtime.state.canonicalMarket.address).toBe(USDC);
    snapshot = { ...snapshot, canonicalMarket: second, trades: [canonicalEvent({ poolAddress: USDC, sourceEpoch: 2 })] }; await api.refresh();
    expect(runtime.state.buySol60s).toBe(25);
});
