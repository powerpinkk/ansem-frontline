export const state = {
    price: 0,
    prevPrice: 0,
    momentum: 50,
    frontlineX: 0,
    targetFrontlineX: 0,
    screenShake: 0,
    marketTrend: 0,
    averageX: 0,
    buyRatio: 0.5,
    txVolumeMultiplier: 1.0,
    holders: 0,
    priceHistory: [],
    cameraMode: 'auto',
    lastChartFetch: 0,

    primaryPairAddress: null,
    connection: 'connecting',
    priceFailures: 0,
    tradesFailures: 0,
    tradesBootstrapped: false,
};

export const seenTradeHashes = new Set();
