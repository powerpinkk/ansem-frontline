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
} from './scene.js';

let lastBullSwarmAt = 0;

function handleTrade(trade, meta) {
    addOnChainTrade(trade);
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

    initScene({ onKillEvent: addRealKillEvent, onReclaimEvent: addKingReclaimEvent });
    startGameLoop();

    initAPI({
        onMarketUpdate: updateMarketUI,
        onTrade: handleTrade,
        onPressureUpdate: updateDashboardUI,
        onConnectionChange: setConnectionStatus,
        onActivityUpdate: handleActivity,
    });
}

boot();
