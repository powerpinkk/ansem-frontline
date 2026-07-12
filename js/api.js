import { CONFIG } from './config.js';
import { state, seenTradeHashes } from './state.js';

let onMarketUpdate = () => {};
let onTrade = () => {};
let onConnectionChange = () => {};

let priceDelay = CONFIG.FETCH_MIN_DELAY_MS;
let tradesDelay = CONFIG.TRADES_POLL_MIN_DELAY_MS;
let priceLoopTimer = null;
let tradesLoopTimer = null;

export function initAPI(callbacks) {
    onMarketUpdate = callbacks.onMarketUpdate || onMarketUpdate;
    onTrade = callbacks.onTrade || onTrade;
    onConnectionChange = callbacks.onConnectionChange || onConnectionChange;

    setConnection('connecting');
    schedulePriceLoop(0);
    scheduleTradesLoop(1500);
}

export function getPrimaryPairAddress() {
    return state.primaryPairAddress;
}

function setConnection(status) {
    if (state.connection === status) return;
    state.connection = status;
    onConnectionChange(status);
}

function updateConnectionAggregate() {
    if (state.priceFailures >= 3) {
        setConnection('offline');
    } else if (state.priceFailures > 0 || state.tradesFailures >= 3) {
        setConnection('degraded');
    } else if (state.primaryPairAddress) {
        setConnection('online');
    } else if (state.priceFailures === 0 && !state.primaryPairAddress) {
        setConnection('connecting');
    }
}

function schedulePriceLoop(delay) {
    clearTimeout(priceLoopTimer);
    priceLoopTimer = setTimeout(runPriceLoop, delay);
}

function scheduleTradesLoop(delay) {
    clearTimeout(tradesLoopTimer);
    tradesLoopTimer = setTimeout(runTradesLoop, delay);
}

async function runPriceLoop() {
    try {
        await fetchMarketData();
        state.priceFailures = 0;
        priceDelay = CONFIG.FETCH_MIN_DELAY_MS;
        updateConnectionAggregate();
    } catch (err) {
        state.priceFailures += 1;
        priceDelay = Math.min(CONFIG.FETCH_MAX_DELAY_MS, priceDelay * 2);
        updateConnectionAggregate();
        console.error('[API] Market fetch failed:', err);
    }
    schedulePriceLoop(priceDelay);
}

async function runTradesLoop() {
    if (!state.primaryPairAddress) {
        scheduleTradesLoop(CONFIG.TRADES_POLL_MIN_DELAY_MS);
        return;
    }

    try {
        await fetchRealTrades(state.primaryPairAddress);
        state.tradesFailures = 0;
        tradesDelay = CONFIG.TRADES_POLL_MIN_DELAY_MS;
        updateConnectionAggregate();
    } catch (err) {
        state.tradesFailures += 1;
        tradesDelay = Math.min(CONFIG.TRADES_POLL_MAX_DELAY_MS, tradesDelay * 2);
        updateConnectionAggregate();
        console.error('[API] Trades fetch failed:', err);
    }
    scheduleTradesLoop(tradesDelay);
}

async function fetchMarketData() {
    const url = state.primaryPairAddress
        ? `${CONFIG.DEXSCREENER_PAIR_URL}/${state.primaryPairAddress}`
        : `${CONFIG.DEXSCREENER_TOKEN_URL}/${CONFIG.TOKEN_MINT}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`);

    const data = await res.json();
    const pair = state.primaryPairAddress ? data?.pair : data?.pairs?.[0];
    if (!pair) throw new Error('No trading pair found');

    if (!state.primaryPairAddress && pair.pairAddress) {
        state.primaryPairAddress = pair.pairAddress;
    }

    const price = parseFloat(pair.priceUsd || 0);
    const mcap = parseFloat(pair.fdv || pair.marketCap || 0);
    const chg = parseFloat(pair.priceChange?.h1 ?? pair.priceChange?.m5 ?? 0);
    const txns = pair.txns?.h1 || pair.txns?.m5 || { buys: 0, sells: 0 };
    const totalTxns = (txns.buys || 0) + (txns.sells || 0);

    if (totalTxns > 0) {
        state.buyRatio = txns.buys / totalTxns;
        state.txVolumeMultiplier = Math.min(2.5, Math.max(0.5, totalTxns / 50));
    }

    state.price = price;

    let pDelta = price - state.prevPrice;
    if (pDelta > 0 || chg > 1) {
        state.marketTrend = 1;
        state.targetFrontlineX = Math.min(45, state.frontlineX + 10);
        state.momentum = Math.min(100, state.momentum + 10);
    } else if (pDelta < 0 || chg < -1) {
        state.marketTrend = -1;
        state.targetFrontlineX = Math.max(-45, state.frontlineX - 10);
        state.momentum = Math.max(0, state.momentum - 10);
    } else {
        state.marketTrend = 0;
        state.momentum = state.momentum * 0.95 + 50 * 0.05;
    }

    state.prevPrice = price;

    if (pair.pairAddress) {
        try {
            await fetch1HChart(pair.pairAddress, price);
        } catch (err) {
            console.warn('[API] Chart fetch failed:', err);
        }
    }

    onMarketUpdate({ price, mcap, chg });
}

