export const state = {
    price: 0,
    prevPrice: 0,
    momentum: 50,
    frontlineX: 0,
    targetFrontlineX: 0,
    screenShake: 0,
    marketTrend: 0,
    averageX: 0,
    buySol60s: 0,
    sellSol60s: 0,
    liveTrades: [],
    priceHistory: [],
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
    visibleCombatants: { bull: 0, bear: 0, total: 0 },
    priceFailures: 0,
    tradesFailures: 0,
    activity5m: { buyCount: 0, sellCount: 0, windowMs: 300_000, source: 'waiting' },
};

export const seenTradeIds = new Set();
export const seenTradeHashes = new Set();
export const bootstrappedPools = new Set();
