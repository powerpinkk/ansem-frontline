import { validateSolanaMint } from './token-context.js';

export const CHAMPION_STATUS = Object.freeze({
    INACTIVE: 'inactive',
    ACTIVE: 'active',
    EXPIRED: 'expired',
});

export const CHAMPION_SOURCE = Object.freeze({
    SIMULATION: 'simulation',
    TEST: 'test',
});

export const USER_CHAMPION_ROLE = 'user-champion';

export function inactiveChampionState(mint, sequence = 0, now = Date.now()) {
    return freezeChampionState({
        status: CHAMPION_STATUS.INACTIVE,
        mint: canonicalMint(mint),
        activationId: null,
        source: null,
        activatedAt: null,
        expiresAt: null,
        durationMs: 0,
        presentationRole: USER_CHAMPION_ROLE,
        displayLabel: null,
        reason: 'not-activated',
        sequence,
        updatedAt: now,
    });
}

export function activeChampionState({
    mint,
    activationId,
    source,
    activatedAt,
    expiresAt,
    durationMs,
    displayLabel = null,
    sequence = 0,
    updatedAt = activatedAt,
}) {
    const canonical = canonicalMint(mint);
    if (!Object.values(CHAMPION_SOURCE).includes(source)) throw new TypeError('Champion source must be simulation or test');
    if (typeof activationId !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,95}$/i.test(activationId)) {
        throw new TypeError('Champion activation ID is invalid');
    }
    if (!Number.isFinite(activatedAt) || !Number.isFinite(expiresAt) || !Number.isFinite(durationMs)
        || durationMs <= 0 || expiresAt !== activatedAt + durationMs) {
        throw new TypeError('Champion activation times are invalid');
    }
    return freezeChampionState({
        status: CHAMPION_STATUS.ACTIVE,
        mint: canonical,
        activationId,
        source,
        activatedAt,
        expiresAt,
        durationMs,
        presentationRole: USER_CHAMPION_ROLE,
        displayLabel: safeDisplayLabel(displayLabel),
        reason: 'activated',
        sequence: nonNegativeInteger(sequence, 'Champion sequence'),
        updatedAt: finiteTimestamp(updatedAt, 'Champion updated time'),
    });
}

export function expireChampionState(state, now = Date.now()) {
    if (!isChampionState(state) || state.status !== CHAMPION_STATUS.ACTIVE) {
        throw new TypeError('Only an active Champion can expire');
    }
    return freezeChampionState({
        ...state,
        status: CHAMPION_STATUS.EXPIRED,
        reason: 'expired',
        sequence: state.sequence + 1,
        updatedAt: finiteTimestamp(now, 'Champion expiry time'),
    });
}

export function isChampionState(value) {
    try {
        assertChampionState(value);
        return true;
    } catch {
        return false;
    }
}

export function assertChampionState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('ChampionState must be an object');
    const allowed = new Set([
        'status', 'mint', 'activationId', 'source', 'activatedAt', 'expiresAt', 'durationMs',
        'presentationRole', 'displayLabel', 'reason', 'sequence', 'updatedAt',
    ]);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) throw new TypeError(`ChampionState contains unknown field: ${key}`);
    }
    canonicalMint(value.mint);
    if (!Object.values(CHAMPION_STATUS).includes(value.status)) throw new TypeError('Champion status is invalid');
    if (value.presentationRole !== USER_CHAMPION_ROLE) throw new TypeError('Champion presentation role is invalid');
    nonNegativeInteger(value.sequence, 'Champion sequence');
    finiteTimestamp(value.updatedAt, 'Champion updated time');
    if (value.status === CHAMPION_STATUS.INACTIVE) {
        if (value.activationId !== null || value.source !== null || value.activatedAt !== null
            || value.expiresAt !== null || value.durationMs !== 0 || value.displayLabel !== null) {
            throw new TypeError('Inactive Champion state must not retain activation data');
        }
        safeReason(value.reason);
        return value;
    }
    if (!Object.values(CHAMPION_SOURCE).includes(value.source)) throw new TypeError('Champion source is invalid');
    if (typeof value.activationId !== 'string' || !value.activationId) throw new TypeError('Champion activation ID is invalid');
    finiteTimestamp(value.activatedAt, 'Champion activation time');
    finiteTimestamp(value.expiresAt, 'Champion expiry time');
    if (!(value.durationMs > 0) || value.expiresAt !== value.activatedAt + value.durationMs) {
        throw new TypeError('Champion duration is invalid');
    }
    safeDisplayLabel(value.displayLabel);
    safeReason(value.reason);
    return value;
}

export function canonicalMint(value) {
    const validation = validateSolanaMint(value);
    if (!validation.ok) throw new TypeError('Champion requires a canonical Solana mint');
    return validation.value;
}

function safeDisplayLabel(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') throw new TypeError('Champion display label must be text');
    const normalized = value.trim();
    if (!normalized || normalized.length > 40 || normalized.includes('<') || normalized.includes('>')
        || [...normalized].some((character) => character.charCodeAt(0) < 32)) {
        throw new TypeError('Champion display label is invalid');
    }
    return normalized;
}

function finiteTimestamp(value, label) {
    if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} is invalid`);
    return value;
}

function nonNegativeInteger(value, label) {
    if (!Number.isInteger(value) || value < 0) throw new TypeError(`${label} is invalid`);
    return value;
}

function safeReason(value) {
    if (typeof value !== 'string' || !value || value.length > 40) throw new TypeError('Champion reason is invalid');
    return value;
}

function freezeChampionState(value) {
    assertChampionState(value);
    return Object.freeze(value);
}
