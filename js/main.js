import { initAPI } from './api.js';
import { evaluateBuySwarm } from './market.js';
import { state } from './state.js';
import { initPixelCompanion } from './companion.js';
import {
    initUI,
    bindCameraControls,
    setConnectionStatus,
    updateMarketUI,
    updateDashboardUI,
    addOnChainTrade,
    addWhaleSpawnEvent,
    addRealKillEvent,
    addBullSwarmEvent,
    addKingReclaimEvent,
    setAudioButton,
    showTradesWaiting,
    updateActivityUI,
    showFieldTradeSignal,
    updateVisibleCoverage,
    showUnitInspector,
    showAwaySummary,
    setRendererStatus,
    showBattleLogSyncing,
    updateBattleLogSnapshot,
    showTradesReady,
} from './ui.js';
let lastBullSwarmAt = 0;
let awaySession = null;
let sceneReady = false;
let sceneModule = null;
const pendingSceneTrades = [];

function handleTrade(trade, meta) {
    if (awaySession && !meta.bootstrap && trade.timestamp >= awaySession.startedAt) {
        if (trade.isBuy) {
            awaySession.buys += 1;
            awaySession.buySol += trade.solValue;
        } else {
            awaySession.sells += 1;
            awaySession.sellSol += trade.solValue;
        }
    }
    addOnChainTrade(trade);
    if (!meta.bootstrap) showFieldTradeSignal(trade);
    const type = trade.isBuy ? 'bull' : 'bear';
    if (trade.isWhale) addWhaleSpawnEvent(type, trade.solValue, trade.usdValue);
    if (!sceneReady) {
        pendingSceneTrades.push({ trade, meta });
        return;
    }
    applyTradeToScene(trade, meta);
}

function applyTradeToScene(trade, meta) {
    const type = trade.isBuy ? 'bull' : 'bear';
    sceneModule.spawnUnit(type, meta.bootstrap, trade.isWhale, trade);
    sceneModule.applyTradeImpulse(trade.isBuy, trade.solValue, trade.isWhale);
    sceneModule.handleTerritoryShift(trade, meta);
    const now = Date.now();
    const swarm = evaluateBuySwarm(state.liveTrades, now, lastBullSwarmAt);
    if (!meta.bootstrap && swarm.triggered) {
        lastBullSwarmAt = now;
        sceneModule.triggerBullKingSupport(swarm);
        addBullSwarmEvent(swarm);
    }
    updateDashboardUI();
}

function flushPendingSceneTrades() {
    sceneReady = true;
    pendingSceneTrades.splice(0).forEach(({ trade, meta }) => applyTradeToScene(trade, meta));
}

function handleActivity(activity) {
    updateActivityUI(activity);
}

function handleMarket(market) {
    updateMarketUI(market);
    updateBattleLogSnapshot(market);
}

function boot() {
    initUI({ setFrontlineColor: (color) => sceneModule?.setFrontlineColor(color) });
    bindCameraControls((mode) => sceneModule?.setCameraMode(mode));
    showBattleLogSyncing();
    showTradesWaiting();

    window.__ansemToggleAudioUI = setAudioButton;

    const api = initAPI({
        onMarketUpdate: handleMarket,
        onTrade: handleTrade,
        onHistoricalTrade: addOnChainTrade,
        onPressureUpdate: updateDashboardUI,
        onConnectionChange: setConnectionStatus,
        onActivityUpdate: handleActivity,
        onBootstrapComplete: showTradesReady,
    });

    void import('./scene.js').then((loadedScene) => {
        sceneModule = loadedScene;
        sceneModule.initScene({
            onKillEvent: addRealKillEvent,
            onReclaimEvent: addKingReclaimEvent,
            onInspectUnit: showUnitInspector,
            onVisibleUnitsChange: updateVisibleCoverage,
            onRendererStatus: setRendererStatus,
        });
        flushPendingSceneTrades();
        sceneModule.startGameLoop();
        initPixelCompanion({ setSceneActive: (active) => sceneModule?.setSceneActive(active) });
        bindPageLifecycle(api);
    }).catch((error) => {
        console.error('[scene] Failed to initialize', error);
        setRendererStatus('lost');
    });
}

function bindPageLifecycle(api) {
    const handleVisibility = () => {
        if (window.__ansemCompanionActive) {
            sceneModule?.setSceneActive(false);
            return;
        }
        if (document.hidden) {
            if (!awaySession) {
                awaySession = {
                    startedAt: Date.now(),
                    buys: 0,
                    sells: 0,
                    buySol: 0,
                    sellSol: 0,
                };
            }
            sceneModule?.setSceneActive(false);
            return;
        }

        sceneModule?.setSceneActive(true);
        const session = awaySession;
        if (!session) {
            void api.refresh();
            return;
        }
        Promise.resolve(api.refresh({ catchUpTrades: true })).finally(() => {
            if (awaySession !== session || document.hidden) return;
            showAwaySummary({ ...session, durationMs: Date.now() - session.startedAt });
            awaySession = null;
        });
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', () => sceneModule?.setSceneActive(false));
    window.addEventListener('pageshow', () => {
        sceneModule?.setSceneActive(true);
        void api.refresh();
    });
    if (import.meta.env.DEV) window.__ansemHandleVisibility = handleVisibility;
}

boot();
