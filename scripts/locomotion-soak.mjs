/* global console */
import { performance } from 'node:perf_hooks';
import {
    LOCOMOTION_STATE,
    beginMotionFrame,
    createMotionState,
    finalizeMotionFrame,
    integrateMotion,
    resetMotionState,
    syncMotionPosition,
} from '../js/locomotion.js';

const agents = Array.from({ length: 260 }, (_, index) => createMotionState({
    x: index % 2 ? -20 : 20,
    z: -30 + (index % 40) * 1.5,
    facing: index % 2 ? 0 : Math.PI,
    seed: index + 1,
}));
const input = agents.map(() => ({}));
const output = agents.map(() => ({}));
const frames = 36_000;
const delta = 1 / 60;
const startedAt = performance.now();
let maximumStepMs = 0;
let firstHalfStepMs = 0;
let secondHalfStepMs = 0;
let reversals = 0;
let rebases = 0;
let poolResets = 0;

for (let frame = 0; frame < frames; frame++) {
    const frameStartedAt = performance.now();
    const direction = Math.floor(frame / 900) % 2 === 0 ? 1 : -1;
    if (frame > 0 && frame % 900 === 0) reversals += 1;
    const backgroundDelta = frame % 7_200 === 7_199 ? 4 : delta;
    for (let index = 0; index < agents.length; index++) {
        const motion = agents[index];
        if (frame > 0 && frame % 6_000 === 0 && index % 13 === 0) {
            syncMotionPosition(motion, motion.positionX - 200, motion.positionZ + 100, motion.facing);
            rebases += 1;
        }
        if (frame > 0 && frame % 8_000 === 0 && index % 17 === 0) {
            resetMotionState(motion, { x: -direction * 20, z: motion.positionZ, seed: index + frame });
            poolResets += 1;
        }
        beginMotionFrame(motion, motion.positionX, motion.positionZ);
        const plan = input[index];
        plan.targetX = direction * 28;
        plan.targetZ = -30 + (index % 40) * 1.5;
        plan.maxSpeed = 6 + (index % 4);
        plan.maxAcceleration = 28;
        plan.arrivalRadius = 1.5;
        plan.arrivalFloor = 0.1;
        plan.intentionalHold = frame % 1_200 < 90 && index % 9 === 0;
        plan.progressExempt = plan.intentionalHold;
        plan.separationX = 0;
        plan.separationZ = ((index % 3) - 1) * 0.35;
        plan.maxSeparationSpeed = 1.2;
        integrateMotion(motion, plan, backgroundDelta);
        const resolved = output[index];
        resolved.x = index % 31 === 0 && frame % 1_800 < 100
            ? motion.previousX
            : motion.positionX;
        resolved.z = index % 31 === 0 && frame % 1_800 < 100
            ? motion.previousZ
            : motion.positionZ;
        resolved.speedLimit = 12;
        resolved.turnSpeed = 5.4;
        resolved.progressExempt = plan.progressExempt;
        finalizeMotionFrame(motion, resolved, backgroundDelta);
        if (!Number.isFinite(motion.positionX + motion.positionZ + motion.speed + motion.facing)) {
            throw new Error(`non-finite motion at frame ${frame}, agent ${index}`);
        }
        if (motion.maxRecoveryAttemptsObserved > 3) throw new Error('recovery attempt budget exceeded');
        if (motion.gaitWhileStatic > 0) throw new Error('gait advanced while static');
    }
    const frameMs = performance.now() - frameStartedAt;
    maximumStepMs = Math.max(maximumStepMs, frameMs);
    if (frame < frames / 2) firstHalfStepMs += frameMs;
    else secondHalfStepMs += frameMs;
}

const elapsedMs = performance.now() - startedAt;
const moving = agents.filter((motion) => motion.locomotionState !== LOCOMOTION_STATE.IDLE).length;
const backward = agents.reduce((sum, motion) => sum + motion.backwardViolations, 0);
const nonFinite = agents.reduce((sum, motion) => sum + motion.nonFiniteCorrections, 0);
const recoveryLoops = agents.reduce((sum, motion) => sum + motion.recoveryLoops, 0);
const firstHalfAverageMs = firstHalfStepMs / (frames / 2);
const secondHalfAverageMs = secondHalfStepMs / (frames / 2);
if (!moving) throw new Error('soak ended without moving agents');
if (backward || nonFinite || recoveryLoops) {
    throw new Error(`motion assertions failed: backward=${backward}, nonFinite=${nonFinite}, recoveryLoops=${recoveryLoops}`);
}
if (secondHalfAverageMs > firstHalfAverageMs * 1.35 + 0.01) {
    throw new Error(`progressive slowdown: first=${firstHalfAverageMs}, second=${secondHalfAverageMs}`);
}

console.log(JSON.stringify({
    simulatedSeconds: frames / 60,
    agents: agents.length,
    updates: frames * agents.length,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    updatesPerMs: Number((frames * agents.length / elapsedMs).toFixed(2)),
    maximumStepMs: Number(maximumStepMs.toFixed(2)),
    firstHalfAverageMs: Number(firstHalfAverageMs.toFixed(4)),
    secondHalfAverageMs: Number(secondHalfAverageMs.toFixed(4)),
    reversals,
    rebases,
    poolResets,
    moving,
    backward,
    nonFinite,
    recoveryLoops,
}));
