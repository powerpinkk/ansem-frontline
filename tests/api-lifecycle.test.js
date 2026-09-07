import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initAPI } from '../js/api.js';
import { createTokenRuntime } from '../js/state.js';
import { DEFAULT_TOKEN_CONTEXT } from '../js/token-presets.js';

describe('token API teardown', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('window', {
            setTimeout,
            clearTimeout,
            location: { search: '' },
            localStorage: { getItem: vi.fn(() => null), setItem: vi.fn() },
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('clears scheduled market and trade polling timers', () => {
        const api = initAPI({}, { runtime: createTokenRuntime(DEFAULT_TOKEN_CONTEXT) });
        expect(api.getDiagnostics().timers).toBe(2);
        api.destroy();
        expect(api.getDiagnostics()).toMatchObject({ destroyed: true, timers: 0, requests: 0, streamActive: false });
    });

    it('aborts every in-flight request on destroy', async () => {
        const signals = [];
        vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
            signals.push(options.signal);
            options.signal.addEventListener('abort', () => {
                const error = new Error('aborted');
                error.name = 'AbortError';
                reject(error);
            });
        })));
        const api = initAPI({}, { runtime: createTokenRuntime(DEFAULT_TOKEN_CONTEXT) });
        await vi.advanceTimersByTimeAsync(0);
        expect(signals).toHaveLength(2);
        api.destroy();
        expect(signals.every((signal) => signal.aborted)).toBe(true);
        await Promise.resolve();
        expect(api.getDiagnostics()).toMatchObject({ timers: 0, requests: 0 });
    });

    it('discards responses that settle after the runtime was destroyed', async () => {
        const requests = [];
        vi.stubGlobal('fetch', vi.fn((url) => {
            const pending = deferred();
            requests.push({ url: String(url), pending });
            return pending.promise;
        }));
        const onMarketUpdate = vi.fn();
        const runtime = createTokenRuntime(DEFAULT_TOKEN_CONTEXT);
        const api = initAPI({ onMarketUpdate }, { runtime });
        await vi.advanceTimersByTimeAsync(0);
        api.destroy();
        requests.forEach(({ url, pending }) => pending.resolve({
            ok: true,
            json: async () => url.includes('dexscreener') ? [] : {},
        }));
        await Promise.resolve();
        await Promise.resolve();
        expect(onMarketUpdate).not.toHaveBeenCalled();
        expect(runtime.state.price).toBe(0);
    });

    it('closes the token WebSocket when its API runtime is destroyed', () => {
        class FakeWebSocket {
            static CONNECTING = 0;
            static OPEN = 1;
            static instances = [];
            constructor() {
                this.readyState = FakeWebSocket.CONNECTING;
                this.listeners = new Map();
                this.closed = false;
                FakeWebSocket.instances.push(this);
            }
            addEventListener(type, listener) {
                this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
            }
            close() {
                this.closed = true;
                this.readyState = 3;
                for (const listener of this.listeners.get('close') || []) listener();
            }
        }
        vi.stubGlobal('WebSocket', FakeWebSocket);
        const pool = { address: '6e7V9eegCHw997T72MxgwwJipZ6GJyZF8NvjkzT1rvpN', dexId: 'fixture', quoteSymbol: 'SOL' };
        const api = initAPI({}, {
            runtime: createTokenRuntime(DEFAULT_TOKEN_CONTEXT),
            initialMarket: {
                price: 1,
                mcap: 1_000_000,
                chg: 0,
                trackedPools: [pool],
                referencePool: pool,
                coverage: 100,
                solPriceUsd: 100,
                source: 'dexscreener',
            },
        });
        expect(FakeWebSocket.instances).toHaveLength(1);
        expect(api.getDiagnostics().streamActive).toBe(true);
        api.destroy();
        expect(FakeWebSocket.instances[0].closed).toBe(true);
        expect(api.getDiagnostics().streamActive).toBe(false);
    });
});

function deferred() {
    let resolve;
    const promise = new Promise((next) => { resolve = next; });
    return { promise, resolve };
}
