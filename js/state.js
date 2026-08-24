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
    priceFailures: 0,
    tradesFailures: 0,
};

export const seenTradeIds = new Set();
export const bootstrappedPools = new Set();
