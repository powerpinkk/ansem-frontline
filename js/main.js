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
    setAudioButton,
    showTradesWaiting,
} from './ui.js';
import {
    initScene,
    startGameLoop,
    setCameraMode,
    spawnUnit,
    setFrontlineColor,
    applyTradeImpulse,
    triggerBullKingSupport,
} from './scene.js';

let lastBullSwarmAt = 0;

function handleTrade(trade, meta) {
    addOnChainTrade(trade);
    const type = trade.isBuy ? 'bull' : 'bear';
    spawnUnit(type, meta.bootstrap, trade.isWhale, trade);
    if (trade.isWhale) addWhaleSpawnEvent(type, trade.solValue, trade.usdValue);
    applyTradeImpulse(trade.isBuy, trade.solValue, trade.isWhale);
    const now = Date.now();
    const swarm = evaluateBuySwarm(state.liveTrades, now, lastBullSwarmAt);
    if (!meta.bootstrap && swarm.triggered) {
        lastBullSwarmAt = now;
        triggerBullKingSupport(swarm);
        addBullSwarmEvent(swarm);
    }
    updateDashboardUI();
}

function boot() {
    initUI({ setFrontlineColor });
    bindCameraControls(setCameraMode);
    showTradesWaiting();

    window.__ansemToggleAudioUI = setAudioButton;

    initScene({ onKillEvent: addRealKillEvent });
    startGameLoop();

    initAPI({
        onMarketUpdate: updateMarketUI,
        onTrade: handleTrade,
        onPressureUpdate: updateDashboardUI,
        onConnectionChange: setConnectionStatus,
    });
}

boot();
