export const LOCOMOTION_STATE = Object.freeze({
    IDLE: 'IDLE',
    WALK: 'WALK',
    RUN: 'RUN',
    CHARGE: 'CHARGE',
});

export const PROGRESS_STATE = Object.freeze({
    NORMAL: 'NORMAL',
    SUSPECTED: 'SUSPECTED',
    RECOVERY: 'RECOVERY',
});

export const MOTION_LIMITS = Object.freeze({
    maxDelta: 0.25,
    facingDeadZone: 0.12,
    turnSpeed: 5.4,
    suspectedAfter: 0.55,
    recoveryAfter: 1.05,
    recoveryDuration: 0.72,
    recoveryCooldown: 1.35,
    maxRecoveryAttempts: 3,
    backwardGrace: 0.5,
});

const TAU = Math.PI * 2;
const EPSILON = 1e-6;

export function createMotionState({ x = 0, z = 0, facing = 0, targetIdentity = null, seed = 0 } = {}) {
    const state = {};
    resetMotionState(state, { x, z, facing, targetIdentity, seed });
    return state;
}

export function resetMotionState(state, { x = 0, z = 0, facing = 0, targetIdentity = null, seed = 0 } = {}) {
    state.positionX = finiteOr(x, 0);
    state.positionZ = finiteOr(z, 0);
    state.previousX = state.positionX;
    state.previousZ = state.positionZ;
    state.targetX = state.positionX;
    state.targetZ = state.positionZ;
    state.desiredVelocityX = 0;
    state.desiredVelocityZ = 0;
    state.resolvedVelocityX = 0;
    state.resolvedVelocityZ = 0;
    state.speed = 0;
    state.facing = normalizeAngle(facing);
    state.distanceTravelled = 0;
    state.frameDistance = 0;
    state.locomotionState = LOCOMOTION_STATE.IDLE;
    state.targetIdentity = targetIdentity;
    state.progressState = PROGRESS_STATE.NORMAL;
    state.lowProgressTime = 0;
    state.recoveryTime = 0;
    state.recoveryCooldown = 0;
    state.recoveryAttempts = 0;
    state.maxRecoveryAttemptsObserved = 0;
    state.recoveryDirection = (Math.abs(Math.trunc(seed)) % 2 === 0) ? 1 : -1;
    state.seed = Math.abs(Math.trunc(seed)) || 1;
    state.backwardTime = 0;
    state.backwardViolations = 0;
    state.nonFiniteCorrections = 0;
    state.recoveryLoops = 0;
    state.gaitWhileStatic = 0;
    state.gaitPhase = 0;
    state.lastTurnRate = 0;
    state.intentionalHold = true;
    state.recovering = false;
    state.fallbackHold = false;
    return state;
}

export function clampMotionDelta(delta) {
    return clamp(finiteOr(delta, 0), 0, MOTION_LIMITS.maxDelta);
}

export function beginMotionFrame(state, x, z) {
    const safeX = finiteOr(x, state.positionX);
    const safeZ = finiteOr(z, state.positionZ);
    if (!Number.isFinite(x) || !Number.isFinite(z)) state.nonFiniteCorrections += 1;
    state.previousX = safeX;
    state.previousZ = safeZ;
    state.positionX = safeX;
    state.positionZ = safeZ;
    state.frameDistance = 0;
    return state;
}

