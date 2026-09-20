function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export const COMBAT_STATE = Object.freeze({
    APPROACH: 'APPROACH',
    WINDUP: 'ATTACK_WINDUP',
    ACTIVE: 'ATTACK_ACTIVE',
    IMPACT: 'IMPACT',
    RECOVERY: 'RECOVERY',
    CANCELLED: 'CANCELLED',
});

export const COMBAT_POLICY = Object.freeze({
    maxDelta: 0.25,
    rangeHysteresis: 0.9,
    bear: Object.freeze({
        windup: 0.38,
        active: 0.24,
        activeWindowStart: 0.18,
        activeWindowEnd: 0.78,
        impact: 0.1,
        recovery: 0.56,
    }),
    bull: Object.freeze({
        windup: 0.27,
        active: 0.2,
        activeWindowStart: 0.16,
        activeWindowEnd: 0.74,
        impact: 0.08,
        recovery: 0.46,
    }),
    cancelRecovery: 0.22,
    hitReactionDuration: 0.34,
    impulseDecay: 7.5,
    maxImpulseMagnitude: 12,
    maxImpulseSpeed: 13,
    maxHitRegistrySize: 12,
    presentationLifetimeMs: 4_500,
});

const LEGAL_TRANSITIONS = Object.freeze({
    [COMBAT_STATE.APPROACH]: new Set([COMBAT_STATE.WINDUP]),
    [COMBAT_STATE.WINDUP]: new Set([COMBAT_STATE.ACTIVE, COMBAT_STATE.RECOVERY, COMBAT_STATE.CANCELLED]),
    [COMBAT_STATE.ACTIVE]: new Set([COMBAT_STATE.IMPACT, COMBAT_STATE.RECOVERY, COMBAT_STATE.CANCELLED]),
    [COMBAT_STATE.IMPACT]: new Set([COMBAT_STATE.RECOVERY, COMBAT_STATE.CANCELLED]),
    [COMBAT_STATE.RECOVERY]: new Set([COMBAT_STATE.APPROACH, COMBAT_STATE.CANCELLED]),
    [COMBAT_STATE.CANCELLED]: new Set([COMBAT_STATE.APPROACH]),
});

export function isLegalCombatTransition(from, to) {
    return from === to || Boolean(LEGAL_TRANSITIONS[from]?.has(to));
}

const ELIGIBLE_IMPACT_CAUSES = new Set([
    'TOKEN_NATIVE_MARKET_MOVE',
    'TOKEN_NATIVE_AND_QUOTE_FX_MOVE',
]);

const IMPACT_PRESENTATION = Object.freeze({
    NORMAL: Object.freeze({ intensity: 0.2, majorCharge: false, speed: 0, distance: 0, contacts: 0, impulse: 0, cooldownMs: 0 }),
    STRONG: Object.freeze({ intensity: 0.45, majorCharge: false, speed: 0, distance: 0, contacts: 0, impulse: 0, cooldownMs: 0 }),
    EXTREME: Object.freeze({ intensity: 0.72, majorCharge: true, speed: 23, distance: 28, contacts: 6, impulse: 8, cooldownMs: 3_200 }),
    SHOCK: Object.freeze({ intensity: 1, majorCharge: true, speed: 29, distance: 36, contacts: 10, impulse: 11, cooldownMs: 4_200 }),
});

export function createCombatState({ archetype = 'bull', seed = 1 } = {}) {
    const state = {};
    return resetCombatState(state, { archetype, seed });
}

export function resetCombatState(state, { archetype = state.archetype || 'bull', seed = state.seed || 1 } = {}) {
    state.archetype = archetype === 'bear' ? 'bear' : 'bull';
    state.seed = Math.max(1, Math.abs(Math.trunc(Number(seed) || 1)));
    state.state = COMBAT_STATE.APPROACH;
    state.elapsed = 0;
    state.sequence = 0;
    state.targetIdentity = null;
    state.hitApplied = false;
    state.hitWindowOpen = false;
    state.totalHits = 0;
    state.totalMisses = 0;
    state.cancelled = 0;
    state.invalidTransitions = 0;
    state.impulseX = 0;
    state.impulseZ = 0;
    state.hitReactionTime = 0;
    state.knockbacks = 0;
    state.nonFinite = 0;
    return state;
}

