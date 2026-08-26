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
let streamConfigurationKey = '';
let visibilityRefreshPromise = null;
let marketRequestPromise = null;
let bootstrapPromise = null;
let lastChartAttempt = 0;
let geckoRateLimitedUntil = 0;
let initialMarketRacePending = true;
let latestMarket = null;
let restoringStartupCache = false;
const bootstrapAttemptedAt = new Map();
const bootstrapTradesByPool = new Map();
const renderedBootstrapTrades = new Set();
const spawnedBootstrapTrades = new Set();
let recentFeedTrades = [];
const STARTUP_CACHE_KEY = 'ansem-frontline:startup:v1';
const STARTUP_MARKET_TTL_MS = 5 * 60_000;
const STARTUP_TRADE_TTL_MS = 75_000;
const startupDiagnostics = {
    startedAt: performance.now(),
    cacheMs: null,
    marketMs: null,
    firstTradeMs: null,
    firstFeedMs: null,
    bootstrapMs: null,
    marketSource: null,
};

if (import.meta.env.DEV || new URLSearchParams(window.location.search).has('diagnostics')) {
    window.__ansemStartupDiagnostics = () => ({ ...startupDiagnostics });
}

export function initAPI(nextCallbacks) {
    callbacks = nextCallbacks;
    setConnection('connecting');
    hydrateStartupSnapshot();
    schedule(runMarketLoop, 0);
    schedule(runTradeLoop, state.trackedPools.length ? 0 : 1_200);
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

async function postJson(url, body, timeoutMs = 4_000) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            method: 'POST',
            signal: controller.signal,
            headers: { accept: 'application/json', 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const error = new Error(`HTTP ${response.status}`);
            error.status = response.status;
            throw error;
        }
        return await response.json();
    } finally {
        window.clearTimeout(timeout);
    }
}

async function fetchMarketData() {
    let market;
    if (initialMarketRacePending) {
        initialMarketRacePending = false;
        const dexMarket = fetchDexMarketData();
        const relayMarket = fetchRelayMarketData();
        market = await Promise.any([dexMarket, relayMarket]);
        if (market.source !== 'dexscreener') {
            void dexMarket.then((enrichedMarket) => applyMarketData(enrichedMarket)).catch(() => {});
        }
    } else {
        try {
            market = await fetchDexMarketData();
        } catch (error) {
            console.warn('[market] DexScreener unavailable, using Helius fallback', error);
            market = await fetchRelayMarketData();
        }
    }
    applyMarketData(market);
    return market;
}

function applyMarketData(market) {
    if (!market || !(Number(market.price) > 0)) return;
    if (market.trackedPools?.length && (market.source === 'dexscreener' || !state.trackedPools.length)) {
        state.trackedPools = market.trackedPools;
        state.referencePool = market.referencePool || market.trackedPools[0] || null;
        state.poolCursor %= Math.max(1, state.trackedPools.length);
        if (market.source === 'dexscreener') lastPoolDiscovery = Date.now();
    }
    if (Number(market.solPriceUsd) > 0) state.solPriceUsd = Number(market.solPriceUsd);
    if (market.source === 'dexscreener') state.marketCoverage = market.coverage;
    else state.marketCoverage = null;
    if (market.activity) state.activity5m = market.activity;
    if (market.activity1h) state.activity1h = market.activity1h;
    state.price = market.price;
    state.lastMarketAt = Date.now();
    latestMarket = {
        ...market,
        pools: state.trackedPools.length,
        coverage: state.marketCoverage,
        referencePool: state.referencePool,
    };
    if (startupDiagnostics.marketMs === null) {
        startupDiagnostics.marketMs = performance.now() - startupDiagnostics.startedAt;
        startupDiagnostics.marketSource = market.source;
    }
    startStreamIfReady();
    updateTrend(market.price);
    callbacks.onActivityUpdate?.(state.activity5m);
    callbacks.onMarketUpdate?.(latestMarket);
    persistStartupSnapshot();
    void bootstrapTrackedPools();
    void fetchChartIfNeeded(market.price)
        .then((updated) => {
            if (updated) callbacks.onMarketUpdate?.(latestMarket);
        })
        .catch((error) => console.warn('[chart] OHLCV unavailable', error));
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
    const trackedPools = !state.trackedPools.length || now - lastPoolDiscovery > CONFIG.POOL_REFRESH_MS
        ? selectTrackedPools(pairs)
        : state.trackedPools;
    const referencePool = trackedPools[0] || null;
    const solPriceUsd = deriveSolPrice(pairs);
    const totalVolume = pairs.reduce((sum, pair) => sum + Number(pair.volume?.h24 || 0), 0);
    const trackedVolume = trackedPools.reduce((sum, pool) => sum + pool.volumeH24Usd, 0);
    const coverage = totalVolume > 0 ? (trackedVolume / totalVolume) * 100 : 0;
    const selectedPairs = pairs.filter((pair) => trackedPools.some((pool) => pool.address === pair.pairAddress));
    const activity = summarizePoolActivity(selectedPairs, 'm5');
    const activity1h = summarizePoolActivity(selectedPairs, 'h1');
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
        pools: trackedPools.length,
        coverage,
        referencePool,
        trackedPools,
        solPriceUsd,
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
    const trackedPools = data.pools.map((pool) => ({ ...pool, liquidityUsd: 0, volumeH24Usd: 0, volumeH1Usd: 0 }));
    const referencePool = trackedPools[0] || null;
    return {
        price: Number(data.price),
        mcap: Number(data.mcap || 0),
        chg: Number.isFinite(Number(data.chg)) && data.chg !== null ? Number(data.chg) : null,
        pools: trackedPools.length,
        coverage: null,
        referencePool,
        trackedPools,
        solPriceUsd: Number(data.solPriceUsd),
        source: data.source || 'helius-fallback',
    };
}