export function integrateMotion(state, input = {}, delta = 0) {
    const dt = clampMotionDelta(delta);
    const targetX = finiteOr(input.targetX, state.positionX);
    const targetZ = finiteOr(input.targetZ, state.positionZ);
    const maxSpeed = clamp(finiteOr(input.maxSpeed, 0), 0, 80);
    const maxAcceleration = clamp(finiteOr(input.maxAcceleration, 34), 0, 240);
    const arrivalRadius = clamp(finiteOr(input.arrivalRadius, 0.15), 0, 20);
    const hold = Boolean(input.intentionalHold) || maxSpeed <= EPSILON || dt <= 0;
    let directionX = finiteOr(input.steeringX, targetX - state.positionX);
    let directionZ = finiteOr(input.steeringZ, targetZ - state.positionZ);
    const targetDistance = Math.hypot(targetX - state.positionX, targetZ - state.positionZ);
    const directionLength = Math.hypot(directionX, directionZ);
    const arrival = arrivalRadius > EPSILON
        ? clamp(targetDistance / arrivalRadius, finiteOr(input.arrivalFloor, 0), 1)
        : 1;

    state.targetX = targetX;
    state.targetZ = targetZ;
    state.targetIdentity = input.targetIdentity ?? state.targetIdentity;
    state.intentionalHold = hold;
    state.fallbackHold = false;
    state.recoveryCooldown = Math.max(0, state.recoveryCooldown - dt);

    if (!hold && directionLength > EPSILON) {
        directionX /= directionLength;
        directionZ /= directionLength;
    } else {
        directionX = 0;
        directionZ = 0;
    }

    updateRecoveryState(
        state,
        dt,
        hold ? 0 : maxSpeed * arrival,
        hold || Boolean(input.progressExempt),
    );

    if (state.progressState === PROGRESS_STATE.RECOVERY && !hold) {
        const forwardX = directionX;
        const forwardZ = directionZ;
        const lateralX = -forwardZ * state.recoveryDirection;
        const lateralZ = forwardX * state.recoveryDirection;
        directionX = forwardX * 0.42 + lateralX * 0.91;
        directionZ = forwardZ * 0.42 + lateralZ * 0.91;
        const recoveryLength = Math.hypot(directionX, directionZ) || 1;
        directionX /= recoveryLength;
        directionZ /= recoveryLength;
    }

    let desiredX = directionX * maxSpeed * arrival;
    let desiredZ = directionZ * maxSpeed * arrival;
    if (hold || state.fallbackHold) {
        desiredX = 0;
        desiredZ = 0;
    }

    const separationX = finiteOr(input.separationX, 0);
    const separationZ = finiteOr(input.separationZ, 0);
    const separationLimit = clamp(finiteOr(input.maxSeparationSpeed, 1.8), 0, 8);
    const separationMagnitude = Math.hypot(separationX, separationZ);
    const separationScale = separationMagnitude > separationLimit && separationMagnitude > EPSILON
        ? separationLimit / separationMagnitude
        : 1;
    desiredX += separationX * separationScale;
    desiredZ += separationZ * separationScale;
    const externalX = finiteOr(input.externalVelocityX, 0);
    const externalZ = finiteOr(input.externalVelocityZ, 0);
    const externalLimit = clamp(finiteOr(input.maxExternalSpeed, 0), 0, 20);
    const externalMagnitude = Math.hypot(externalX, externalZ);
    const externalScale = externalMagnitude > externalLimit && externalMagnitude > EPSILON
        ? externalLimit / externalMagnitude
        : 1;
    desiredX += externalX * externalScale;
    desiredZ += externalZ * externalScale;
    const desiredMagnitude = Math.hypot(desiredX, desiredZ);
    const totalSpeedLimit = maxSpeed + separationLimit + externalLimit;
    if (desiredMagnitude > totalSpeedLimit && desiredMagnitude > EPSILON) {
        desiredX = desiredX / desiredMagnitude * totalSpeedLimit;
        desiredZ = desiredZ / desiredMagnitude * totalSpeedLimit;
    }
    state.desiredVelocityX = finiteOr(desiredX, 0);
    state.desiredVelocityZ = finiteOr(desiredZ, 0);

    const previousVelocityX = finiteOr(state.resolvedVelocityX, 0);
    const previousVelocityZ = finiteOr(state.resolvedVelocityZ, 0);
    const velocityDeltaX = state.desiredVelocityX - previousVelocityX;
    const velocityDeltaZ = state.desiredVelocityZ - previousVelocityZ;
    const velocityDelta = Math.hypot(velocityDeltaX, velocityDeltaZ);
    const maxVelocityDelta = maxAcceleration * dt;
    const accelerationScale = velocityDelta > maxVelocityDelta && velocityDelta > EPSILON
        ? maxVelocityDelta / velocityDelta
        : 1;
    state.resolvedVelocityX = previousVelocityX + velocityDeltaX * accelerationScale;
    state.resolvedVelocityZ = previousVelocityZ + velocityDeltaZ * accelerationScale;

    state.positionX += (previousVelocityX + state.resolvedVelocityX) * 0.5 * dt;
    state.positionZ += (previousVelocityZ + state.resolvedVelocityZ) * 0.5 * dt;
    if (!Number.isFinite(state.positionX) || !Number.isFinite(state.positionZ)) {
        state.nonFiniteCorrections += 1;
        state.positionX = state.previousX;
        state.positionZ = state.previousZ;
        state.resolvedVelocityX = 0;
        state.resolvedVelocityZ = 0;
    }
    return state;
}

