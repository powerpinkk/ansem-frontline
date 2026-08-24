import { initAPI } from './api.js';
import {
    initUI,
    bindCameraControls,
    setConnectionStatus,
    updateMarketUI,
    updateDashboardUI,
    addOnChainTrade,
    addWhaleSpawnEvent,
    addRealKillEvent,
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
} from './scene.js';

function handleTrade(trade, meta) {
    addOnChainTrade(trade);
    const type = trade.isBuy ? 'bull' : 'bear';
    spawnUnit(type, meta.bootstrap, trade.isWhale, trade);
    if (trade.isWhale) addWhaleSpawnEvent(type, trade.solValue, trade.usdValue);
    applyTradeImpulse(trade.isBuy, trade.solValue, trade.isWhale);
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
