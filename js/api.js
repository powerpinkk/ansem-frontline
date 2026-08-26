import { CONFIG } from './config.js';
import { calculatePressure, deriveSolPrice, parseGeckoTrade, selectTrackedPools, summarizePoolActivity } from './market.js';
import { connectTradeStream } from './stream.js';
import { bootstrappedPools, seenTradeHashes, seenTradeIds, state } from './state.js';

let callbacks = {};
let priceDelay = CONFIG.FETCH_MIN_DELAY_MS;
let tradesDelay = CONFIG.TRADES_POLL_MIN_DELAY_MS;
let lastPoolDiscovery = 0;
let pollingFallback = true;
let fallbackTimer = null;
let streamStarted = false;
let streamController = null;
let visibilityRefreshPromise = null;
let marketRequestPromise = null;
let bootstrapPromise = null;
let lastChartAttempt = 0;
let geckoRateLimitedUntil = 0;
const bootstrapAttemptedAt = new Map();

export function initAPI(nextCallbacks) {
    callbacks = nextCallbacks;
    setConnection('connecting');
    schedule(runMarketLoop, 0);
    schedule(runTradeLoop, 1200);
    return { refresh: refreshAPI };
}

export function refreshAPI({ catchUpTrades = false } = {}) {
    streamController?.reconnect();
    if (visibilityRefreshPromise) return visibilityRefreshPromise;
    visibilityRefreshPromise = (async () => {
        try {
            await fetchMarketDataShared();
            state.priceFailures = 0;
            if (catchUpTrades) await catchUpTrackedPools();
        } catch (error) {
            state.priceFailures += 1;
            console.warn('[visibility-refresh]', error);
        } finally {
            refreshConnection();
            visibilityRefreshPromise = null;
        }
    })();
    return visibilityRefreshPromise;
}

function schedule(task, delay) { window.setTimeout(task, delay); }

function setConnection(status) {
    if (state.connection === status) return;
    state.connection = status;
    callbacks.onConnectionChange?.(status);
}

function refreshConnection() {
    if (state.priceFailures >= 3) setConnection('offline');
    else if (state.priceFailures || state.tradesFailures >= 3) setConnection('degraded');
    else if (state.trackedPools.length) setConnection('online');
    else setConnection('connecting');
}

async function runMarketLoop() {
    try {
        const market = await fetchMarketDataShared();
        state.priceFailures = 0;
        priceDelay = market.source === 'dexscreener' ? CONFIG.FETCH_MIN_DELAY_MS : Math.max(15_000, CONFIG.FETCH_MIN_DELAY_MS);
    } catch (error) {
        state.priceFailures += 1;
        priceDelay = Math.min(CONFIG.FETCH_MAX_DELAY_MS, priceDelay * 2);
        console.error('[market]', error);
    }
    refreshConnection();
    schedule(runMarketLoop, priceDelay);
}

async function runTradeLoop() {
    if (!pollingFallback) return;
    if (Date.now() < geckoRateLimitedUntil) {
        schedule(runTradeLoop, geckoRateLimitedUntil - Date.now());
        return;
    }
    if (bootstrapPromise) {
        schedule(runTradeLoop, CONFIG.TRADES_POLL_MIN_DELAY_MS);
        return;
    }
    const pool = state.trackedPools[state.poolCursor % state.trackedPools.length];
    if (!pool) {
        schedule(runTradeLoop, CONFIG.TRADES_POLL_MIN_DELAY_MS);
        return;
    }
    state.poolCursor = (state.poolCursor + 1) % state.trackedPools.length;
    try {
        await fetchPoolTrades(pool);
        state.tradesFailures = 0;
        tradesDelay = CONFIG.TRADES_POLL_MIN_DELAY_MS;
    } catch (error) {
        state.tradesFailures += 1;
        if (error.status === 429) {
            geckoRateLimitedUntil = Date.now() + CONFIG.GECKO_RATE_LIMIT_COOLDOWN_MS;
            tradesDelay = CONFIG.GECKO_RATE_LIMIT_COOLDOWN_MS;
            console.warn(`[trades:${pool.dexId}] GeckoTerminal rate limited; fallback paused for 60s`);
        } else {
            tradesDelay = Math.min(CONFIG.TRADES_POLL_MAX_DELAY_MS, tradesDelay * 1.5);
            console.error(`[trades:${pool.dexId}]`, error);
        }
    }
    refreshConnection();
    schedule(runTradeLoop, tradesDelay);
}