export function finalizeMotionFrame(state, input = {}, delta = 0) {
    const dt = Math.max(EPSILON, clampMotionDelta(delta));
    const actualX = finiteOr(input.x, state.positionX);
    const actualZ = finiteOr(input.z, state.positionZ);
    if (!Number.isFinite(input.x) || !Number.isFinite(input.z)) state.nonFiniteCorrections += 1;
    const dx = actualX - state.previousX;
    const dz = actualZ - state.previousZ;
    const distance = Math.hypot(dx, dz);
    const actualVelocityX = dx / dt;
    const actualVelocityZ = dz / dt;
    const measuredSpeed = distance / dt;
    const speedLimit = clamp(finiteOr(input.speedLimit, 80), 0.1, 120);
    const velocityScale = measuredSpeed > speedLimit ? speedLimit / measuredSpeed : 1;
    state.positionX = actualX;
    state.positionZ = actualZ;
    state.frameDistance = distance;
    state.distanceTravelled += distance;
    state.resolvedVelocityX = finiteOr(actualVelocityX * velocityScale, 0);
    state.resolvedVelocityZ = finiteOr(actualVelocityZ * velocityScale, 0);
    state.speed = Math.hypot(state.resolvedVelocityX, state.resolvedVelocityZ);

    const explicitFacingX = finiteOr(input.explicitFacingX, 0);
    const explicitFacingZ = finiteOr(input.explicitFacingZ, 0);
    const explicitFacingLength = Math.hypot(explicitFacingX, explicitFacingZ);
    let desiredFacing = state.facing;
    if (state.speed > MOTION_LIMITS.facingDeadZone) {
        desiredFacing = Math.atan2(-state.resolvedVelocityZ, state.resolvedVelocityX);
    } else if (Boolean(input.allowExplicitFacing) && explicitFacingLength > EPSILON) {
        desiredFacing = Math.atan2(-explicitFacingZ, explicitFacingX);
    }
    const priorFacing = state.facing;
    const turnSpeed = clamp(finiteOr(input.turnSpeed, MOTION_LIMITS.turnSpeed), 0, 20);
    state.facing = turnTowards(state.facing, desiredFacing, turnSpeed * dt);
    state.lastTurnRate = Math.abs(shortestAngleDelta(priorFacing, state.facing)) / dt;

    const charge = Boolean(input.charge);
    state.locomotionState = deriveLocomotionState(state.locomotionState, state.speed, charge);
    if (state.speed > MOTION_LIMITS.facingDeadZone) {
        const cadence = state.locomotionState === LOCOMOTION_STATE.CHARGE ? 3.15
            : state.locomotionState === LOCOMOTION_STATE.RUN ? 2.65 : 2.05;
        state.gaitPhase = normalizePhase(state.gaitPhase + distance * cadence);
    } else if (state.speed <= MOTION_LIMITS.facingDeadZone
        && state.locomotionState !== LOCOMOTION_STATE.IDLE) {
        state.gaitWhileStatic += 1;
    }

    const facingX = Math.cos(state.facing);
    const facingZ = -Math.sin(state.facing);
    const alignment = state.speed > MOTION_LIMITS.facingDeadZone
        ? (state.resolvedVelocityX * facingX + state.resolvedVelocityZ * facingZ) / state.speed
        : 1;
    if (alignment < -0.28 && !charge) {
        state.backwardTime += dt;
        if (state.backwardTime >= MOTION_LIMITS.backwardGrace) {
            state.backwardViolations += 1;
            state.backwardTime = 0;
        }
    } else {
        state.backwardTime = Math.max(0, state.backwardTime - dt * 2);
    }

    const requestedSpeed = Math.hypot(state.desiredVelocityX, state.desiredVelocityZ);
    const progressExempt = Boolean(input.progressExempt)
        || state.intentionalHold
        || charge;
    if (!progressExempt && requestedSpeed > 0.45) {
        const expected = requestedSpeed * dt;
        const progressRatio = expected > EPSILON ? distance / expected : 1;
        state.lowProgressTime = progressRatio < 0.12
            ? state.lowProgressTime + dt
            : Math.max(0, state.lowProgressTime - dt * 2.4);
    } else {
        state.lowProgressTime = 0;
        if (state.progressState !== PROGRESS_STATE.RECOVERY) state.progressState = PROGRESS_STATE.NORMAL;
    }
    return state;
}

