import { CONFIG } from './config.js';
import { deriveBattleTactics } from './market.js';
import { state } from './state.js';

const DOM = {};
let miniChartCtx = null;
let lastRenderedBullPct = -1;
let signalTimer = null;
let selectedTrade = null;
let sceneCallbacks = {
    setFrontlineColor: () => {},
};

const CONNECTION_LABELS = {
    connecting: 'CONNECTING…',
    online: 'LIVE · ON-CHAIN',
    offline: 'OFFLINE · RETRYING',
    degraded: 'DEGRADED · PARTIAL DATA',
};

export function initUI(sceneHooks = {}) {
    sceneCallbacks = { ...sceneCallbacks, ...sceneHooks };

    DOM.mcapValue = document.getElementById('mcap-value');
    DOM.price = document.getElementById('price');
    DOM.change = document.getElementById('change');
    DOM.bullBar = document.getElementById('bull-bar');
    DOM.bearBar = document.getElementById('bear-bar');
    DOM.bullPercent = document.getElementById('bull-percent');
    DOM.bearPercent = document.getElementById('bear-percent');
    DOM.killfeed = document.getElementById('killfeed');
    DOM.tradesfeed = document.getElementById('tradesfeed');
    DOM.connectionStatus = document.getElementById('connection-status');
    DOM.connectionLabel = document.getElementById('connection-label');
    DOM.coverageValue = document.getElementById('coverage-value');
    DOM.soundBtn = document.getElementById('sound-btn');
    DOM.camAuto = document.getElementById('cam-auto');
    DOM.camFree = document.getElementById('cam-free');
    DOM.buyFlowCount = document.getElementById('buy-flow-count');
    DOM.sellFlowCount = document.getElementById('sell-flow-count');
    DOM.pressureVolume = document.getElementById('pressure-volume');
    DOM.battleState = document.getElementById('battle-state');
    DOM.battleStateLabel = document.getElementById('battle-state-label');
    DOM.battleStateFlow = document.getElementById('battle-state-flow');
    DOM.battleStateDetail = document.getElementById('battle-state-detail');
    DOM.fieldTradeSignal = document.getElementById('field-trade-signal');
    DOM.visibleCoverage = document.getElementById('visible-coverage');
    DOM.dataFreshness = document.getElementById('data-freshness');
    DOM.awaySummary = document.getElementById('away-summary');
    DOM.rendererStatus = document.getElementById('renderer-status');
    DOM.unitInspector = document.getElementById('unit-inspector');
    DOM.unitInspectorClose = document.getElementById('unit-inspector-close');
    DOM.unitInspectorTitle = document.getElementById('unit-inspector-title');
    DOM.unitInspectorSol = document.getElementById('unit-inspector-sol');
    DOM.unitInspectorUsd = document.getElementById('unit-inspector-usd');
    DOM.unitInspectorPool = document.getElementById('unit-inspector-pool');
    DOM.unitInspectorAge = document.getElementById('unit-inspector-age');
    DOM.unitInspectorLink = document.getElementById('unit-inspector-link');

    setupMiniChart();
    bindControls();
    setConnectionStatus('connecting');
    updateFreshnessUI();
    window.setInterval(updateFreshnessUI, 1_000);
}

