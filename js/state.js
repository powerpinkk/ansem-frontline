import { assertTokenContext, tokenNamespace } from './token-context.js';
import { DEFAULT_TOKEN_CONTEXT } from './token-presets.js';

export function createTokenRuntime(initialContext) {
    let context = assertTokenContext(initialContext);
    const namespace = tokenNamespace(context);
    const runtime = {
        namespace,
        state: createRuntimeState(),
        seenTradeIds: new Set(),
        seenTradeHashes: new Set(),
        bootstrappedPools: new Set(),
        get context() { return context; },
        updateContext(nextContext) {
            assertTokenContext(nextContext);
            if (tokenNamespace(nextContext) !== namespace) {
                throw new TypeError('A token runtime cannot be reassigned to another mint');
            }
            context = nextContext;
            return context;
        },
    };
    return runtime;
}

function createRuntimeState() {
    return {
        price: 0,
        mcap: 0,
        prevPrice: 0,
        momentum: 50,
        frontlineX: 0,
        targetFrontlineX: 0,
        screenShake: 0,
        marketTrend: 0,
        buySol60s: 0,
        sellSol60s: 0,
        liveTrades: [],
        priceHistory: [],
        priceTicks30s: [],
        cameraMode: 'auto',
        lastChartFetch: 0,

        trackedPools: [],
        referencePool: null,
        poolCursor: 0,
        solPriceUsd: 0,
        marketCoverage: 0,
        connection: 'connecting',
        lastMarketAt: 0,
        lastTradeAt: 0,
        visibleCombatants: {
            bull: 0,
            bear: 0,
            total: 0,
            verifiedBull: 0,
            verifiedBear: 0,
            verifiedTotal: 0,
            forceBull: 0,
            forceBear: 0,
        },
        priceFailures: 0,
        tradesFailures: 0,
        activity5m: { buyCount: 0, sellCount: 0, windowMs: 300_000, source: 'waiting' },
        activity1h: { buyCount: 0, sellCount: 0, windowMs: 3_600_000, source: 'waiting' },
    };
}

export const defaultTokenRuntime = createTokenRuntime(DEFAULT_TOKEN_CONTEXT);

// Compatibility aliases keep rendering/UI hot paths on the default runtime.
// New token-aware data services receive a runtime explicitly.
export const state = defaultTokenRuntime.state;
export const seenTradeIds = defaultTokenRuntime.seenTradeIds;
export const seenTradeHashes = defaultTokenRuntime.seenTradeHashes;
export const bootstrappedPools = defaultTokenRuntime.bootstrappedPools;