function startStreamIfReady() {
    if (!CONFIG.STREAM_URL || !state.trackedPools.length || !(state.price > 0) || !(state.solPriceUsd > 0)) return;
    const configurationKey = state.trackedPools.map((pool) => pool.address).sort().join(':');
    if (streamStarted) {
        if (configurationKey !== streamConfigurationKey) {
            streamConfigurationKey = configurationKey;
            streamController?.reconnect();
        }
        return;
    }
    streamStarted = true;
    streamConfigurationKey = configurationKey;
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
    const now = Date.now();
    const numericPrice = Number(price);
    if (numericPrice > 0) {
        const previousTick = state.priceTicks30s.at(-1);
        if (!previousTick || now - previousTick.timestamp >= 750 || previousTick.price !== numericPrice) {
            state.priceTicks30s.push({ timestamp: now, price: numericPrice });
        }
        state.priceTicks30s = state.priceTicks30s
            .filter((tick) => now - tick.timestamp <= 31_000)
            .slice(-90);
    }
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
    if (now < geckoRateLimitedUntil) return false;
    if (!state.referencePool || now - Math.max(state.lastChartFetch, lastChartAttempt) < CONFIG.CHART_CACHE_MS) return false;
    lastChartAttempt = now;
    const json = await fetchJson(`${CONFIG.GECKO_BASE}/${state.referencePool.address}/ohlcv/minute?limit=60`);
    const candles = json.data?.attributes?.ohlcv_list;
    if (!candles?.length) return false;
    state.priceHistory = candles.slice().reverse().map((candle) => Number(candle[4]));
    state.priceHistory[state.priceHistory.length - 1] = livePrice;
    state.lastChartFetch = now;
    persistStartupSnapshot();
    return true;
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

async function fetchRecentPoolTrades(pool, timeoutMs = 8_000) {
    const json = await fetchJson(`${CONFIG.GECKO_BASE}/${pool.address}/trades`, timeoutMs);
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
            if (startupDiagnostics.bootstrapMs === null) {
                startupDiagnostics.bootstrapMs = performance.now() - startupDiagnostics.startedAt;
            }
            callbacks.onBootstrapComplete?.({
                pools: results.filter(Boolean).length,
                trades: renderedBootstrapTrades.size,
            });
        })
        .finally(() => { bootstrapPromise = null; });
    return bootstrapPromise;
}

async function fetchBootstrapTrades(pools) {
    const relayTask = fetchRelayRecentTrades(pools)
        .then((result) => {
            processBootstrapSnapshot(pools, result.trades);
            return { source: result.source, trades: result.trades };
        })
        .catch((error) => {
            console.warn('[bootstrap:helius]', error);
            return null;
        });
    const geckoTasks = pools.map(async (pool, index) => {
        // Start with the two highest-value pools immediately. The remaining
        // requests are lightly staggered. Helius normally paints the feed first;
        // GeckoTerminal stays independent as a resilience/enrichment path.
        if (index >= 2) await new Promise((resolve) => window.setTimeout(resolve, 450 + (index - 2) * 150));
        if (Date.now() < geckoRateLimitedUntil) return null;
        try {
            const result = { pool, trades: await fetchRecentPoolTrades(pool, 3_500) };
            processBootstrapPool(result);
            return result;
        } catch (error) {
            if (error.status === 429) return null;
            console.warn(`[bootstrap:${pool.dexId}]`, error);
            return null;
        }
    });
    return Promise.all([relayTask, ...geckoTasks]);
}

