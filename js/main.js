import { initAPI } from './api.js';
import { evaluateBuySwarm } from './market.js';
import { state } from './state.js';
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
} from './ui.js';
import {
    initScene,
    startGameLoop,
    setCameraMode,
    spawnUnit,
    setFrontlineColor,
    applyTradeImpulse,
    triggerBullKingSupport,
    handleTerritoryShift,
    setSceneActive,
} from './scene.js';

let lastBullSwarmAt = 0;
let awaySession = null;

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
    spawnUnit(type, meta.bootstrap, trade.isWhale, trade);
    if (trade.isWhale) addWhaleSpawnEvent(type, trade.solValue, trade.usdValue);
    applyTradeImpulse(trade.isBuy, trade.solValue, trade.isWhale);
    handleTerritoryShift(trade, meta);
    const now = Date.now();
    const swarm = evaluateBuySwarm(state.liveTrades, now, lastBullSwarmAt);
    if (!meta.bootstrap && swarm.triggered) {
        lastBullSwarmAt = now;
        triggerBullKingSupport(swarm);
        addBullSwarmEvent(swarm);
    }
    updateDashboardUI();
}

function handleActivity(activity) {
    updateActivityUI(activity);
}

function boot() {
    initUI({ setFrontlineColor });
    bindCameraControls(setCameraMode);
    showTradesWaiting();

    window.__ansemToggleAudioUI = setAudioButton;

    initScene({
        onKillEvent: addRealKillEvent,
        onReclaimEvent: addKingReclaimEvent,
        onInspectUnit: showUnitInspector,
        onVisibleUnitsChange: updateVisibleCoverage,
        onRendererStatus: setRendererStatus,
    });
    startGameLoop();

    const api = initAPI({
        onMarketUpdate: updateMarketUI,
        onTrade: handleTrade,
        onPressureUpdate: updateDashboardUI,
        onConnectionChange: setConnectionStatus,
        onActivityUpdate: handleActivity,
    });
    bindPageLifecycle(api);
}

function bindPageLifecycle(api) {
    const handleVisibility = () => {
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
            setSceneActive(false);
            return;
        }

        setSceneActive(true);
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
    window.addEventListener('pagehide', () => setSceneActive(false));
    window.addEventListener('pageshow', () => {
        setSceneActive(true);
        void api.refresh();
    });
    if (import.meta.env.DEV) window.__ansemHandleVisibility = handleVisibility;
}

boot();
