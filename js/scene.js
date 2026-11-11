import { state, getActiveTokenRuntime } from './state.js';
import { CONFIG } from './config.js';
import { PRESENTATION_VERSION } from './illustrated/presentation.js';
import { createIllustratedRenderer } from './illustrated/renderer.js';

let callbacks = {}, renderer = null, runtime = null, previous = null, frame = null;
let epoch = 0, raf = 0, worker = null, factsTimer = 0, numericalNow = Date.now(), active = true, paused = false, disposed = false;
let commander = null, champion = null, terrain = null, theme = null, audio = null, audioEnabled = false;
const lifetime = new AbortController();
let supportUntil = 0, loadingRenderer = false, frameReceivedAt = 0;
let lost = false, reduced = false, reducedQuery = null, lastPublished = '';
export async function initScene(next = {}) {
    callbacks = next;
    worker = new Worker(new URL('./battle-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
        if (disposed || data.epoch !== epoch || data.type !== 'frame') return;
        worker.postMessage({ type: 'ack', epoch });
        if (paused || !active) return;
        previous = frame; frame = data.frame; frameReceivedAt = performance.now(); runtime = data.diagnostics; numericalNow = Date.now();
        publishCounts(); updateTerrain();
        if (audioEnabled && audio && frame.events.some(e => e.resolvedTick === frame.tick)) {
            const oscillator = audio.createOscillator(), gain = audio.createGain(); gain.gain.value = .008; oscillator.frequency.value = 140;
            oscillator.connect(gain).connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + .04);
        }
    };
    worker.onerror = () => callbacks.onRendererStatus?.('lost');
    resetTokenPresentation();
    const host = document.getElementById('canvas-container');
    host.tabIndex = 0;
    host.setAttribute('aria-label', 'Battlefield. Drag to pan; plus and minus to zoom; Home to center; Space to pause.');
    reducedQuery = matchMedia('(prefers-reduced-motion: reduce)'); reduced = reducedQuery.matches;
    reducedQuery.addEventListener('change', e => { reduced = e.matches; renderer?.reduced(reduced); }, { signal: lifetime.signal });
    bindControls(host);
    startGameLoop();
    await loadRenderer(host);
}
async function loadRenderer(host) {
    if (loadingRenderer) return; loadingRenderer = true;
    const retryButton = document.getElementById('battle-retry'); if (retryButton) retryButton.disabled = true;
    try {
        renderer = await createIllustratedRenderer(host, { signal: lifetime.signal, art: 'rig', profile: import.meta.env.MODE === 'e2e' ? new URLSearchParams(location.search).get('renderer') || 'auto' : 'auto' });
        if (disposed) { renderer.dispose(); return; }
        renderer.reduced(reduced); applyThemePresentation(theme);
        const canvas = host.querySelector('canvas');
        canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; callbacks.onRendererStatus?.('lost'); }, { signal: lifetime.signal });
        canvas.addEventListener('webglcontextrestored', () => { lost = false; callbacks.onRendererStatus?.('ready'); }, { signal: lifetime.signal });
        callbacks.onRendererStatus?.('ready');
    } catch (error) {
        if (!disposed) { callbacks.onRendererStatus?.('lost'); console.error('[battlefield] Renderer unavailable', error); }
    } finally { loadingRenderer = false; if (retryButton) retryButton.disabled = false; }
}
function facts() {
    return { mode: state.mode, liveTrades: state.liveTrades, buySol60s: state.buySol60s, sellSol60s: state.sellSol60s, activity5m: state.activity5m, activity1h: state.activity1h, momentum: state.momentum };
}
function syncFacts() { worker?.postMessage({ type: 'facts', epoch, state: facts() }); worker?.postMessage({ type: 'roles', epoch, commander, champion }); }
export function resetTokenPresentation() {
    epoch++; supportUntil = 0; numericalNow = Date.now(); previous = null; lastPublished = '';
    const token = getActiveTokenRuntime();
    runtime = { mint: token.context.identity.mint, epoch, tick: 0, actors: 0, disposed: false };
    frame = { schema: PRESENTATION_VERSION, mint: token.context.identity.mint, epoch, tick: 0, seconds: 0, actors: [], events: [] };
    worker?.postMessage({ type: 'reset', epoch, mint: token.context.identity.mint, now: numericalNow, state: facts(),
        maxPerSide: /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || navigator.hardwareConcurrency <= 4 ? CONFIG.MAX_BATTLEFIELD_FORCES_CONSTRAINED : CONFIG.MAX_BATTLEFIELD_FORCES_PER_SIDE });
    callbacks.onInspectUnit?.(null);
}
export function startGameLoop() {
    if (disposed) return;
    if (!factsTimer) factsTimer = window.setInterval(syncFacts, 500);
    if (!raf) raf = requestAnimationFrame(loop);
}
function loop() {
    raf = 0;
    if (disposed) return;
    if (active && renderer && !lost) {
        try { renderer.render(frame, { previous, fraction: paused || reduced ? 1 : Math.min(1, (performance.now() - frameReceivedAt) / Math.max(16.67, (frame.seconds - (previous?.seconds || 0)) * 1000)) }); }
        catch (error) { lost = true; callbacks.onRendererStatus?.('lost'); console.error('[battlefield] Frame failed', error); }
    }
    if (active) raf = requestAnimationFrame(loop);
}
function publishCounts() {
    const count = side => frame.actors.filter(a => a.side === side).length;
    const verified = side => frame.actors.filter(a => a.side === side && a.trade).length;
    const c = { bull: count(0), bear: count(1), total: frame.actors.length,
        verifiedBull: verified(0), verifiedBear: verified(1), verifiedTotal: verified(0) + verified(1),
        forceBull: count(0) - verified(0), forceBear: count(1) - verified(1) };
    state.visibleCombatants = c;
    const key = JSON.stringify(c);
    if (key !== lastPublished) { lastPublished = key; callbacks.onVisibleUnitsChange?.(c); }
}
function updateTerrain() {
    const snapshot = terrain?.advance?.(numericalNow, document.getElementById('canvas-container').clientWidth);
    frame = { ...frame, terrain: snapshot || null, pressure: { bullPercent: state.momentum }, support: frame.seconds < supportUntil };
    const label = document.getElementById('terrain-2d-label');
    const value = document.getElementById('market-frontier-value');
    const status = document.getElementById('market-frontier-status');
    if (label) label.textContent = state.mode === 'demo' ? 'SYNTHETIC MARKET · COMBAT IS ILLUSTRATIVE' : 'BUY / SELL PRESSURE · COMBAT IS ILLUSTRATIVE';
    if (value) value.textContent = state.mode === 'demo' ? 'DEMO · NO VALUATION AUTHORITY' : snapshot?.hasAuthoritativeFrontier ? snapshot.valuationLabel : snapshot?.indicativeValuationLabel || 'VALUATION UNAVAILABLE';
    if (status) status.textContent = state.mode === 'demo' ? 'SYNTHETIC FIXTURE' : snapshot?.presentationState || 'UNANCHORED_WAITING';
}
function bindControls(host) {
    const options = { signal: lifetime.signal };
    document.getElementById('battle-retry')?.addEventListener('click', () => { if (!disposed) { renderer?.dispose(); renderer = null; lost = false; void loadRenderer(host); } }, options);
    let pointer = null;
    host.addEventListener('pointerdown', e => {
        if (e.target !== host && e.target.tagName !== 'CANVAS') return;
        pointer = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, id: e.pointerId };
        host.setPointerCapture(e.pointerId);
    }, options);
    host.addEventListener('pointermove', e => {
        if (!pointer || e.pointerId !== pointer.id) return;
        renderer?.pan(e.clientX - pointer.x, e.clientY - pointer.y); pointer.x = e.clientX; pointer.y = e.clientY;
    }, options);
    host.addEventListener('pointerup', e => {
        if (!pointer) return;
        if (Math.hypot(e.clientX - pointer.startX, e.clientY - pointer.startY) < 6) callbacks.onInspectUnit?.(renderer?.pick(e.clientX, e.clientY));
        pointer = null;
    }, options);
    host.addEventListener('pointercancel', () => { pointer = null; }, options);
    host.addEventListener('wheel', e => { e.preventDefault(); renderer?.zoomBy(Math.exp(-e.deltaY * .001)); }, { ...options, passive: false });
    host.addEventListener('keydown', e => {
        if (e.target !== host) return;
        const handled = ['+', '=', '-', 'Home', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key);
        if (!handled) return; e.preventDefault();
        if (e.key === '+' || e.key === '=') renderer?.zoomBy(1.15);
        if (e.key === '-') renderer?.zoomBy(1 / 1.15);
        if (e.key === 'Home') renderer?.center();
        if (e.key === ' ') togglePause();
        const pan = { ArrowLeft: [30, 0], ArrowRight: [-30, 0], ArrowUp: [0, 30], ArrowDown: [0, -30] }[e.key];
        if (pan) renderer?.pan(...pan);
    }, options);
    document.getElementById('battle-pause')?.addEventListener('click', togglePause, options);
    document.getElementById('battle-zoom-in')?.addEventListener('click', () => renderer?.zoomBy(1.2), options);
    document.getElementById('battle-zoom-out')?.addEventListener('click', () => renderer?.zoomBy(1 / 1.2), options);
    document.getElementById('battle-reduced')?.addEventListener('change', e => { reduced = e.target.checked; renderer?.reduced(reduced); }, options);
}
function togglePause() {
    paused = !paused; worker?.postMessage({ type: 'pause', epoch, value: paused });
    // Data ingestion continues; resume reconstructs only currently recent swaps.
    if (!paused) { resetTokenPresentation(); for (const t of state.liveTrades) spawnUnit(null, true, t.isWhale, t); }
    const button = document.getElementById('battle-pause');
    if (button) { button.textContent = paused ? 'RESUME' : 'PAUSE'; button.setAttribute('aria-pressed', String(paused)); }
}
export function setSceneActive(value) {
    active = Boolean(value); worker?.postMessage({ type: 'active', epoch, value: active });
    if (!active) { cancelAnimationFrame(raf); raf = 0; clearInterval(factsTimer); factsTimer = 0; }
    else { startGameLoop(); resetTokenPresentation(); for (const t of state.liveTrades) spawnUnit(null, true, t.isWhale, t); }
}
export function spawnUnit(_type, _initial, _large, trade) {
    if (!paused && active) { syncFacts(); worker?.postMessage({ type: 'admit', epoch, trade, now: Date.now() }); }
}
export function removeTradePresentation(id) { worker?.postMessage({ type: 'remove', epoch, id }); callbacks.onInspectUnit?.(null); }
export function setCameraMode(mode) { if (mode === 'auto') renderer?.center(); else renderer?.focusCombat(); window.__frontlineSetCameraUI?.(mode); }
export function applyThemePresentation(value) { theme = value; renderer?.setTheme?.(value); }
export function setUserChampionSnapshot(value) { champion = value; }
export function setCommanderSnapshot(value) { commander = value; }
export function setMarketTerrainController(value) { terrain = value; }
// These former mesh effects no longer own a second combat/market authority.
export function triggerBullSupport() { supportUntil = (frame?.seconds || 0) + 2; }
export function setFrontlineState(value) { document.getElementById('canvas-container')?.setAttribute('data-pressure', value); }
export function toggleAudio() { audioEnabled = !audioEnabled; if (audioEnabled) { audio ||= new AudioContext(); void audio.resume(); } window.__frontlineToggleAudioUI?.(audioEnabled); return audioEnabled; }
export function disposeScene() {
    if (disposed) return; disposed = true; lifetime.abort(); cancelAnimationFrame(raf); raf = 0; clearInterval(factsTimer); factsTimer = 0;
    worker?.postMessage({ type: 'dispose', epoch }); worker?.terminate(); worker = null;
    if (runtime) runtime = { ...runtime, actors: 0, disposed: true }; renderer?.dispose(); void audio?.close();
}
window.__frontlineToggleAudio = toggleAudio;
// Read-only diagnostics are safe in the optimized build; no public mutators.
window.__frontlineSceneDiagnostics = () => structuredClone({ runtime, renderer: renderer?.diagnostics(), epoch, paused, active, lost, reduced, timers: factsTimer ? 1 : 0,
    frame: frame ? { mint: frame.mint, tick: frame.tick, epoch: frame.epoch, actors: frame.actors, events: frame.events } : null });
