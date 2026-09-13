import { CONFIG } from './config.js';
import { calculatePressure, deriveSolPrice } from './market.js';
import { connectTradeStream } from './stream.js';
import { discoverToken } from './token-discovery.js';
import { tokenCacheKey, urlWithMint, withTokenResolution } from './token-context.js';
import { defaultTokenRuntime } from './state.js';
import { createValuationBoundary, providerValuation } from './market-valuation.js';
import { activeTrade, createTradeJournal } from './market-evidence.js';

export function initAPI(callbacks = {}, { runtime = defaultTokenRuntime, initialMarket = null } = {}) {
    const { state } = runtime;
    const mint = runtime.context.identity.mint;
    const valuation = createValuationBoundary(mint);
    const journal = createTradeJournal(mint);
    const timers = new Set();
    const requests = new Set();
    let destroyed = false;
    let stream = null;
    let marketPromise = null;
    let recentPromise = null;
    let latestMarket = null;
    let marketSequence = 0;
    let appliedSequence = 0;
    let historyStarted = false;
    let providerDegraded = false;
    let lastChartAt = 0;
    let canonicalMarket = null;
    let marketEpoch = 0;
    const started = performance.now();
    const startup = { marketMs: null, firstTradeMs: null, marketSource: null, cacheMs: null };
    const cacheKey = tokenCacheKey('ansem-frontline:market', runtime.context, 'v3');
    const emit = (name, ...args) => { if (!destroyed) callbacks[name]?.(...args); };
    function schedule(fn, delay) {
        if (destroyed) return;
        const id = window.setTimeout(() => { timers.delete(id); if (!destroyed) void fn(); }, delay);
        timers.add(id);
    }
    async function json(url, body, timeout = 6000) {
        const controller = new AbortController(); requests.add(controller);
        const timer = window.setTimeout(() => controller.abort(), timeout); timers.add(timer);
        try {
            const response = await fetch(url, { signal: controller.signal,
                headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
                ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const result = await response.json();
            if (destroyed) throw new Error('RUNTIME_DESTROYED');
            return result;
        } finally { window.clearTimeout(timer); timers.delete(timer); requests.delete(controller); }
    }
    function connection() {
        const fresh = valuation.snapshot();
        const next = state.priceFailures >= 3 ? 'offline'
            : state.priceFailures || state.tradesFailures || providerDegraded || fresh?.freshness === 'STALE' ? 'degraded'
                : latestMarket ? 'online' : 'connecting';
        if (state.connection !== next) { state.connection = next; emit('onConnectionChange', next); }
    }
    function pressure() {
        const now = Date.now();
        state.liveTrades = journal.values(now).filter((t) => t.timestamp !== null && now - t.timestamp <= CONFIG.PRESSURE_WINDOW_MS);
        const p = calculatePressure(state.liveTrades, now);
        state.buySol60s = p.buySol; state.sellSol60s = p.sellSol; state.momentum = p.bullPercent;
        state.marketTrend = Math.sign(p.buySol - p.sellSol);
        state.targetFrontlineX = Math.max(-45, Math.min(45, (p.bullPercent - 50) * .9));
        state.pressureCoverage = p.coverage;
        emit('onPressureUpdate', p);
    }
    function receive(event, bootstrap = false) {
        if (destroyed) return;
        if (!canonicalMarket || event.poolAddress !== canonicalMarket.address || event.sourceEpoch !== marketEpoch) return;
        const previousFrontlineX = state.targetFrontlineX;
        const accepted = journal.upsert(event);
        if (!accepted.accepted) return;
        if (activeTrade(event) && Number.isFinite(event.timestamp)) state.lastTradeAt = Math.max(state.lastTradeAt || 0, event.timestamp);
        pressure();
        if (!accepted.fresh) {
            const before = accepted.previous;
            if (!activeTrade(event) || !activeTrade(before) || before.rawTokenAmount !== event.rawTokenAmount
                || before.rawQuoteAmount !== event.rawQuoteAmount || before.isBuy !== event.isBuy) {
                emit('onTradeReconciliation', event, journal.values(), before);
            } else emit('onSettlementUpdate', event);
            return;
        }
        if (!activeTrade(event)) return;
        if (startup.firstTradeMs === null) startup.firstTradeMs = performance.now() - started;
        if (event.timestamp !== null && Date.now() - event.timestamp <= 75_000) {
            emit('onTrade', event, { bootstrap, previousFrontlineX, nextFrontlineX: state.targetFrontlineX });
        } else emit('onHistoricalTrade', event);
    }
    function bindMarket(next, epoch = next?.sourceEpoch) {
        if (!Number.isSafeInteger(epoch) || epoch < marketEpoch || epoch < 1 || next && next.sourceEpoch !== epoch) return false;
        if (next && (next.tokenMint !== mint || next.compatibility !== 'POOL_STATE_AND_VAULTS_VERIFIED'
            || !Number.isSafeInteger(next.sourceEpoch) || next.sourceEpoch < marketEpoch)) return false;
        if (next && canonicalMarket && next.sourceEpoch === marketEpoch && next.address !== canonicalMarket.address) return false;
        if (epoch === marketEpoch && canonicalMarket?.address === next?.address && canonicalMarket?.sourceEpoch === next?.sourceEpoch) return true;
        const previous = journal.values();
        journal.clear(); canonicalMarket = next || null;
        marketEpoch = epoch;
        state.canonicalMarket = canonicalMarket; state.lastTradeAt = 0;
        pressure();
        for (const event of previous) emit('onTradeReconciliation', {
            ...event, settlement: 'REJECTED', reconciliationReason: 'MARKET_REBASE',
        }, [], event);
        return true;
    }
    function configureStream() {
        if (stream || !CONFIG.STREAM_URL || !state.trackedPools.length) return;
        stream = connectTradeStream(urlWithMint(CONFIG.STREAM_URL, runtime.context), {
            getConfiguration: () => ({ token: { mint, chain: 'solana' } }),
            onTrade: (event) => receive(event),
            onReconcile: (event) => receive(event),
            onSnapshot: (snapshot) => {
                if (snapshot.tokenMint === mint && bindMarket(snapshot.canonicalMarket, snapshot.sourceEpoch)) for (const event of snapshot.trades || []) receive(event, true);
            },
            onIntegrity: (diagnostics) => {
                if (diagnostics.tokenMint !== mint) return;
                if (!bindMarket(diagnostics.canonicalMarket, diagnostics.sourceEpoch)) return;
                state.integrity = diagnostics; providerDegraded = diagnostics.degraded; connection();
            },
            onStatus: (status) => { if (status !== 'online') providerDegraded = true; connection(); },
        });
    }
    function applyMarket(market, sequence, cached = false) {
        if (destroyed || sequence < appliedSequence || !market || !(Number(market.price) > 0) || !Number.isFinite(Number(market.price))) return;
        if (market.valuation?.tokenMint !== mint) return;
        if (market.selection && (market.selection.tokenMint !== mint
            || market.selection.pairAddress !== market.valuation.marketIdentity)) return;
        const accepted = valuation.accept(market.valuation);
        if (!accepted) return;
        appliedSequence = sequence;
        if (market.tokenContext) runtime.updateContext(market.tokenContext);
        state.valuation = accepted;
        state.marketSelection = market.selection || null;
        state.mcap = accepted.kind === 'MARKET_CAP' ? accepted.valueUsd : null;
        state.price = Number(market.price);
        state.prevPrice = state.price;
        state.solPriceUsd = Number(market.solPriceUsd) || 0;
        state.trackedPools = market.trackedPools || [];
        state.referencePool = market.referencePool || state.trackedPools[0] || null;
        state.marketCoverage = market.coverage ?? null;
        state.activity5m = market.activity || { buyCount: 0, sellCount: 0, source: 'unavailable', windowMs: 300_000 };
        state.activity1h = market.activity1h || { buyCount: 0, sellCount: 0, source: 'unavailable', windowMs: 3_600_000 };
        state.lastMarketAt = market.valuation.receivedAt;
        if (!cached) state.priceTicks30s = [...state.priceTicks30s, { price: state.price, timestamp: state.lastMarketAt }]
            .filter((t) => Date.now() - t.timestamp <= 31_000).slice(-90);
        latestMarket = { ...market, valuation: accepted, mcap: state.mcap, cached };
        if (startup.marketMs === null) {
            startup.marketMs = performance.now() - started;
            startup.marketSource = cached ? 'startup-cache' : market.source;
        }
        emit('onTokenContextChange', runtime.context);
        emit('onActivityUpdate', state.activity5m);
        emit('onMarketUpdate', latestMarket);
        configureStream();
        if (!historyStarted) { historyStarted = true; void refreshRecent(); }
        if (!cached) {
            try { window.localStorage.setItem(cacheKey, JSON.stringify({ ...market, tokenContext: undefined })); } catch { /* optional cache */ }
            void refreshChart().catch(() => {});
        }
        connection();
    }
    async function dexMarket() {
        const result = await discoverToken(runtime.context, {
            fetchPairs: (m) => json(`${CONFIG.DEXSCREENER_TOKEN_URL}/${encodeURIComponent(m)}`),
            fetchSolPrice: async () => {
                const p = await json(`${CONFIG.DEXSCREENER_TOKEN_URL}/${CONFIG.SOL_MINT}`);
                return deriveSolPrice(Array.isArray(p) ? p : p.pairs || []);
            },
            previousSelection: state.marketSelection,
        });
        if (!result.ok) throw new Error(result.error.code);
        return { ...result.market, tokenContext: result.context };
    }
    async function relayMarket() {
        const data = await json(urlWithMint(CONFIG.RELAY_MARKET_URL, runtime.context));
        if (!data.pools?.length || data.token?.identity?.mint !== mint) throw new Error('FALLBACK_IDENTITY_MISSING');
        const tokenContext = withTokenResolution(runtime.context, { resources: { pools: data.pools, referencePool: data.pools[0] },
            discovery: data.token.discovery, metadata: data.token.metadata, supply: data.token.supply });
        return { ...data, tokenContext, pools: data.pools.length, trackedPools: tokenContext.resources.pools,
            referencePool: tokenContext.resources.referencePool,
            valuation: data.valuation || providerValuation({ tokenMint: mint, source: 'helius-fallback', priceUsd: data.price }) };
    }
    function refreshMarket() {
        if (destroyed) return Promise.resolve();
        if (marketPromise) return marketPromise;
        const sequence = ++marketSequence;
        marketPromise = (async () => {
            try {
                if (!latestMarket) {
                    const dex = dexMarket();
                    const fallback = relayMarket();
                    const first = await Promise.any([dex, fallback]);
                    applyMarket(first, sequence);
                    if (first.source !== 'dexscreener') void dex.then((m) => applyMarket(m, sequence)).catch(() => {});
                } else {
                    let result;
                    try { result = await dexMarket(); } catch { result = await relayMarket(); }
                    applyMarket(result, sequence);
                }
                state.priceFailures = 0;
            } catch { if (!destroyed) state.priceFailures += 1; }
            finally { marketPromise = null; if (!destroyed) connection(); }
        })();
        return marketPromise;
    }
    async function refreshRecent() {
        if (destroyed || recentPromise) return recentPromise;
        recentPromise = (async () => {
            try {
                const snapshot = await json(CONFIG.RELAY_RECENT_URL, { type: 'configure', token: { mint, chain: 'solana' } });
                if (snapshot.version !== 4 || snapshot.tokenMint !== mint || !Array.isArray(snapshot.trades)) throw new Error('UNVERIFIED_HISTORY_CONTRACT');
                if (!bindMarket(snapshot.canonicalMarket, snapshot.sourceEpoch)) return;
                providerDegraded = snapshot.status === 'degraded';
                state.integrity = snapshot.integrity || null;
                // All updates, including invalidations, use the same identity path.
                for (const event of snapshot.trades) receive(event, true);
                state.tradesFailures = 0;
                emit('onBootstrapComplete', { pools: snapshot.pools, trades: journal.values().length });
            } catch { if (!destroyed) state.tradesFailures += 1; }
            finally { recentPromise = null; if (!destroyed) connection(); }
        })();
        return recentPromise;
    }
    async function refreshChart() {
        if (!state.referencePool || Date.now() - lastChartAt < 60_000) return;
        lastChartAt = Date.now();
        const poolAddress = state.referencePool.address;
        const snapshot = await json(`${CONFIG.GECKO_BASE}/${poolAddress}/ohlcv/minute?limit=60`);
        if (state.referencePool?.address !== poolAddress) return;
        const candles = snapshot.data?.attributes?.ohlcv_list;
        if (!Array.isArray(candles) || !candles.length) return;
        state.priceHistory = candles.slice(0, 60).reverse().map((c) => Number(c[4])).filter((p) => Number.isFinite(p) && p > 0);
        emit('onMarketUpdate', latestMarket);
    }
    async function marketLoop() { await refreshMarket(); schedule(marketLoop, Math.min(60_000, 5000 * 2 ** state.priceFailures)); }
    async function tradeLoop() { if (historyStarted) await refreshRecent(); schedule(tradeLoop, Math.min(45_000, 8000 * 1.5 ** state.tradesFailures)); }
    function freshnessLoop() {
        const previousFreshness = state.valuation?.freshness;
        state.valuation = valuation.snapshot();
        if (latestMarket && previousFreshness !== state.valuation?.freshness) {
            latestMarket = { ...latestMarket, valuation: state.valuation };
            emit('onMarketUpdate', latestMarket);
        }
        pressure(); connection();
        schedule(freshnessLoop, 1000);
    }
    if (import.meta.env.DEV || new URLSearchParams(window.location.search).has('diagnostics')) {
        window.__ansemStartupDiagnostics = () => ({ ...startup });
    }
    if (initialMarket) applyMarket(initialMarket, 0);
    else {
        try {
            const cache = JSON.parse(window.localStorage.getItem(cacheKey));
            if (cache?.valuation?.tokenMint === mint && Date.now() - cache.valuation.receivedAt >= 0
                && Date.now() - cache.valuation.receivedAt < 300_000) {
                // Cache is display-only and never supplies trade evidence.
                cache.valuation.authorityEligible = false; cache.valuation.evidenceLevel = 'PROVIDER_INDICATIVE';
                cache.valuation.freshness = 'STALE';
                applyMarket(cache, 0, true); startup.cacheMs = performance.now() - started;
            }
        } catch { /* discard untrusted/legacy caches */ }
    }
    schedule(marketLoop, initialMarket ? 5000 : 0);
    schedule(tradeLoop, 8000);
    schedule(freshnessLoop, 1000);
    return {
        runtime,
        async refresh() { if (destroyed) return; stream?.reconnect(); await Promise.allSettled([refreshMarket(), refreshRecent()]); },
        destroy() {
            destroyed = true; stream?.stop(); stream = null;
            for (const timer of timers) window.clearTimeout(timer);
            for (const controller of requests) controller.abort();
            timers.clear(); requests.clear(); journal.clear();
        },
        getDiagnostics: () => ({ mint, namespace: runtime.namespace, destroyed, timers: timers.size, requests: requests.size,
            streamActive: !!stream, bootstrapPending: !!recentPromise, selection: state.marketSelection, canonicalMarket,
            valuation: state.valuation, journal: journal.diagnostics(), integrity: state.integrity }),
    };
}