function transitionCombat(state, next) {
    if (state.state === next) return true;
    if (!isLegalCombatTransition(state.state, next)) {
        state.invalidTransitions += 1;
        return false;
    }
    state.state = next;
    state.elapsed = 0;
    if (next === COMBAT_STATE.WINDUP) {
        state.sequence += 1;
        state.hitApplied = false;
        state.hitWindowOpen = false;
    }
    return true;
}

export function cancelCombat(state, countMiss = false) {
    if (state.state === COMBAT_STATE.APPROACH || state.state === COMBAT_STATE.CANCELLED) return false;
    if (countMiss && !state.hitApplied) state.totalMisses += 1;
    if (!transitionCombat(state, COMBAT_STATE.CANCELLED)) return false;
    state.cancelled += 1;
    state.targetIdentity = null;
    state.hitWindowOpen = false;
    return true;
}

/**
 * Advances one deterministic melee state machine. The returned `hit` is an
 * edge event: it can be true only once for one attack sequence.
 */
export function advanceMeleeCombat(state, input = {}, delta = 0, output = {}) {
    const dt = clamp(Number(delta) || 0, 0, COMBAT_POLICY.maxDelta);
    const targetIdentity = input.targetIdentity ?? null;
    const targetValid = Boolean(input.targetValid) && targetIdentity !== null;
    const distance = Number.isFinite(input.distance) ? Math.max(0, input.distance) : Number.POSITIVE_INFINITY;
    const enterRange = Math.max(0, Number(input.enterRange) || 0);
    const leaveRange = Math.max(enterRange, Number(input.leaveRange) || enterRange + COMBAT_POLICY.rangeHysteresis);
    const contactRange = clamp(Number(input.contactRange) || enterRange, 0, leaveRange);
    const canAttack = input.canAttack !== false;
    const policy = COMBAT_POLICY[state.archetype];
    const timingScale = clamp(Number(input.timingScale) || 1, 0.68, 1.4);
    const windupDuration = policy.windup * timingScale;
    const activeDuration = policy.active * timingScale;
    const impactDuration = policy.impact * timingScale;
    const recoveryDuration = policy.recovery * timingScale;
    const result = output;
    result.hit = false;
    result.miss = false;
    result.sequence = state.sequence;
    result.state = state.state;
    result.changed = false;
    result.holdMovement = state.state !== COMBAT_STATE.APPROACH;
    result.faceTarget = false;

    if (state.state !== COMBAT_STATE.APPROACH
        && (!targetValid || state.targetIdentity !== targetIdentity)) {
        result.miss = !state.hitApplied;
        cancelCombat(state, result.miss);
        result.changed = true;
    }

    let remaining = dt;
    let transitions = 0;
    while (transitions < 8) {
        transitions += 1;
        if (state.state === COMBAT_STATE.APPROACH) {
            state.elapsed = 0;
            state.hitWindowOpen = false;
            if (!targetValid || !canAttack || distance > enterRange) break;
            state.targetIdentity = targetIdentity;
            transitionCombat(state, COMBAT_STATE.WINDUP);
            result.changed = true;
            if (remaining <= 0) break;
            continue;
        }

        if (state.state === COMBAT_STATE.CANCELLED) {
            const consume = Math.min(remaining, COMBAT_POLICY.cancelRecovery - state.elapsed);
            state.elapsed += consume;
            remaining -= consume;
            if (state.elapsed + 1e-9 < COMBAT_POLICY.cancelRecovery) break;
            transitionCombat(state, COMBAT_STATE.APPROACH);
            result.changed = true;
            continue;
        }

        if (distance > leaveRange && (state.state === COMBAT_STATE.WINDUP || state.state === COMBAT_STATE.ACTIVE)) {
            if (!state.hitApplied) {
                state.totalMisses += 1;
                result.miss = true;
            }
            transitionCombat(state, COMBAT_STATE.RECOVERY);
            result.changed = true;
            continue;
        }

        const duration = state.state === COMBAT_STATE.WINDUP ? windupDuration
            : state.state === COMBAT_STATE.ACTIVE ? activeDuration
                : state.state === COMBAT_STATE.IMPACT ? impactDuration
                    : recoveryDuration;
        const consume = Math.min(remaining, Math.max(0, duration - state.elapsed));
        const before = state.elapsed;
        state.elapsed += consume;
        remaining -= consume;

        if (state.state === COMBAT_STATE.ACTIVE && !state.hitApplied) {
            const beforeProgress = duration > 0 ? before / duration : 1;
            const progress = duration > 0 ? state.elapsed / duration : 1;
            state.hitWindowOpen = progress >= policy.activeWindowStart && beforeProgress <= policy.activeWindowEnd;
            if (state.hitWindowOpen && targetValid && distance <= contactRange) {
                state.hitApplied = true;
                state.totalHits += 1;
                result.hit = true;
                result.sequence = state.sequence;
                transitionCombat(state, COMBAT_STATE.IMPACT);
                result.changed = true;
                continue;
            }
        }

        if (state.elapsed + 1e-9 < duration) break;
        if (state.state === COMBAT_STATE.WINDUP) transitionCombat(state, COMBAT_STATE.ACTIVE);
        else if (state.state === COMBAT_STATE.ACTIVE) {
            if (!state.hitApplied) {
                state.totalMisses += 1;
                result.miss = true;
            }
            transitionCombat(state, COMBAT_STATE.RECOVERY);
        } else if (state.state === COMBAT_STATE.IMPACT) transitionCombat(state, COMBAT_STATE.RECOVERY);
        else if (state.state === COMBAT_STATE.RECOVERY) {
            state.targetIdentity = null;
            transitionCombat(state, COMBAT_STATE.APPROACH);
        }
        result.changed = true;
        if (remaining <= 0) break;
    }

    result.state = state.state;
    result.holdMovement = state.state !== COMBAT_STATE.APPROACH;
    result.faceTarget = targetValid && (state.state === COMBAT_STATE.WINDUP
        || state.state === COMBAT_STATE.ACTIVE || state.state === COMBAT_STATE.IMPACT);
    return result;
}

