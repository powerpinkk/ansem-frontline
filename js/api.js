import { CONFIG } from './config.js';
import { calculatePressure, deriveSolPrice, parseGeckoTrade, selectTrackedPools } from './market.js';
import { connectTradeStream } from './stream.js';
import { bootstrappedPools, seenTradeHashes, seenTradeIds, state } from './state.js';

let callbacks = {};
let priceDelay = CONFIG.FETCH_MIN_DELAY_MS;
let tradesDelay = CONFIG.TRADES_POLL_MIN_DELAY_MS;
let lastPoolDiscovery = 0;
let pollingFallback = true;
let fallbackTimer = null;
let streamStarted = false;

export function initAPI(nextCallbacks) {
    callbacks = nextCallbacks;
    setConnection('connecting');
    schedule(runMarketLoop, 0);
    schedule(runTradeLoop, 1200);
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
        await fetchMarketData();
        state.priceFailures = 0;
        priceDelay = CONFIG.FETCH_MIN_DELAY_MS;
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
        tradesDelay = Math.min(CONFIG.TRADES_POLL_MAX_DELAY_MS, tradesDelay * 1.5);
        console.error(`[trades:${pool.dexId}]`, error);
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
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
    startStreamIfReady();
    updateTrend(market.price);
    try {
        await fetchChartIfNeeded(market.price);
    } catch (error) {
        console.warn('[chart] OHLCV unavailable', error);
    }
    callbacks.onMarketUpdate?.(market);
}

async function fetchDexMarketData() {
    const data = await fetchJson(`${CONFIG.DEXSCREENER_TOKEN_URL}/${CONFIG.TOKEN_MINT}`, 4_500);
    const pairs = data?.pairs || [];
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
    const liquidity = selectedPairs.reduce((sum, pair) => sum + Number(pair.liquidity?.usd || 0), 0);
    const price = liquidity > 0
        ? selectedPairs.reduce((sum, pair) => sum + Number(pair.priceUsd || 0) * Number(pair.liquidity?.usd || 0), 0) / liquidity
        : Number(pairs[0].priceUsd || 0);
    const mcap = Number(pairs[0].marketCap || pairs[0].fdv || 0);
    const chg = Number(pairs[0].priceChange?.h1 || 0);
    return { price, mcap, chg, pools: state.trackedPools.length, coverage: state.marketCoverage, referencePool: state.referencePool, source: 'dexscreener' };
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
    connectTradeStream(CONFIG.STREAM_URL, {
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
    if (!state.referencePool || Date.now() - state.lastChartFetch < CONFIG.CHART_CACHE_MS) return;
    const json = await fetchJson(`${CONFIG.GECKO_BASE}/${state.referencePool.address}/ohlcv/minute?limit=60`);
    const candles = json.data?.attributes?.ohlcv_list;
    if (!candles?.length) return;
    state.priceHistory = candles.slice().reverse().map((candle) => Number(candle[4]));
    state.priceHistory[state.priceHistory.length - 1] = livePrice;
    state.lastChartFetch = Date.now();
}

async function fetchPoolTrades(pool) {
    const json = await fetchJson(`${CONFIG.GECKO_BASE}/${pool.address}/trades`);
    const trades = (json.data || []).map((entry) => parseGeckoTrade(entry, pool, state.solPriceUsd)).filter(Boolean).sort((a, b) => a.timestamp - b.timestamp);
    if (!trades.length) return;
    if (!bootstrappedPools.has(pool.address)) {
        trades.forEach((trade) => {
            seenTradeIds.add(trade.id);
            seenTradeHashes.add(trade.txHash);
        });
        trades.slice(-CONFIG.TRADES_BOOTSTRAP_COUNT).forEach((trade) => receiveTrade(trade, true));
        bootstrappedPools.add(pool.address);
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

function receiveTrade(trade, bootstrap) {
    state.liveTrades.push(trade);
    const cutoff = Date.now() - CONFIG.PRESSURE_WINDOW_MS;
    state.liveTrades = state.liveTrades.filter((item) => item.timestamp >= cutoff).slice(-500);
    const pressure = calculatePressure(state.liveTrades);
    state.momentum = pressure.bullPercent;
    state.buySol60s = pressure.buySol;
    state.sellSol60s = pressure.sellSol;
    state.marketTrend = Math.sign(pressure.buySol - pressure.sellSol);
    state.targetFrontlineX = Math.max(-45, Math.min(45, (pressure.bullPercent - 50) * 0.9));
    callbacks.onTrade?.(trade, { bootstrap });
    callbacks.onPressureUpdate?.(pressure);
}