function setupMiniChart() {
    const canvas = document.getElementById('mini-chart');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = CONFIG.MINI_CHART_WIDTH * dpr;
    canvas.height = CONFIG.MINI_CHART_HEIGHT * dpr;
    canvas.style.width = `${CONFIG.MINI_CHART_WIDTH}px`;
    canvas.style.height = `${CONFIG.MINI_CHART_HEIGHT}px`;

    miniChartCtx = canvas.getContext('2d');
    miniChartCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function bindControls() {
    DOM.soundBtn?.addEventListener('click', () => window.__ansemToggleAudio?.());
    DOM.unitInspectorClose?.addEventListener('click', hideUnitInspector);
}

export function bindCameraControls(setCameraMode) {
    DOM.camAuto?.addEventListener('click', () => setCameraMode('auto'));
    DOM.camFree?.addEventListener('click', () => setCameraMode('free'));
    window.__ansemSetCameraUI = (mode) => {
        DOM.camAuto?.classList.toggle('active-blue', mode === 'auto');
        DOM.camFree?.classList.toggle('active-blue', mode === 'free');
    };
}

export function setConnectionStatus(status) {
    if (!DOM.connectionStatus) return;

    DOM.connectionStatus.className = `connection-status ${status}`;
    DOM.connectionLabel.textContent = CONNECTION_LABELS[status] || status.toUpperCase();
}

export function updateMarketUI({ price, mcap, chg, pools, coverage, referencePool }) {
    if (DOM.mcapValue) {
        DOM.mcapValue.textContent = mcap > 1_000_000
            ? `$${(mcap / 1_000_000).toFixed(2)}M`
            : `$${(mcap / 1000).toFixed(1)}K`;
    }

    if (DOM.price) {
        DOM.price.textContent = `$${price.toFixed(6)}`;
    }

    if (DOM.change && Number.isFinite(chg)) {
        DOM.change.textContent = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`;
        DOM.change.className = chg > 0 ? 'positive' : (chg < 0 ? 'negative' : 'neutral');
    } else if (DOM.change) {
        DOM.change.textContent = '—';
        DOM.change.className = 'neutral';
    }

    if (DOM.coverageValue) {
        DOM.coverageValue.textContent = Number.isFinite(coverage) ? `${pools} / ${coverage.toFixed(0)}%` : `${pools} / FALLBACK`;
        DOM.coverageValue.title = Number.isFinite(coverage)
            ? `Top ${pools} pools by activity; ${coverage.toFixed(1)}% of reported 24h volume. Reference chart: ${referencePool?.dexId || '—'}.`
            : `${pools} verified fallback pools via Helius. Reference chart: ${referencePool?.dexId || '—'}.`;
    }

    renderMiniChart();
    updateDashboardUI();
}

export function renderMiniChart() {
    if (!miniChartCtx) return;

    const w = CONFIG.MINI_CHART_WIDTH;
    const h = CONFIG.MINI_CHART_HEIGHT;
    miniChartCtx.clearRect(0, 0, w, h);

    if (state.priceHistory.length < 2) return;

    const minP = Math.min(...state.priceHistory);
    const maxP = Math.max(...state.priceHistory);
    const range = maxP - minP || 0.000001;

    miniChartCtx.beginPath();
    const chartRising = state.priceHistory[state.priceHistory.length - 1] >= state.priceHistory[0];
    miniChartCtx.strokeStyle = chartRising ? '#00ff88' : '#9b1739';
    miniChartCtx.lineWidth = 2;
    miniChartCtx.lineJoin = 'round';

    state.priceHistory.forEach((price, i) => {
        const x = (i / (state.priceHistory.length - 1)) * w;
        const y = h - 5 - ((price - minP) / range) * (h - 10);
        if (i === 0) miniChartCtx.moveTo(x, y);
        else miniChartCtx.lineTo(x, y);
    });
    miniChartCtx.stroke();
}

export function updateDashboardUI() {
    requestAnimationFrame(() => {
        const bullPct = Math.round(state.momentum);

        if (bullPct !== lastRenderedBullPct) {
            DOM.bullBar.style.transform = `scaleX(${bullPct / 100})`;
            DOM.bearBar.style.transform = `scaleX(${(100 - bullPct) / 100})`;
            DOM.bullPercent.textContent = `${bullPct}%`;
            DOM.bearPercent.textContent = `${100 - bullPct}%`;
            lastRenderedBullPct = bullPct;
        }

        const colorHex = state.marketTrend === 1 ? 0x00ff88 : (state.marketTrend === -1 ? 0xff3366 : 0xffffff);
        sceneCallbacks.setFrontlineColor(colorHex);
        if (DOM.pressureVolume) {
            DOM.pressureVolume.textContent = `${formatSol(state.buySol60s)} / ${formatSol(state.sellSol60s)} SOL`;
            DOM.pressureVolume.title = 'Verified buy SOL / sell SOL in the rolling 60-second window';
        }
        updateBattleState();
    });
}

function updateBattleState() {
    if (!DOM.battleState) return;
    const tactics = deriveBattleTactics({
        buySol: state.buySol60s,
        sellSol: state.sellSol60s,
        buyCount: state.activity5m.buyCount,
        sellCount: state.activity5m.sellCount,
    });
    DOM.battleState.className = tactics.state;
    DOM.battleStateLabel.textContent = tactics.label;
    const netSol = state.buySol60s - state.sellSol60s;
    if (DOM.battleStateFlow) {
        DOM.battleStateFlow.textContent = Math.abs(netSol) < 0.005
            ? 'NO VERIFIED FLOW · 60S'
            : `${netSol > 0 ? 'BUYERS' : 'SELLERS'} ${netSol > 0 ? '+' : '−'}${formatSol(Math.abs(netSol))} SOL · 60S`;
    }
    if (tactics.state === 'bull') DOM.battleStateDetail.textContent = 'Bulls surge forward · grizzlies backpedal toward their lines';
    else if (tactics.state === 'bear') DOM.battleStateDetail.textContent = 'Grizzlies push forward · bulls fall back toward the King';
    else if (tactics.state === 'contested') DOM.battleStateDetail.textContent = 'Both sides cross contested ground while 60s SOL flow moves the marker';
    else DOM.battleStateDetail.textContent = 'No verified SOL flow in 60s · tracked 5m market ranks muster behind the front';
    updateVisibleCoverage(state.visibleCombatants);
}

function formatSol(value) {
    if (value >= 100) return Math.round(value).toLocaleString();
    if (value >= 10) return value.toFixed(1);
    return value.toFixed(2);
}

export function addOnChainTrade(trade) {
    const empty = DOM.tradesfeed.querySelector('.trades-empty');
    if (empty) empty.remove();

    const row = document.createElement('a');
    row.className = `trade-item trade-link ${trade.isWhale ? 'is-whale' : ''}`;
    row.href = `https://solscan.io/tx/${encodeURIComponent(trade.txHash)}`;
    row.target = '_blank';
    row.rel = 'noopener noreferrer';
    row.title = `Verify on Solscan · ${trade.dexId}`;
    const time = document.createElement('span');
    time.className = 'trade-time';
    time.textContent = new Date(trade.timestamp).toLocaleTimeString();
    const side = document.createElement('span');
    side.className = trade.isBuy ? 'trade-buy' : 'trade-sell';
    side.textContent = trade.isBuy ? 'BUY' : 'SELL';
    const amount = document.createElement('span');
    amount.className = 'trade-amount';
    amount.textContent = `${trade.solValue.toFixed(trade.solValue >= 10 ? 1 : 2)} SOL`;
    const value = document.createElement('span');
    value.className = 'trade-usd';
    value.textContent = ` · $${trade.usdValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} · ${trade.dexId}`;
    row.append(time, side, amount, value);
    DOM.tradesfeed.prepend(row);
    trimFeed(DOM.tradesfeed, CONFIG.MAX_TRADES_FEED);
}

export function showFieldTradeSignal(trade) {
    if (!DOM.fieldTradeSignal || !trade) return;
    window.clearTimeout(signalTimer);
    const side = trade.isBuy ? 'BUY' : 'SELL';
    const scale = trade.isWhale ? 'GIANT ' : '';
    DOM.fieldTradeSignal.textContent = `${scale}${side} · ${formatSol(trade.solValue)} SOL · ${String(trade.dexId || 'ON-CHAIN').toUpperCase()}`;
    DOM.fieldTradeSignal.className = `field-trade-signal ${trade.isBuy ? 'buy' : 'sell'}`;
    void DOM.fieldTradeSignal.offsetWidth;
    DOM.fieldTradeSignal.classList.add('show');
    signalTimer = window.setTimeout(() => DOM.fieldTradeSignal?.classList.remove('show'), 3_300);
}

export function updateVisibleCoverage(counts = state.visibleCombatants) {
    if (!DOM.visibleCoverage) return;
    const cutoff = Date.now() - CONFIG.PRESSURE_WINDOW_MS;
    const recentVerified = state.liveTrades.filter((trade) => trade.timestamp >= cutoff).length;
    const total = Number(counts?.total || 0);
    const bull = Number(counts?.bull || 0);
    const bear = Number(counts?.bear || 0);
    DOM.visibleCoverage.textContent = `BULL FORCE ${bull} · BEAR FORCE ${bear} · ${recentVerified} VERIFIED SWAP${recentVerified === 1 ? '' : 'S'} / 60S`;
    DOM.visibleCoverage.title = `Solid champions represent up to ${CONFIG.MAX_VISIBLE_UNITS_PER_SIDE} individually verifiable swaps per side. Instanced army ranks scale from tracked 5-minute transaction counts plus verified 60-second SOL volume; ${total} total visual forces are currently rendered.`;
}

export function showUnitInspector(entity) {
    const trade = entity?.trade;
    if (!DOM.unitInspector || !trade?.txHash) {
        hideUnitInspector();
        return;
    }
    selectedTrade = trade;
    DOM.unitInspector.hidden = false;
    DOM.unitInspector.className = `unit-inspector ${trade.isBuy ? 'buy' : 'sell'}`;
    DOM.unitInspectorTitle.textContent = `${trade.isWhale ? 'GIANT ' : ''}${trade.isBuy ? 'BLACK BULL · BUY' : 'GRIZZLY · SELL'}`;
    DOM.unitInspectorSol.textContent = `${formatSol(trade.solValue)} SOL`;
    DOM.unitInspectorUsd.textContent = `$${Math.round(trade.usdValue).toLocaleString()}`;
    DOM.unitInspectorPool.textContent = String(trade.dexId || 'unknown').toUpperCase();
    DOM.unitInspectorPool.title = `${trade.dexId || 'unknown'} · ${trade.quoteSymbol || '—'}`;
    DOM.unitInspectorAge.textContent = formatAge(Date.now() - trade.timestamp);
    DOM.unitInspectorLink.href = `https://solscan.io/tx/${encodeURIComponent(trade.txHash)}`;
}

export function hideUnitInspector() {
    selectedTrade = null;
    if (DOM.unitInspector) DOM.unitInspector.hidden = true;
}

export function showAwaySummary({ durationMs = 0, buys = 0, sells = 0, buySol = 0, sellSol = 0 } = {}) {
    if (!DOM.awaySummary || durationMs < 5_000) return;
    const netSol = buySol - sellSol;
    const duration = durationMs >= 60_000 ? `${Math.round(durationMs / 60_000)}m` : `${Math.round(durationMs / 1_000)}s`;
    DOM.awaySummary.textContent = `WHILE AWAY ${duration} · ${buys} BUY${buys === 1 ? '' : 'S'} · ${sells} SELL${sells === 1 ? '' : 'S'} · NET ${netSol >= 0 ? '+' : '−'}${formatSol(Math.abs(netSol))} SOL`;
    DOM.awaySummary.classList.remove('show');
    void DOM.awaySummary.offsetWidth;
    DOM.awaySummary.classList.add('show');
}

export function setRendererStatus(status) {
    if (!DOM.rendererStatus) return;
    DOM.rendererStatus.hidden = status !== 'lost';
}

function updateFreshnessUI() {
    if (selectedTrade && DOM.unitInspectorAge) {
        DOM.unitInspectorAge.textContent = formatAge(Date.now() - selectedTrade.timestamp);
    }
    if (!DOM.dataFreshness) return;
    const lastDataAt = Math.max(state.lastMarketAt || 0, state.lastTradeAt || 0);
    if (!lastDataAt) {
        DOM.dataFreshness.textContent = 'WAITING FOR MARKET DATA';
        DOM.dataFreshness.className = 'data-freshness';
        return;
    }
    const ageMs = Math.max(0, Date.now() - lastDataAt);
    DOM.dataFreshness.textContent = `DATA ${formatAge(ageMs)} AGO`;
    DOM.dataFreshness.className = `data-freshness ${ageMs < 20_000 ? 'fresh' : 'stale'}`;
}

function formatAge(ageMs) {
    if (ageMs < 1_000) return 'NOW';
    if (ageMs < 60_000) return `${Math.floor(ageMs / 1_000)}S`;
    return `${Math.floor(ageMs / 60_000)}M`;
}

export function updateActivityUI(activity) {
    if (DOM.buyFlowCount) DOM.buyFlowCount.textContent = String(activity?.buyCount || 0);
    if (DOM.sellFlowCount) DOM.sellFlowCount.textContent = String(activity?.sellCount || 0);
    updateBattleState();
}

export function addWhaleSpawnEvent(type, solValue, usdValue) {
    const row = document.createElement('div');
    row.className = `kill-item whale-event ${type === 'bear' ? 'bear' : ''}`;
    row.textContent = `${new Date().toLocaleTimeString()} ${type === 'bull' ? '🐂' : '🐻'} GIANT ${type === 'bull' ? 'BUY' : 'SELL'} · ${solValue.toFixed(1)} SOL · $${Math.round(usdValue).toLocaleString()}`;
    DOM.killfeed.prepend(row);
    trimFeed(DOM.killfeed, CONFIG.MAX_KILLFEED);
}

export function addRealKillEvent(killer, victim, isCrit, kW = false, vW = false) {
    const kStr = killer === 'bull' ? (kW ? 'Bull Whale' : 'Bull') : (kW ? 'Bear Whale' : 'Bear');
    const vStr = victim === 'bear' ? (vW ? 'Bear Whale' : 'Bear') : (vW ? 'Bull Whale' : 'Bull');
    const action = killer === 'bull' ? (isCrit ? 'destroyed' : 'liquidated') : (isCrit ? 'devoured' : 'dumped on');
    const row = document.createElement('div');
    row.className = `kill-item ${killer === 'bull' ? 'bull-kill' : 'bear-kill'}`;
    row.textContent = `${new Date().toLocaleTimeString()} · ${kStr} ${action} ${vStr}`;
    DOM.killfeed.prepend(row);
    trimFeed(DOM.killfeed, CONFIG.MAX_KILLFEED);
}

function trimFeed(el, max) {
    while (el.children.length > max) {
        el.removeChild(el.lastChild);
    }
}

export function setAudioButton(enabled) {
    if (!DOM.soundBtn) return;
    DOM.soundBtn.textContent = enabled ? '🔊 SOUND ON' : '🔇 SOUND OFF';
    DOM.soundBtn.classList.toggle('active', enabled);
}

export function showTradesWaiting() {
    if (!DOM.tradesfeed) return;
    if (!DOM.tradesfeed.querySelector('.trades-empty')) {
        DOM.tradesfeed.innerHTML = '<div class="trades-empty">Waiting for on-chain swaps…</div>';
    }
}

export function addBullSwarmEvent({ buyCount, buySol, dominance }) {
    const row = document.createElement('div');
    row.className = 'kill-item bull-swarm-event';
    row.textContent = `${new Date().toLocaleTimeString()} · BULL SWARM · ${buyCount} buys · ${buySol.toFixed(1)} SOL · King's support ${Math.round(dominance * 100)}%`;
    DOM.killfeed.prepend(row);
    trimFeed(DOM.killfeed, CONFIG.MAX_KILLFEED);
}

export function addKingReclaimEvent({ count, solValue, reason, bullPercent }) {
    const row = document.createElement('div');
    row.className = 'kill-item bull-swarm-event';
    if (reason === 'king-defense') {
        row.textContent = `${new Date().toLocaleTimeString()} · KING'S WARD · ${count} invading ${count === 1 ? 'grizzly' : 'grizzlies'} repelled · ${Math.round(bullPercent)}% buy pressure`;
        DOM.killfeed.prepend(row);
        trimFeed(DOM.killfeed, CONFIG.MAX_KILLFEED);
        return;
    }
    const trigger = reason === 'sustained-control'
        ? `${Math.round(bullPercent)}% sustained buy pressure`
        : `${solValue.toFixed(1)} SOL buy reversal`;
    row.textContent = `${new Date().toLocaleTimeString()} · KING'S RECLAMATION · ${count} stranded ${count === 1 ? 'grizzly' : 'grizzlies'} cleared · ${trigger}`;
    DOM.killfeed.prepend(row);
    trimFeed(DOM.killfeed, CONFIG.MAX_KILLFEED);
}