async function fetchRelayRecentTrades(pools) {
    const payload = await postJson(CONFIG.RELAY_RECENT_URL, {
        type: 'configure',
        pools: pools.map(({ address, dexId, quoteSymbol }) => ({ address, dexId, quoteSymbol })),
        market: { tokenPriceUsd: state.price, solPriceUsd: state.solPriceUsd },
    }, 3_200);
    if (!Array.isArray(payload?.trades)) throw new Error('Invalid Helius history response');
    return payload;
}

function processBootstrapSnapshot(pools, trades) {
    const grouped = new Map(pools.map((pool) => [pool.address, []]));
    trades.forEach((trade) => grouped.get(trade.poolAddress)?.push(trade));
    pools.forEach((pool) => {
        bootstrappedPools.add(pool.address);
        const combined = [
            ...(bootstrapTradesByPool.get(pool.address) || []),
            ...(grouped.get(pool.address) || []),
        ];
        bootstrapTradesByPool.set(pool.address, [...new Map(
            combined.map((trade) => [trade.txHash || trade.id, trade]),
        ).values()]);
    });
    publishBootstrapTrades();
}

function processBootstrapPool({ pool, trades }) {
    bootstrappedPools.add(pool.address);
    const combined = [...(bootstrapTradesByPool.get(pool.address) || []), ...trades];
    bootstrapTradesByPool.set(pool.address, [...new Map(
        combined.map((trade) => [trade.txHash || trade.id, trade]),
    ).values()]);
    publishBootstrapTrades();
}

function publishBootstrapTrades() {
    const uniqueTrades = [...new Map(
        [...bootstrapTradesByPool.values()].flat().map((trade) => [trade.txHash || trade.id, trade]),
    ).values()].sort((a, b) => a.timestamp - b.timestamp);
    const now = Date.now();
    const fiveMinuteTrades = uniqueTrades.filter((trade) => now - trade.timestamp <= 300_000);
    if ((state.activity5m.source === 'waiting' || state.activity5m.source === 'verified-swaps') && fiveMinuteTrades.length) {
        const activity = {
            buyCount: fiveMinuteTrades.filter((trade) => trade.isBuy).length,
            sellCount: fiveMinuteTrades.filter((trade) => !trade.isBuy).length,
            windowMs: 300_000,
            source: 'verified-swaps',
        };
        state.activity5m = activity;
        callbacks.onActivityUpdate?.(activity);
    }
    for (const trade of fiveMinuteTrades.slice(-CONFIG.MAX_TRADES_FEED)) {
        const key = trade.txHash || trade.id;
        if (renderedBootstrapTrades.has(key)) continue;
        renderedBootstrapTrades.add(key);
        seenTradeIds.add(trade.id);
        seenTradeHashes.add(trade.txHash);
        if (now - trade.timestamp <= STARTUP_TRADE_TTL_MS
            && spawnedBootstrapTrades.size < CONFIG.TRADES_BOOTSTRAP_COUNT) {
            spawnedBootstrapTrades.add(key);
            receiveTrade(trade, true);
        } else {
            publishHistoricalTrade(trade);
        }
    }
    uniqueTrades.forEach((trade) => {
        seenTradeIds.add(trade.id);
        seenTradeHashes.add(trade.txHash);
    });
}

function receiveTrade(trade, bootstrap) {
    rememberFeedTrade(trade);
    if (startupDiagnostics.firstTradeMs === null) {
        startupDiagnostics.firstTradeMs = performance.now() - startupDiagnostics.startedAt;
    }
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
    persistStartupSnapshot();
}

function publishHistoricalTrade(trade) {
    rememberFeedTrade(trade);
    if (startupDiagnostics.firstFeedMs === null) {
        startupDiagnostics.firstFeedMs = performance.now() - startupDiagnostics.startedAt;
    }
    callbacks.onHistoricalTrade?.(trade);
    persistStartupSnapshot();
}

function rememberFeedTrade(trade) {
    const key = trade.txHash || trade.id;
    recentFeedTrades = [...new Map([...recentFeedTrades, trade]
        .filter((item) => Date.now() - Number(item.timestamp) <= 300_000)
        .map((item) => [item.txHash || item.id, item]))
        .values()]
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(-CONFIG.MAX_TRADES_FEED);
    if (startupDiagnostics.firstFeedMs === null && key) {
        startupDiagnostics.firstFeedMs = performance.now() - startupDiagnostics.startedAt;
    }
}