export function sampleCombatPose(state, output = {}) {
    const policy = COMBAT_POLICY[state.archetype];
    const duration = state.state === COMBAT_STATE.WINDUP ? policy.windup
        : state.state === COMBAT_STATE.ACTIVE ? policy.active
            : state.state === COMBAT_STATE.IMPACT ? policy.impact
                : state.state === COMBAT_STATE.RECOVERY ? policy.recovery
                    : COMBAT_POLICY.cancelRecovery;
    const progress = duration > 0 ? clamp(state.elapsed / duration, 0, 1) : 0;
    const smooth = progress * progress * (3 - 2 * progress);
    output.blend = 0;
    output.bodyY = 0;
    output.bodyPitch = 0;
    output.bodyRoll = 0;
    output.frontLeft = 0;
    output.frontRight = 0;
    output.headPitch = 0;
    output.recoil = clamp(state.hitReactionTime / COMBAT_POLICY.hitReactionDuration, 0, 1);

    if (state.state === COMBAT_STATE.WINDUP) {
        output.blend = smooth;
        if (state.archetype === 'bear') {
            output.bodyY = 0.78 * smooth;
            output.bodyPitch = -0.42 * smooth;
            output.frontLeft = -0.72 * smooth;
            output.frontRight = -0.58 * smooth;
            output.headPitch = 0.16 * smooth;
        } else {
            output.bodyY = -0.12 * smooth;
            output.bodyPitch = 0.16 * smooth;
        }
    } else if (state.state === COMBAT_STATE.ACTIVE) {
        const strike = Math.sin(progress * Math.PI);
        output.blend = 1;
        if (state.archetype === 'bear') {
            output.bodyY = 0.72 - 0.24 * smooth;
            output.bodyPitch = -0.4 + 0.28 * smooth;
            output.bodyRoll = -0.16 * strike;
            output.frontLeft = -0.72 + strike * 1.42;
            output.frontRight = -0.5 + strike * 0.52;
            output.headPitch = 0.14 - smooth * 0.2;
        } else {
            output.bodyY = 0.08 * strike;
            output.bodyPitch = -0.34 * strike;
        }
    } else if (state.state === COMBAT_STATE.IMPACT) {
        output.blend = 1;
        output.bodyY = state.archetype === 'bear' ? 0.36 : 0.05;
        output.bodyPitch = state.archetype === 'bear' ? -0.08 : -0.22;
        output.frontLeft = state.archetype === 'bear' ? 0.5 : 0;
        output.frontRight = state.archetype === 'bear' ? -0.12 : 0;
    } else if (state.state === COMBAT_STATE.RECOVERY || state.state === COMBAT_STATE.CANCELLED) {
        const settle = 1 - smooth;
        output.blend = settle;
        if (state.archetype === 'bear') {
            output.bodyY = 0.36 * settle;
            output.bodyPitch = -0.18 * settle;
            output.frontLeft = 0.28 * settle;
            output.frontRight = -0.08 * settle;
        } else {
            output.bodyPitch = -0.15 * settle;
        }
    }
    output.bodyPitch += output.recoil * 0.14;
    output.bodyY += output.recoil * 0.08;
    return output;
}

