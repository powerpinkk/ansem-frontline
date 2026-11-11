import { createBattleRuntime, FIXED_DT } from './battle-runtime.js';

// The sole numerical owner. The main thread owns acquisition and drawing only.
let runtime = null, state = null, epoch = 0, numericalNow = 0;
let active = true, paused = false, awaitingFrame = false, last = null, accumulator = 0;
let commander = null, champion = null;
function publish() {
    if (!runtime || awaitingFrame || !active || paused) return;
    awaitingFrame = true;
    self.postMessage({ type: 'frame', epoch, frame: runtime.frame(), diagnostics: runtime.diagnostics() });
}
self.onmessage = ({ data }) => {
    if (data.type === 'reset') {
        runtime?.dispose(); state = data.state; epoch = data.epoch; numericalNow = data.now;
        last = null; accumulator = 0; awaitingFrame = false;
        runtime = createBattleRuntime({ state, mint: data.mint, epoch, maxPerSide: data.maxPerSide });
        publish(); return;
    }
    if (data.epoch !== epoch) return;
    if (data.type === 'facts') Object.assign(state, data.state);
    if (data.type === 'admit') runtime?.admit(data.trade, data.now);
    if (data.type === 'remove') runtime?.removeTrade(data.id);
    if (data.type === 'roles') { commander = data.commander; champion = data.champion; }
    if (data.type === 'pause') { paused = data.value; last = null; accumulator = 0; }
    if (data.type === 'active') { active = data.value; last = null; accumulator = 0; }
    if (data.type === 'ack') awaitingFrame = false;
};
const timer = setInterval(() => {
    const time = performance.now();
    const elapsed = last === null ? 0 : Math.min(.25, (time - last) / 1000); last = time;
    if (!runtime || !active || paused) return;
    accumulator += elapsed;
    while (accumulator >= FIXED_DT) {
        runtime.setRoles(commander, champion);
        numericalNow += FIXED_DT * 1000; runtime.step(numericalNow);
        accumulator -= FIXED_DT;
    }
    publish();
}, 1000 / 60);
self.addEventListener('message', ({ data }) => {
    if (data.type === 'dispose') { clearInterval(timer); runtime?.dispose(); self.close(); }
});