export function syncMotionPosition(state, x, z, facing = state.facing) {
    const safeX = finiteOr(x, state.positionX);
    const safeZ = finiteOr(z, state.positionZ);
    state.positionX = safeX;
    state.positionZ = safeZ;
    state.previousX = safeX;
    state.previousZ = safeZ;
    state.resolvedVelocityX = 0;
    state.resolvedVelocityZ = 0;
    state.desiredVelocityX = 0;
    state.desiredVelocityZ = 0;
    state.speed = 0;
    state.frameDistance = 0;
    state.gaitPhase = 0;
    state.facing = normalizeAngle(facing);
    state.lowProgressTime = 0;
    state.progressState = PROGRESS_STATE.NORMAL;
    state.recoveryTime = 0;
    state.recovering = false;
    state.intentionalHold = true;
    state.locomotionState = LOCOMOTION_STATE.IDLE;
    return state;
}

export function sampleQuadrupedGait(state, output = {}) {
    const phase = finiteOr(state.gaitPhase, 0);
    const locomotion = state.locomotionState;
    let amplitude = 0;
    let bodyBob;
    let bodyPitch;
    if (locomotion === LOCOMOTION_STATE.WALK) {
        amplitude = 0.48;
        output.frontLeft = Math.sin(phase) * amplitude;
        output.frontRight = Math.sin(phase + Math.PI) * amplitude;
        output.hindLeft = Math.sin(phase + Math.PI * 1.5) * amplitude;
        output.hindRight = Math.sin(phase + Math.PI * 0.5) * amplitude;
        bodyBob = Math.abs(Math.sin(phase * 2)) * 0.055;
        bodyPitch = Math.sin(phase) * 0.025;
    } else if (locomotion === LOCOMOTION_STATE.RUN || locomotion === LOCOMOTION_STATE.CHARGE) {
        amplitude = locomotion === LOCOMOTION_STATE.CHARGE ? 0.78 : 0.7;
        output.frontLeft = Math.sin(phase) * amplitude;
        output.frontRight = Math.sin(phase + Math.PI) * amplitude;
        output.hindLeft = Math.sin(phase + Math.PI) * amplitude;
        output.hindRight = Math.sin(phase) * amplitude;
        bodyBob = Math.abs(Math.sin(phase)) * 0.11;
        bodyPitch = Math.sin(phase * 2) * 0.045;
    } else {
        output.frontLeft = 0;
        output.frontRight = 0;
        output.hindLeft = 0;
        output.hindRight = 0;
        bodyBob = 0;
        bodyPitch = 0;
    }
    output.bodyBob = bodyBob;
    output.bodyPitch = bodyPitch;
    output.amplitude = amplitude;
    output.active = amplitude > 0;
    return output;
}