export function combatPresentationMass({ isWhale = false, archetype = 'bull', scale = 1 } = {}) {
    const base = isWhale ? 6.4 : archetype === 'bear' ? 1.35 : 1.2;
    return clamp(base * Math.max(0.25, Number(scale) || 1), 0.3, 12);
}

export function stableContactNormal({ sourceX = 0, sourceZ = 0, targetX = 0, targetZ = 0, seed = 1 } = {}) {
    let x = Number(targetX) - Number(sourceX);
    let z = Number(targetZ) - Number(sourceZ);
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
        x = 0;
        z = 0;
    }
    let length = Math.hypot(x, z);
    if (length < 1e-6) {
        const angle = (Math.abs(Math.trunc(Number(seed) || 1)) % 32) / 32 * Math.PI * 2;
        x = Math.cos(angle);
        z = Math.sin(angle);
        length = 1;
    }
    return { x: x / length, z: z / length };
}

export function resolveCombatImpulse({
    directionX = 0,
    directionZ = 0,
    magnitude = 0,
    attackerMass = 1,
    defenderMass = 1,
    currentX = 0,
    currentZ = 0,
} = {}) {
    const normal = stableContactNormal({ targetX: directionX, targetZ: directionZ });
    const safeMagnitude = clamp(Number(magnitude) || 0, 0, COMBAT_POLICY.maxImpulseMagnitude);
    const massRatio = clamp((Number(attackerMass) || 1) / Math.max(0.3, Number(defenderMass) || 1), 0.18, 3.2);
    let x = (Number(currentX) || 0) + normal.x * safeMagnitude * massRatio;
    let z = (Number(currentZ) || 0) + normal.z * safeMagnitude * massRatio;
    const speed = Math.hypot(x, z);
    if (!Number.isFinite(speed)) return { x: 0, z: 0, speed: 0, clamped: true };
    const scale = speed > COMBAT_POLICY.maxImpulseSpeed ? COMBAT_POLICY.maxImpulseSpeed / speed : 1;
    x *= scale;
    z *= scale;
    return { x, z, speed: Math.hypot(x, z), clamped: scale < 1 };
}

export function applyCombatImpulse(state, impulse) {
    if (!Number.isFinite(impulse?.x) || !Number.isFinite(impulse?.z)) {
        state.nonFinite += 1;
        return false;
    }
    state.impulseX = impulse.x;
    state.impulseZ = impulse.z;
    state.hitReactionTime = COMBAT_POLICY.hitReactionDuration;
    state.knockbacks += 1;
    return true;
}

export function advanceCombatImpulse(state, delta, output = {}) {
    const dt = clamp(Number(delta) || 0, 0, COMBAT_POLICY.maxDelta);
    state.hitReactionTime = Math.max(0, state.hitReactionTime - dt);
    const decay = Math.exp(-COMBAT_POLICY.impulseDecay * dt);
    state.impulseX *= decay;
    state.impulseZ *= decay;
    if (Math.hypot(state.impulseX, state.impulseZ) < 0.025) {
        state.impulseX = 0;
        state.impulseZ = 0;
    }
    if (output === null) return null;
    output.x = state.impulseX;
    output.z = state.impulseZ;
    return output;
}