function handleStreamStatus(status) {
    if (status === 'online') {
        pollingFallback = false;
        window.clearTimeout(fallbackTimer);
        state.tradesFailures = 0;
        refreshConnection();
        return;
    }
    window.clearTimeout(fallbackTimer);
    fallbackTimer = window.setTimeout(() => {
        if (pollingFallback) return;
        pollingFallback = true;
        schedule(runTradeLoop, 0);
    }, 5_000);
}

function receiveStreamTrade(trade) {
    if (!trade?.txHash || seenTradeHashes.has(trade.txHash)) return;
    seenTradeHashes.add(trade.txHash);
    receiveTrade(trade, false);
}

async function fetchJson(url, timeoutMs = 8_000) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
        if (!response.ok) {
            const error = new Error(`HTTP ${response.status}`);
            error.status = response.status;
            if (response.status === 429 && url.startsWith(CONFIG.GECKO_BASE)) {
                geckoRateLimitedUntil = Math.max(geckoRateLimitedUntil, Date.now() + CONFIG.GECKO_RATE_LIMIT_COOLDOWN_MS);
            }
            throw error;
        }
        return await response.json();
    } finally {
        window.clearTimeout(timeout);
    }
}

async function fetchMarketData() {
    let market;
    try {
        market = await fetchDexMarketData();
    } catch (error) {
        console.warn('[market] DexScreener unavailable, using Helius fallback', error);
        market = await fetchRelayMarketData();
    }
    state.price = market.price;
    state.lastMarketAt = Date.now();
    startStreamIfReady();
    updateTrend(market.price);
    try {
        await fetchChartIfNeeded(market.price);
    } catch (error) {
        console.warn('[chart] OHLCV unavailable', error);
    }
    void bootstrapTrackedPools();
    callbacks.onMarketUpdate?.(market);
    return market;
}

function fetchMarketDataShared() {
    if (marketRequestPromise) return marketRequestPromise;
    marketRequestPromise = fetchMarketData().finally(() => { marketRequestPromise = null; });
    return marketRequestPromise;
}

async function fetchDexMarketData() {
    const data = await fetchJson(`${CONFIG.DEXSCREENER_TOKEN_URL}/${CONFIG.TOKEN_MINT}`, 4_500);
    const pairs = Array.isArray(data) ? data : data?.pairs || [];
    if (!pairs.length) throw new Error('No $ANSEM markets returned by DexScreener');
    const now = Date.now();
    if (!state.trackedPools.length || now - lastPoolDiscovery > CONFIG.POOL_REFRESH_MS) {
        state.trackedPools = selectTrackedPools(pairs);
        state.referencePool = state.trackedPools[0] || null;
        state.poolCursor = 0;
        lastPoolDiscovery = now;
    }
    state.solPriceUsd = deriveSolPrice(pairs);
    const totalVolume = pairs.reduce((sum, pair) => sum + Number(pair.volume?.h24 || 0), 0);
    const trackedVolume = state.trackedPools.reduce((sum, pool) => sum + pool.volumeH24Usd, 0);
    state.marketCoverage = totalVolume > 0 ? (trackedVolume / totalVolume) * 100 : 0;
    const selectedPairs = pairs.filter((pair) => state.trackedPools.some((pool) => pool.address === pair.pairAddress));
    const activity = summarizePoolActivity(selectedPairs, 'm5');
    const activity1h = summarizePoolActivity(selectedPairs, 'h1');
    state.activity5m = activity;
    state.activity1h = activity1h;
    callbacks.onActivityUpdate?.(activity);
    const liquidity = selectedPairs.reduce((sum, pair) => sum + Number(pair.liquidity?.usd || 0), 0);
    const price = liquidity > 0
        ? selectedPairs.reduce((sum, pair) => sum + Number(pair.priceUsd || 0) * Number(pair.liquidity?.usd || 0), 0) / liquidity
        : Number(pairs[0].priceUsd || 0);
    const mcap = Number(pairs[0].marketCap || pairs[0].fdv || 0);
    const chg = Number(pairs[0].priceChange?.h1 || 0);
    return {
        price,
        mcap,
        chg,
        pools: state.trackedPools.length,
        coverage: state.marketCoverage,
        referencePool: state.referencePool,
        activity,
        activity1h,
        source: 'dexscreener',
    };
}

