import { CONFIG } from './config.js';
import { initAPI, startHoldersPolling } from './api.js';
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
    hideHoldersIfNoApiKey,
    updateHolders,
} from './ui.js';
import {
    initScene,
    startGameLoop,
    setCameraMode,
    spawnUnit,
    setFrontlineColor,
    triggerWhaleBattleEffect,
} from './scene.js';

function handleTrade(trade, meta) {
    addOnChainTrade(trade);

    if (trade.usdValue >= CONFIG.WHALE_TRADE_THRESHOLD && !meta.bootstrap) {
        const type = trade.isBuy ? 'bull' : 'bear';
        spawnUnit(type, false, true);
        addWhaleSpawnEvent(type, trade.usdValue);
        triggerWhaleBattleEffect(trade.isBuy);
        updateDashboardUI();
    }
}

function boot() {
    hideHoldersIfNoApiKey();

    initUI({ setFrontlineColor });
    bindCameraControls(setCameraMode);
    showTradesWaiting();

    window.__ansemToggleAudioUI = setAudioButton;

    initScene({ onKillEvent: addRealKillEvent });
    startGameLoop();

    initAPI({
        onMarketUpdate: updateMarketUI,
        onTrade: handleTrade,
        onConnectionChange: setConnectionStatus,
    });

    startHoldersPolling(updateHolders);
}

boot();