export function createChargeContactRegistry(limit = COMBAT_POLICY.maxHitRegistrySize) {
    return { hits: new Set(), limit: clamp(Math.trunc(limit) || 1, 1, COMBAT_POLICY.maxHitRegistrySize), rejected: 0 };
}

export function registerChargeContact(registry, identity) {
    if (identity === null || identity === undefined || registry.hits.has(identity)) return false;
    if (registry.hits.size >= registry.limit) {
        registry.rejected += 1;
        return false;
    }
    registry.hits.add(identity);
    return true;
}

export function resetChargeContactRegistry(registry) {
    registry.hits.clear();
    registry.rejected = 0;
    return registry;
}

export function mapMarketImpactToPresentation(impact, context = {}) {
    if (!impact || !ELIGIBLE_IMPACT_CAUSES.has(impact.cause)
        || !['BULLISH', 'BEARISH'].includes(impact.direction)
        || !Number.isFinite(impact.score)
        || !Number.isFinite(impact.verifiedExecutionCount)
        || impact.verifiedExecutionCount < 1
        || context.status !== 'LIVE'
        || !Number.isInteger(context.sourceEpoch)
        || context.initializing === true) return null;
    const policy = IMPACT_PRESENTATION[impact.category];
    if (!policy) return null;
    return Object.freeze({
        id: context.id || `${context.tokenMint || 'token'}:${context.sourceEpoch}:${impact.direction}:${impact.category}:${impact.evidence?.at(-1) || impact.verifiedExecutionCount}`,
        tokenMint: context.tokenMint || null,
        sourceEpoch: context.sourceEpoch,
        direction: impact.direction,
        faction: impact.direction === 'BULLISH' ? 'bull' : 'bear',
        category: impact.category,
        score: clamp(impact.score, 0, 1),
        verifiedExecutionCount: impact.verifiedExecutionCount,
        executionCount: impact.verifiedExecutionCount,
        clusterType: impact.clusterType || null,
        cause: impact.cause,
        intensity: policy.intensity,
        majorCharge: policy.majorCharge,
        speed: policy.speed,
        maxDistance: policy.distance,
        maxContacts: policy.contacts,
        impulseMagnitude: policy.impulse,
        cooldownMs: policy.cooldownMs,
        evidence: Object.freeze((impact.evidence || []).slice(0, 16)),
    });
}

