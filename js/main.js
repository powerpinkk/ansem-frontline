import { initAPI } from './api.js';
import { evaluateBuySwarm } from './market.js';
import { activateTokenRuntime, createTokenRuntime, state } from './state.js';
import { initPixelCompanion } from './companion.js';
import { createTokenController, TOKEN_UI_STATUS } from './token-controller.js';
import { resolveTokenInput } from './token-loader.js';
import { buildTokenUrl, historyPath, readTokenRoute } from './token-navigation.js';
import { DEFAULT_TOKEN_CONTEXT } from './token-presets.js';
import { initTokenUI } from './token-ui.js';
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
    resetFrontlineUI,
} from './ui.js';

let lastBullSwarmAt = 0;
let awaySession = null;
let sceneReady = false;
let sceneModule = null;
let companionController = null;
let currentSession = null;
let tokenController = null;
let tokenUI = null;
const pendingSceneTrades = [];
const runtimeSessions = [];

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

function mountRuntime(resolution) {
    const runtime = createTokenRuntime(resolution.context);
    const session = {
        runtime,
        api: null,
        active: true,
        get context() { return runtime.context; },
        destroy() {
            if (!session.active) return;
            session.active = false;
            session.api?.destroy();
            if (currentSession === session) currentSession = null;
        },
    };
    activateTokenRuntime(runtime);
    currentSession = session;
    runtimeSessions.push(session);
    if (runtimeSessions.length > 24) runtimeSessions.shift();
    pendingSceneTrades.length = 0;
    lastBullSwarmAt = 0;
    awaySession = null;
    resetFrontlineUI();
    sceneModule?.resetTokenPresentation();
    companionController?.setTokenContext(runtime.context);

    const active = (callback) => (...args) => {
        if (session.active && currentSession === session) callback(...args);
    };
    session.api = initAPI({
        onMarketUpdate: active((market) => {
            updateMarketUI(market);
            updateBattleLogSnapshot(market);
        }),
        onTrade: active(handleTrade),
        onHistoricalTrade: active(addOnChainTrade),
        onPressureUpdate: active(updateDashboardUI),
        onConnectionChange: active((status) => {
            setConnectionStatus(status);
            tokenUI?.setConnection(status);
        }),
        onActivityUpdate: active(updateActivityUI),
        onBootstrapComplete: active(showTradesReady),
        onTokenContextChange: active((context) => {
            tokenUI?.renderContext(context);
            companionController?.setTokenContext(context);
        }),
    }, { runtime, initialMarket: resolution.market });
    companionController?.setTokenContext(runtime.context);
    return session;
}

function updateRoute({ mint, history }) {
    const url = buildTokenUrl(window.location.href, mint, DEFAULT_TOKEN_CONTEXT.identity.mint);
    const nextPath = historyPath(url);
    if (nextPath === historyPath(window.location.href)) return;
    const method = history === 'replace' ? 'replaceState' : 'pushState';
    window.history[method]({ token: mint }, '', nextPath);
}

function handleControllerState(nextState) {
    tokenUI?.setState(nextState);
    if (!nextState.context && nextState.status !== TOKEN_UI_STATUS.RESOLVING) {
        resetFrontlineUI();
        sceneModule?.resetTokenPresentation();
        tokenUI?.setConnection('offline');
    }
}

function loadRoute() {
    const route = readTokenRoute(window.location.href);
    if (route.kind === 'default') return tokenController.selectDefault({ history: 'none' });
    return tokenController.select(route.mint, {
        history: 'none',
        clearOnFailure: true,
    });
}

function boot() {
    initUI({ setFrontlineColor: (color) => sceneModule?.setFrontlineColor(color) });
    bindCameraControls((mode) => sceneModule?.setCameraMode(mode));
    showBattleLogSyncing();
    showTradesWaiting();
    window.__ansemToggleAudioUI = setAudioButton;

    tokenUI = initTokenUI({
        onSubmit: (mint) => void tokenController.select(mint, { history: 'push' }),
        onDefault: () => void tokenController.selectDefault({ history: 'push' }),
        getCurrentUrl: () => window.location.href,
    });
    tokenController = createTokenController({
        defaultContext: DEFAULT_TOKEN_CONTEXT,
        resolveToken: resolveTokenInput,
        mountRuntime,
        onState: handleControllerState,
        onRoute: updateRoute,
    });
    bindPageLifecycle();
    window.addEventListener('popstate', () => void loadRoute());
    window.addEventListener('beforeunload', () => tokenController.destroy(), { once: true });
    void loadRoute();

    void import('./scene.js').then((loadedScene) => {
        sceneModule = loadedScene;
        sceneModule.initScene({
            onKillEvent: addRealKillEvent,
            onReclaimEvent: addKingReclaimEvent,
            onInspectUnit: showUnitInspector,
            onVisibleUnitsChange: updateVisibleCoverage,
            onRendererStatus: setRendererStatus,
        });
        if (!currentSession) sceneModule.resetTokenPresentation();
        flushPendingSceneTrades();
        sceneModule.startGameLoop();
        if (import.meta.env.DEV) window.__ansemHandleVisibility = handleVisibility;
        companionController = initPixelCompanion({
            setSceneActive: (active) => sceneModule?.setSceneActive(active),
            tokenContext: currentSession?.context || DEFAULT_TOKEN_CONTEXT,
        });
        if (currentSession) companionController?.setTokenContext(currentSession.context);
    }).catch((error) => {
        console.error('[scene] Failed to initialize', error);
        setRendererStatus('lost');
    });

    if (import.meta.env.DEV || new URLSearchParams(window.location.search).has('diagnostics')) {
        window.__ansemSelectToken = (mint) => tokenController.select(String(mint), { history: 'push' });
        window.__ansemTokenDiagnostics = () => ({
            ...tokenController.getDiagnostics(),
            url: window.location.href,
            sessions: runtimeSessions.map((session) => ({
                mint: session.context.identity.mint,
                active: session.active,
                api: session.api?.getDiagnostics() || null,
            })),
        });
    }
}

function handleVisibility() {
    if (window.__ansemCompanionActive) {
        sceneModule?.setSceneActive(false);
        return;
    }
    if (document.hidden) {
        if (!awaySession) {
            awaySession = { startedAt: Date.now(), buys: 0, sells: 0, buySol: 0, sellSol: 0 };
        }
        sceneModule?.setSceneActive(false);
        return;
    }

    sceneModule?.setSceneActive(true);
    const session = awaySession;
    const api = currentSession?.api;
    if (!session) {
        void api?.refresh();
        return;
    }
    Promise.resolve(api?.refresh({ catchUpTrades: true })).finally(() => {
        if (awaySession !== session || document.hidden) return;
        showAwaySummary({ ...session, durationMs: Date.now() - session.startedAt });
        awaySession = null;
    });
}

function bindPageLifecycle() {
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', (event) => {
        sceneModule?.setSceneActive(false);
        if (!event.persisted) tokenController?.destroy();
    });
    window.addEventListener('pageshow', () => {
        sceneModule?.setSceneActive(true);
        void currentSession?.api?.refresh();
    });
}

boot();