async function fetch1HChart(poolAddress, livePrice) {
    const now = Date.now();
    if (now - state.lastChartFetch < CONFIG.CHART_CACHE_MS) return;

    const res = await fetch(`${CONFIG.GECKO_BASE}/${poolAddress}/ohlcv/minute?limit=60`);
    if (!res.ok) throw new Error(`GeckoTerminal OHLCV HTTP ${res.status}`);

    const json = await res.json();
    const ohlcv = json.data?.attributes?.ohlcv_list;
    if (!ohlcv?.length) return;

    state.priceHistory = ohlcv.slice().reverse().map((candle) => parseFloat(candle[4]));
    state.lastChartFetch = now;

    if (livePrice > 0 && state.priceHistory.length > 0) {
        state.priceHistory[state.priceHistory.length - 1] = livePrice;
    }
}

async function fetchRealTrades(poolAddress) {
    const res = await fetch(`${CONFIG.GECKO_BASE}/${poolAddress}/trades`);
    if (!res.ok) throw new Error(`GeckoTerminal trades HTTP ${res.status}`);

    const json = await res.json();
    const trades = json.data || [];
    if (!trades.length) return;

    const parsed = trades
        .map(parseGeckoTrade)
        .filter(Boolean)
        .sort((a, b) => a.timestamp - b.timestamp);

    if (!state.tradesBootstrapped) {
        parsed.forEach((t) => seenTradeHashes.add(t.txHash));
        parsed.slice(-CONFIG.TRADES_BOOTSTRAP_COUNT).forEach((trade) => {
            onTrade(trade, { bootstrap: true });
        });
        state.tradesBootstrapped = true;
        return;
    }

    const fresh = parsed.filter((trade) => !seenTradeHashes.has(trade.txHash));
    fresh.forEach((trade) => {
        seenTradeHashes.add(trade.txHash);
        onTrade(trade, { bootstrap: false });
    });

    if (seenTradeHashes.size > 500) {
        const keep = parsed.slice(-200).map((t) => t.txHash);
        seenTradeHashes.clear();
        keep.forEach((hash) => seenTradeHashes.add(hash));
    }
}

function parseGeckoTrade(entry) {
    const attrs = entry?.attributes;
    if (!attrs?.tx_hash) return null;

    const isBuy = attrs.kind === 'buy';
    const tokenAmount = attrs.from_token_address === CONFIG.TOKEN_MINT
        ? parseFloat(attrs.from_token_amount)
        : parseFloat(attrs.to_token_amount);

    return {
        txHash: attrs.tx_hash,
        isBuy,
        tokenAmount: Number.isFinite(tokenAmount) ? tokenAmount : 0,
        usdValue: parseFloat(attrs.volume_in_usd) || 0,
        timestamp: new Date(attrs.block_timestamp).getTime(),
        wallet: attrs.tx_from_address,
    };
}

export async function fetchHoldersIfConfigured(onHolders) {
    if (!CONFIG.BIRDEYE_API_KEY) return;

    try {
        const res = await fetch(
            `https://public-api.birdeye.so/defi/token_overview?address=${CONFIG.TOKEN_MINT}`,
            {
                headers: {
                    'X-API-KEY': CONFIG.BIRDEYE_API_KEY,
                    accept: 'application/json',
                },
            }
        );
        if (!res.ok) return;

        const json = await res.json();
        if (json?.success && json.data?.holder) {
            state.holders = json.data.holder;
            onHolders(state.holders);
        }
    } catch (err) {
        console.warn('[API] Holders fetch failed:', err);
    }
}

export function startHoldersPolling(onHolders) {
    if (!CONFIG.BIRDEYE_API_KEY) return;
    fetchHoldersIfConfigured(onHolders);
    setInterval(() => fetchHoldersIfConfigured(onHolders), CONFIG.HOLDERS_CACHE_MS);
}