export function createImpactPresentationController() {
    let pending = null;
    let active = null;
    let lastFingerprint = null;
    let baselineFingerprint = null;
    let cooldownUntil = 0;
    let superseded = 0;
    let coalesced = 0;
    let rejected = 0;
    let observed = 0;
    let latestIntensity = 0;
    let latestUntil = 0;
    let contextTokenMint = null;
    let contextSourceEpoch = null;
    let hasContext = false;

    const api = {
        establishContext(snapshot) {
            contextTokenMint = snapshot?.tokenMint || null;
            contextSourceEpoch = Number.isInteger(snapshot?.sourceEpoch) ? snapshot.sourceEpoch : null;
            hasContext = true;
            pending = null;
            baselineFingerprint = impactFingerprint(snapshot);
            lastFingerprint = baselineFingerprint;
            latestIntensity = 0;
            latestUntil = 0;
        },
        observe(snapshot, now = Date.now()) {
            const impact = snapshot?.impact;
            const fingerprint = impactFingerprint(snapshot);
            if (!hasContext) {
                contextTokenMint = snapshot?.tokenMint || null;
                contextSourceEpoch = Number.isInteger(snapshot?.sourceEpoch) ? snapshot.sourceEpoch : null;
                hasContext = true;
            } else {
                // A terrain controller may establish identity before its first
                // numbered source epoch. Filling that missing value is context
                // completion, not a rebase and must not discard the first live
                // verified impact.
                const incomingTokenMint = snapshot?.tokenMint || null;
                const incomingSourceEpoch = Number.isInteger(snapshot?.sourceEpoch) ? snapshot.sourceEpoch : null;
                if (contextTokenMint === null && incomingTokenMint) contextTokenMint = incomingTokenMint;
                if (contextSourceEpoch === null && incomingSourceEpoch !== null) {
                    contextSourceEpoch = incomingSourceEpoch;
                }
                const tokenChanged = incomingTokenMint !== null && contextTokenMint !== null
                    && incomingTokenMint !== contextTokenMint;
                const epochChanged = incomingSourceEpoch !== null && contextSourceEpoch !== null
                    && incomingSourceEpoch !== contextSourceEpoch;
                if (tokenChanged || epochChanged) {
                    const cancelActive = Boolean(active);
                    const previousContext = { tokenMint: contextTokenMint, sourceEpoch: contextSourceEpoch };
                    contextTokenMint = incomingTokenMint ?? contextTokenMint;
                    contextSourceEpoch = incomingSourceEpoch ?? contextSourceEpoch;
                    pending = null;
                    lastFingerprint = fingerprint;
                    baselineFingerprint = fingerprint;
                    latestIntensity = 0;
                    latestUntil = 0;
                    rejected += 1;
                    return {
                        accepted: false,
                        cancelActive,
                        contextChanged: true,
                        previousContext,
                        nextContext: { tokenMint: contextTokenMint, sourceEpoch: contextSourceEpoch },
                    };
                }
            }
            if (!fingerprint || fingerprint === lastFingerprint || fingerprint === baselineFingerprint) {
                return { accepted: false, cancelActive: false };
            }
            lastFingerprint = fingerprint;
            const request = mapMarketImpactToPresentation(impact, {
                status: snapshot.status,
                sourceEpoch: snapshot.sourceEpoch,
                tokenMint: snapshot.tokenMint,
                // Attachment/bootstrap suppression belongs to the consumer,
                // which can distinguish its first snapshot from a later live
                // execution while the domain snapshot intentionally cannot.
                initializing: false,
                id: `${snapshot.tokenMint || 'token'}:${snapshot.sourceEpoch}:${fingerprint}`,
            });
            if (!request) {
                rejected += 1;
                return { accepted: false, cancelActive: false };
            }
            observed += 1;
            latestIntensity = request.intensity;
            latestUntil = now + COMBAT_POLICY.presentationLifetimeMs;
            if (!request.majorCharge) return { accepted: true, request, cancelActive: false };
            const cancelActive = Boolean(active && active.direction !== request.direction);
            if (pending) {
                if (pending.direction === request.direction) coalesced += 1;
                else superseded += 1;
            }
            if (cancelActive) superseded += 1;
            pending = request;
            return { accepted: true, request, cancelActive };
        },
        peekPending(now = Date.now()) {
            if (!pending || active || now < cooldownUntil) return null;
            return pending;
        },
        activatePending(now = Date.now()) {
            const request = api.peekPending(now);
            if (!request) return null;
            active = request;
            pending = null;
            return active;
        },
        completeActive(now = Date.now()) {
            if (!active) return null;
            const completed = active;
            cooldownUntil = now + completed.cooldownMs;
            active = null;
            return completed;
        },
        cancelActive(now = Date.now()) {
            if (!active) return null;
            const cancelled = active;
            cooldownUntil = Math.min(cooldownUntil, now + 280);
            active = null;
            return cancelled;
        },
        reset() {
            pending = null;
            active = null;
            lastFingerprint = null;
            baselineFingerprint = null;
            cooldownUntil = 0;
            superseded = 0;
            coalesced = 0;
            rejected = 0;
            observed = 0;
            latestIntensity = 0;
            latestUntil = 0;
            contextTokenMint = null;
            contextSourceEpoch = null;
            hasContext = false;
        },
        getDiagnostics(now = Date.now()) {
            return {
                active: active ? { ...active } : null,
                pending: pending ? { ...pending } : null,
                queueDepth: pending ? 1 : 0,
                cooldownMs: Math.max(0, cooldownUntil - now),
                superseded,
                coalesced,
                rejected,
                observed,
                latestIntensity: now <= latestUntil ? latestIntensity : 0,
                contextTokenMint,
                contextSourceEpoch,
                hasContext,
            };
        },
    };
    return Object.freeze(api);
}

function impactFingerprint(snapshot) {
    const impact = snapshot?.impact;
    return impact
        ? `${impact.direction}:${impact.category}:${impact.verifiedExecutionCount}:${impact.cause}:${impact.evidence?.at(-1) || ''}`
        : null;
}

