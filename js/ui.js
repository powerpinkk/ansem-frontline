import { CONFIG } from './config.js';
import { state } from './state.js';

const DOM = {};
let miniChartCtx = null;
let lastRenderedBullPct = -1;
let toastTimer = null;
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
    DOM.holdersCounter = document.getElementById('holders-counter');
    DOM.toast = document.getElementById('toast');
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
    document.getElementById('copy-wallet-btn')?.addEventListener('click', copyWallet);
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

export function updateMarketUI({ price, mcap, chg }) {
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

    renderMiniChart();
    updateDashboardUI();
}

export function updateHolders(count) {
    if (DOM.holdersCounter) {
        DOM.holdersCounter.textContent = count.toLocaleString();
    }
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

    const time = new Date(trade.timestamp).toLocaleTimeString();
    const side = trade.isBuy
        ? '<span class="trade-buy">BUY</span>'
        : '<span class="trade-sell">SELL</span>';

    const html = `<div class="trade-item" data-tx="${trade.txHash}"><span class="trade-time">${time}</span> ${side} <span class="trade-amount">${Math.round(trade.tokenAmount).toLocaleString()}</span> <span class="trade-usd">($${trade.usdValue.toLocaleString(undefined, { maximumFractionDigits: 0 })})</span></div>`;

    DOM.tradesfeed.insertAdjacentHTML('afterbegin', html);
    trimFeed(DOM.tradesfeed, CONFIG.MAX_TRADES_FEED);
}

export function addWhaleSpawnEvent(type, usdValue) {
    const html = `<div class="kill-item whale-event ${type === 'bear' ? 'bear' : ''}"><span class="kill-time">${new Date().toLocaleTimeString()}</span> ${type === 'bull' ? '🐂' : '🐻'} <span>WHALE ${type === 'bull' ? 'BUY' : 'SELL'} ($${Number(usdValue).toLocaleString(undefined, { maximumFractionDigits: 0 })})</span></div>`;
    DOM.killfeed.insertAdjacentHTML('afterbegin', html);
    trimFeed(DOM.killfeed, CONFIG.MAX_KILLFEED);
}

export function addRealKillEvent(killer, victim, isCrit, kW = false, vW = false) {
    const kStr = killer === 'bull' ? (kW ? 'Bull Whale' : 'Bull') : (kW ? 'Bear Whale' : 'Bear');
    const vStr = victim === 'bear' ? (vW ? 'Bear Whale' : 'Bear') : (vW ? 'Bull Whale' : 'Bull');
    const action = killer === 'bull' ? (isCrit ? 'destroyed' : 'liquidated') : (isCrit ? 'devoured' : 'dumped on');
    const color = killer === 'bull' ? 'var(--meadow-green)' : 'var(--bear-red)';

    const html = `<div class="kill-item"><span class="kill-time">${new Date().toLocaleTimeString()}</span> <span style="color:${color}; font-weight:600;">${kStr} ${action} ${vStr}</span></div>`;
    DOM.killfeed.insertAdjacentHTML('afterbegin', html);
    trimFeed(DOM.killfeed, CONFIG.MAX_KILLFEED);
}

function trimFeed(el, max) {
    while (el.children.length > max) {
        el.removeChild(el.lastChild);
    }
}

function copyWallet() {
    navigator.clipboard.writeText(CONFIG.DONATION_WALLET).then(() => {
        showToast(`Copied: ${CONFIG.DONATION_WALLET.slice(0, 8)}…`);
    }).catch(() => {
        showToast('Could not copy wallet');
    });
}

function showToast(message) {
    if (!DOM.toast) return;
    DOM.toast.textContent = message;
    DOM.toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => DOM.toast.classList.remove('visible'), 2500);
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

export function hideHoldersIfNoApiKey() {
    const box = document.getElementById('holders-box');
    if (box && !CONFIG.BIRDEYE_API_KEY) {
        box.style.display = 'none';
    }
}