async function fetchRelayMarketData() {
    const data = await fetchJson(CONFIG.RELAY_MARKET_URL, 5_000);
    if (!(Number(data.price) > 0) || !(Number(data.solPriceUsd) > 0) || !data.pools?.length) {
        throw new Error('Invalid Helius market fallback');
    }
    if (!state.trackedPools.length) {
        state.trackedPools = data.pools.map((pool) => ({ ...pool, liquidityUsd: 0, volumeH24Usd: 0, volumeH1Usd: 0 }));
        state.referencePool = state.trackedPools[0];
        state.poolCursor = 0;
    }
    state.solPriceUsd = Number(data.solPriceUsd);
    state.marketCoverage = null;
    return {
        price: Number(data.price),
        mcap: Number(data.mcap || 0),
        chg: Number.isFinite(Number(data.chg)) && data.chg !== null ? Number(data.chg) : null,
        pools: state.trackedPools.length,
        coverage: null,
        referencePool: state.referencePool,
        source: data.source || 'helius-fallback',
    };
}

function startStreamIfReady() {
    if (streamStarted || !CONFIG.STREAM_URL || !state.trackedPools.length || !(state.price > 0) || !(state.solPriceUsd > 0)) return;
    streamStarted = true;
    streamController = connectTradeStream(CONFIG.STREAM_URL, {
        onTrade: receiveStreamTrade,
        onStatus: handleStreamStatus,
        getConfiguration: () => ({
            pools: state.trackedPools.map(({ address, dexId, quoteSymbol }) => ({ address, dexId, quoteSymbol })),
            market: { tokenPriceUsd: state.price, solPriceUsd: state.solPriceUsd },
        }),
    });
}

function updateTrend(price) {
    const priceDirection = state.prevPrice > 0 ? Math.sign(price - state.prevPrice) : 0;
    const pressure = calculatePressure(state.liveTrades);
    const pressureDirection = pressure.totalSol > 0 ? Math.sign(pressure.buySol - pressure.sellSol) : 0;
    state.marketTrend = pressureDirection || priceDirection;
    state.momentum += (pressure.bullPercent - state.momentum) * 0.25;
    state.targetFrontlineX = Math.max(-45, Math.min(45, (state.momentum - 50) * 0.9));
    state.buySol60s = pressure.buySol;
    state.sellSol60s = pressure.sellSol;
    state.prevPrice = price;
}

async function fetchChartIfNeeded(livePrice) {
    const now = Date.now();
    if (now < geckoRateLimitedUntil) return;
    if (!state.referencePool || now - Math.max(state.lastChartFetch, lastChartAttempt) < CONFIG.CHART_CACHE_MS) return;
    lastChartAttempt = now;
    const json = await fetchJson(`${CONFIG.GECKO_BASE}/${state.referencePool.address}/ohlcv/minute?limit=60`);
    const candles = json.data?.attributes?.ohlcv_list;
    if (!candles?.length) return;
    state.priceHistory = candles.slice().reverse().map((candle) => Number(candle[4]));
    state.priceHistory[state.priceHistory.length - 1] = livePrice;
    state.lastChartFetch = now;
}

async function fetchPoolTrades(pool) {
    const trades = await fetchRecentPoolTrades(pool);
    if (!trades.length) return;
    if (!bootstrappedPools.has(pool.address)) {
        void bootstrapTrackedPools();
        return;
    }
    trades.filter((trade) => !seenTradeIds.has(trade.id) && !seenTradeHashes.has(trade.txHash)).forEach((trade) => {
        seenTradeIds.add(trade.id);
        seenTradeHashes.add(trade.txHash);
        receiveTrade(trade, false);
    });
    if (seenTradeIds.size > 2_000) {
        const activeIds = trades.map((trade) => trade.id);
        seenTradeIds.clear();
        activeIds.forEach((id) => seenTradeIds.add(id));
    }
    if (seenTradeHashes.size > 2_000) {
        seenTradeHashes.clear();
        trades.forEach((trade) => seenTradeHashes.add(trade.txHash));
    }
}