function hydrateStartupSnapshot() {
    try {
        const snapshot = JSON.parse(window.localStorage.getItem(STARTUP_CACHE_KEY) || 'null');
        const age = Date.now() - Number(snapshot?.marketAt || snapshot?.savedAt || 0);
        if (!snapshot || age < 0 || age > STARTUP_MARKET_TTL_MS || !(Number(snapshot.market?.price) > 0)) return false;
        const trackedPools = Array.isArray(snapshot.trackedPools)
            ? snapshot.trackedPools.filter((pool) => (
                pool && typeof pool.address === 'string' && pool.address.length <= 64
                && !pool.address.includes('/') && !pool.address.includes('\\')
                && typeof pool.dexId === 'string' && pool.dexId.length <= 32
            )).slice(0, CONFIG.MAX_TRACKED_POOLS)
            : [];
        if (!trackedPools.length || !(Number(snapshot.solPriceUsd) > 0)) return false;
        restoringStartupCache = true;
        state.trackedPools = trackedPools;
        state.referencePool = snapshot.referencePool || trackedPools[0];
        state.marketCoverage = Number.isFinite(snapshot.marketCoverage) ? snapshot.marketCoverage : null;
        state.solPriceUsd = Number(snapshot.solPriceUsd);
        state.activity5m = snapshot.activity5m || state.activity5m;
        state.activity1h = snapshot.activity1h || state.activity1h;
        state.priceHistory = Array.isArray(snapshot.priceHistory) ? snapshot.priceHistory.slice(-60) : [];
        state.price = Number(snapshot.market.price);
        state.lastMarketAt = Number(snapshot.marketAt || snapshot.savedAt);
        latestMarket = {
            ...snapshot.market,
            pools: trackedPools.length,
            coverage: state.marketCoverage,
            referencePool: state.referencePool,
            cached: true,
        };
        callbacks.onActivityUpdate?.(state.activity5m);
        callbacks.onMarketUpdate?.(latestMarket);
        startupDiagnostics.cacheMs = performance.now() - startupDiagnostics.startedAt;
        startupDiagnostics.marketMs = startupDiagnostics.cacheMs;
        startupDiagnostics.marketSource = 'startup-cache';
        const cachedTrades = Array.isArray(snapshot.feedTrades)
            ? snapshot.feedTrades
            : (Array.isArray(snapshot.trades) ? snapshot.trades : []);
        cachedTrades
            .filter((trade) => isValidCachedTrade(trade, 300_000))
            .sort((a, b) => a.timestamp - b.timestamp)
            .forEach((trade) => {
                const key = trade.txHash || trade.id;
                if (renderedBootstrapTrades.has(key)) return;
                renderedBootstrapTrades.add(key);
                seenTradeIds.add(trade.id);
                seenTradeHashes.add(trade.txHash);
                if (Date.now() - trade.timestamp <= STARTUP_TRADE_TTL_MS
                    && spawnedBootstrapTrades.size < CONFIG.TRADES_BOOTSTRAP_COUNT) {
                    spawnedBootstrapTrades.add(key);
                    receiveTrade(trade, true);
                } else {
                    publishHistoricalTrade(trade);
                }
            });
        startStreamIfReady();
        void bootstrapTrackedPools();
        return true;
    } catch (error) {
        console.warn('[startup-cache] Ignored invalid snapshot', error);
        return false;
    } finally {
        restoringStartupCache = false;
    }
}

function isValidCachedTrade(trade, maxAge = STARTUP_TRADE_TTL_MS) {
    const age = Date.now() - Number(trade?.timestamp);
    return typeof trade?.txHash === 'string'
        && trade.txHash.length >= 8
        && trade.txHash.length <= 128
        && typeof trade.isBuy === 'boolean'
        && Number.isFinite(Number(trade.solValue))
        && Number(trade.solValue) >= 0
        && Number.isFinite(Number(trade.usdValue))
        && age >= 0
        && age <= maxAge;
}

function persistStartupSnapshot() {
    if (restoringStartupCache || !latestMarket || !(state.price > 0) || !state.trackedPools.length) return;
    try {
        window.localStorage.setItem(STARTUP_CACHE_KEY, JSON.stringify({
            savedAt: Date.now(),
            marketAt: state.lastMarketAt,
            market: { ...latestMarket, cached: false },
            trackedPools: state.trackedPools.slice(0, CONFIG.MAX_TRACKED_POOLS),
            referencePool: state.referencePool,
            marketCoverage: state.marketCoverage,
            solPriceUsd: state.solPriceUsd,
            activity5m: state.activity5m,
            activity1h: state.activity1h,
            priceHistory: state.priceHistory.slice(-60),
            trades: state.liveTrades.slice(-CONFIG.TRADES_BOOTSTRAP_COUNT),
            feedTrades: recentFeedTrades,
        }));
    } catch (error) {
        console.warn('[startup-cache] Snapshot unavailable', error);
    }
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
