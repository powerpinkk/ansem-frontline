import { CONFIG } from './config.js';
import { state } from './state.js';

const DOM = {};
let miniChartCtx = null;
let lastRenderedBullPct = -1;
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

    setupMiniChart();
    bindControls();
    setConnectionStatus('connecting');
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

    if (DOM.change) {
        DOM.change.textContent = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`;
        DOM.change.className = chg > 0 ? 'positive' : (chg < 0 ? 'negative' : 'neutral');
    }

    if (DOM.coverageValue) {
        DOM.coverageValue.textContent = `${pools} / ${coverage.toFixed(0)}%`;
        DOM.coverageValue.title = `Top ${pools} pools by activity; ${coverage.toFixed(1)}% of reported 24h volume. Reference chart: ${referencePool?.dexId || '—'}.`;
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
    miniChartCtx.strokeStyle = state.marketTrend >= 0 ? '#00ff88' : '#ff3366';
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
    });
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