async function fetchRecentPoolTrades(pool) {
    const json = await fetchJson(`${CONFIG.GECKO_BASE}/${pool.address}/trades`);
    return (json.data || [])
        .map((entry) => parseGeckoTrade(entry, pool, state.solPriceUsd))
        .filter(Boolean)
        .sort((a, b) => a.timestamp - b.timestamp);
}

function bootstrapTrackedPools() {
    if (bootstrapPromise) return bootstrapPromise;
    const now = Date.now();
    const pools = state.trackedPools.filter((pool) =>
        !bootstrappedPools.has(pool.address)
        && now - (bootstrapAttemptedAt.get(pool.address) || 0) >= 60_000
    );
    if (!pools.length) return Promise.resolve();
    pools.forEach((pool) => bootstrapAttemptedAt.set(pool.address, now));
    bootstrapPromise = fetchBootstrapTrades(pools)
        .then((results) => {
            const allTrades = [];
            results.forEach(({ pool, trades }) => {
                bootstrappedPools.add(pool.address);
                allTrades.push(...trades);
            });
            const uniqueTrades = [...new Map(allTrades.map((trade) => [trade.txHash || trade.id, trade])).values()]
                .sort((a, b) => a.timestamp - b.timestamp);
            uniqueTrades.forEach((trade) => {
                seenTradeIds.add(trade.id);
                seenTradeHashes.add(trade.txHash);
            });
            const now = Date.now();
            const fiveMinuteTrades = uniqueTrades.filter((trade) => now - trade.timestamp <= 300_000);
            if (state.activity5m.buyCount + state.activity5m.sellCount === 0 && fiveMinuteTrades.length) {
                const activity = {
                    buyCount: fiveMinuteTrades.filter((trade) => trade.isBuy).length,
                    sellCount: fiveMinuteTrades.filter((trade) => !trade.isBuy).length,
                    windowMs: 300_000,
                    source: 'verified-swaps',
                };
                state.activity5m = activity;
                callbacks.onActivityUpdate?.(activity);
            }
            fiveMinuteTrades
                .filter((trade) => now - trade.timestamp <= 75_000)
                .slice(-CONFIG.TRADES_BOOTSTRAP_COUNT)
                .forEach((trade) => receiveTrade(trade, true));
        })
        .finally(() => { bootstrapPromise = null; });
    return bootstrapPromise;
}

async function fetchBootstrapTrades(pools) {
    const results = [];
    for (const pool of pools) {
        if (Date.now() < geckoRateLimitedUntil) break;
        try {
            results.push({ pool, trades: await fetchRecentPoolTrades(pool) });
        } catch (error) {
            if (error.status === 429) break;
            console.warn(`[bootstrap:${pool.dexId}]`, error);
        }
        if (pool !== pools.at(-1)) await new Promise((resolve) => window.setTimeout(resolve, 750));
    }
    return results;
}

function receiveTrade(trade, bootstrap) {
    const previousFrontlineX = state.targetFrontlineX;
    state.liveTrades.push(trade);
    state.lastTradeAt = Math.max(state.lastTradeAt, Number(trade.timestamp) || Date.now());
    const cutoff = Date.now() - CONFIG.PRESSURE_WINDOW_MS;
    state.liveTrades = state.liveTrades.filter((item) => item.timestamp >= cutoff).slice(-500);
    const pressure = calculatePressure(state.liveTrades);
    state.momentum = pressure.bullPercent;
    state.buySol60s = pressure.buySol;
    state.sellSol60s = pressure.sellSol;
    state.marketTrend = Math.sign(pressure.buySol - pressure.sellSol);
    state.targetFrontlineX = Math.max(-45, Math.min(45, (pressure.bullPercent - 50) * 0.9));
    callbacks.onTrade?.(trade, { bootstrap, previousFrontlineX, nextFrontlineX: state.targetFrontlineX });
    callbacks.onPressureUpdate?.(pressure);
}

async function catchUpTrackedPools() {
    for (const pool of state.trackedPools) {
        if (Date.now() < geckoRateLimitedUntil) break;
        try {
            await fetchPoolTrades(pool);
        } catch (error) {
            if (error.status === 429) break;
            console.warn(`[catch-up:${pool.dexId}]`, error);
        }
        if (pool !== state.trackedPools.at(-1)) {
            await new Promise((resolve) => window.setTimeout(resolve, 350));
        }
    }
}