/**
 * Returns the squared X/Z distance from a point to a finite movement segment.
 * The projection is exposed so callers can order every collision along a
 * charge, which prevents low frame rates from changing who was hit first.
 */
export function pointToSegmentDistanceSquared(pointX, pointZ, startX, startZ, endX, endZ, output = {}) {
    const segmentX = endX - startX;
    const segmentZ = endZ - startZ;
    const lengthSquared = segmentX * segmentX + segmentZ * segmentZ;
    const projection = lengthSquared > 0.000001
        ? clamp(((pointX - startX) * segmentX + (pointZ - startZ) * segmentZ) / lengthSquared, 0, 1)
        : 0;
    const closestX = startX + segmentX * projection;
    const closestZ = startZ + segmentZ * projection;
    const dx = pointX - closestX;
    const dz = pointZ - closestZ;
    output.distanceSquared = dx * dx + dz * dz;
    output.projection = projection;
    return output;
}

export function sweptCircleIntersects({
    pointX,
    pointZ,
    startX,
    startZ,
    endX,
    endZ,
    radius,
}, output = {}) {
    const result = pointToSegmentDistanceSquared(pointX, pointZ, startX, startZ, endX, endZ, output);
    const segmentX = endX - startX;
    const segmentZ = endZ - startZ;
    const offsetX = startX - pointX;
    const offsetZ = startZ - pointZ;
    const a = segmentX * segmentX + segmentZ * segmentZ;
    const c = offsetX * offsetX + offsetZ * offsetZ - radius * radius;
    if (a <= 0.000001) {
        const hit = c <= 0;
        result.hit = hit;
        result.entryProjection = hit ? 0 : null;
        return result;
    }
    const b = 2 * (offsetX * segmentX + offsetZ * segmentZ);
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) {
        result.hit = false;
        result.entryProjection = null;
        return result;
    }
    const root = Math.sqrt(discriminant);
    const entry = (-b - root) / (2 * a);
    const exit = (-b + root) / (2 * a);
    const hit = exit >= 0 && entry <= 1;
    result.hit = hit;
    result.entryProjection = hit ? clamp(entry, 0, 1) : null;
    return result;
}

/**
 * A giant bull represents one verified >=20 SOL buy. Its charge strength is
 * based on that real swap, while current 60s pressure controls whether the
 * battlefield lets it advance and how many ranks the rush can displace.
 */
export function deriveBullChargeProfile({
    balance = 0,
    flowIntensity = 0,
    solValue = 20,
    power = 1,
} = {}) {
    const safeBalance = clamp(Number(balance) || 0, -1, 1);
    const safeFlow = clamp(Number(flowIntensity) || 0, 0, 1);
    const safeSol = Math.max(0, Number(solValue) || 0);
    const safePower = clamp(Number(power) || 1, 0.75, 3);
    const whaleScale = clamp(Math.log2(Math.max(1, safeSol / 20) + 1), 1, 3.2);
    const pressureScale = clamp(0.86 + safeBalance * 0.34 + safeFlow * 0.24, 0.62, 1.42);

    return {
        // A giant buy remains visible in every regime, but a full forward
        // charge only happens once verified 60s SOL flow is actually bullish.
        // In a contested/red tape it holds and fights locally instead of
        // telling a story that contradicts the chart.
        enabled: safeSol >= 20 && safeBalance >= 0.12,
        windupMs: Math.round(680 - safeFlow * 120),
        recoverMs: Math.round(720 - safeFlow * 100),
        speed: 21.5 + safeFlow * 6.5 + whaleScale * 1.3,
        maxDistance: 25 + safeFlow * 7 + whaleScale * 2.2,
        damage: Math.round((185 + safeSol * 3.1) * safePower * pressureScale),
        rankCapacity: clamp(Math.round(2 + whaleScale * 1.4 + safeFlow * 2.2 + Math.max(0, safeBalance) * 2), 3, 9),
        corridorRadius: 3.35 + whaleScale * 0.24,
        cooldownMs: Math.round(8_500 - safeFlow * 2_000 + Math.max(0, -safeBalance) * 1_500),
        maxConcurrent: 1 + (safeFlow >= 0.48 ? 1 : 0) + (safeFlow >= 0.82 && safeBalance >= 0.3 ? 1 : 0),
        pressureScale,
    };
}