export function deriveLocomotionState(previous, speed, charge = false) {
    if (charge) return LOCOMOTION_STATE.CHARGE;
    const value = Math.max(0, finiteOr(speed, 0));
    if (previous === LOCOMOTION_STATE.RUN || previous === LOCOMOTION_STATE.CHARGE) {
        if (value < 0.12) return LOCOMOTION_STATE.IDLE;
        return value < 4.35 ? LOCOMOTION_STATE.WALK : LOCOMOTION_STATE.RUN;
    }
    if (previous === LOCOMOTION_STATE.WALK) {
        if (value < 0.12) return LOCOMOTION_STATE.IDLE;
        return value > 5.25 ? LOCOMOTION_STATE.RUN : LOCOMOTION_STATE.WALK;
    }
    if (value > 5.25) return LOCOMOTION_STATE.RUN;
    if (value > 0.28) return LOCOMOTION_STATE.WALK;
    return LOCOMOTION_STATE.IDLE;
}

export function shortestAngleDelta(from, to) {
    return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function turnTowards(current, target, maxStep) {
    const delta = shortestAngleDelta(current, target);
    return normalizeAngle(current + clamp(delta, -Math.max(0, maxStep), Math.max(0, maxStep)));
}

function updateRecoveryState(state, dt, requestedSpeed, progressExempt) {
    if (state.progressState === PROGRESS_STATE.RECOVERY) {
        state.recoveryTime += dt;
        state.recovering = true;
        if (state.recoveryTime >= MOTION_LIMITS.recoveryDuration) {
            state.progressState = PROGRESS_STATE.NORMAL;
            state.recoveryTime = 0;
            state.recoveryCooldown = MOTION_LIMITS.recoveryCooldown;
            state.lowProgressTime = 0;
            state.recovering = false;
        }
        return;
    }
    state.recovering = false;
    if (progressExempt || requestedSpeed <= 0.45) {
        state.progressState = PROGRESS_STATE.NORMAL;
        return;
    }
    if (state.lowProgressTime >= MOTION_LIMITS.recoveryAfter && state.recoveryCooldown <= 0) {
        if (state.recoveryAttempts >= MOTION_LIMITS.maxRecoveryAttempts) {
            state.fallbackHold = true;
            state.recoveryLoops += 1;
            state.recoveryAttempts = 0;
            state.recoveryCooldown = MOTION_LIMITS.recoveryCooldown * 2;
            state.lowProgressTime = 0;
            state.progressState = PROGRESS_STATE.NORMAL;
            return;
        }
        state.progressState = PROGRESS_STATE.RECOVERY;
        state.recoveryTime = 0;
        state.recoveryAttempts += 1;
        state.maxRecoveryAttemptsObserved = Math.max(state.maxRecoveryAttemptsObserved, state.recoveryAttempts);
        state.recoveryDirection = ((state.seed + state.recoveryAttempts) % 2 === 0) ? 1 : -1;
        state.lowProgressTime = 0;
    } else if (state.lowProgressTime >= MOTION_LIMITS.suspectedAfter) {
        state.progressState = PROGRESS_STATE.SUSPECTED;
    } else {
        state.progressState = PROGRESS_STATE.NORMAL;
        if (state.lowProgressTime <= EPSILON && state.recoveryCooldown <= 0) state.recoveryAttempts = 0;
    }
}

function normalizeAngle(value) {
    return Math.atan2(Math.sin(finiteOr(value, 0)), Math.cos(finiteOr(value, 0)));
}

function normalizePhase(value) {
    const phase = finiteOr(value, 0) % TAU;
    return phase < 0 ? phase + TAU : phase;
}

function finiteOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
