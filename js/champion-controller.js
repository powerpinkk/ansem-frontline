import {
    CHAMPION_SOURCE,
    CHAMPION_STATUS,
    activeChampionState,
    canonicalMint,
    expireChampionState,
    inactiveChampionState,
} from './champion-state.js';
import { createChampionPolicy } from './champion-policy.js';

export function createChampionController({
    policy = createChampionPolicy(),
    clock = { now: () => Date.now() },
    scheduler = { setTimeout: (callback, delay) => setTimeout(callback, delay), clearTimeout: (id) => clearTimeout(id) },
    createActivationId = defaultActivationId,
} = {}) {
    if (!policy?.durationFor || !policy?.expiresAt || !Number.isInteger(policy.maxTrackedMints)) {
        throw new TypeError('ChampionController requires a ChampionPolicy');
    }
    if (typeof clock?.now !== 'function' || typeof scheduler?.setTimeout !== 'function' || typeof scheduler?.clearTimeout !== 'function') {
        throw new TypeError('ChampionController requires an injectable clock and scheduler');
    }

    const states = new Map();
    const listeners = new Set();
    let activeMint = null;
    let expiryTimer = null;
    let destroyed = false;
    let sequence = 0;
    let activations = 0;
    let reactivations = 0;
    let expirations = 0;
    let evictions = 0;

    const now = () => {
        const value = Number(clock.now());
        if (!Number.isFinite(value) || value < 0) throw new TypeError('Champion clock returned an invalid time');
        return value;
    };

    const emit = () => {
        if (!activeMint || destroyed) return;
        const snapshot = snapshotFor(activeMint);
        listeners.forEach((listener) => listener(snapshot));
    };

    const sweepExpired = (at = now()) => {
        let activeChanged = false;
        for (const [mint, state] of states) {
            if (state.status !== CHAMPION_STATUS.ACTIVE || state.expiresAt > at) continue;
            const expired = expireChampionState(state, at);
            sequence = Math.max(sequence + 1, expired.sequence);
            states.set(mint, Object.freeze({ ...expired, sequence }));
            expirations += 1;
            if (mint === activeMint) activeChanged = true;
        }
        return activeChanged;
    };

    const scheduleExpiry = () => {
        if (expiryTimer !== null) scheduler.clearTimeout(expiryTimer);
        expiryTimer = null;
        if (destroyed) return;
        const at = now();
        const nextExpiry = [...states.values()]
            .filter((state) => state.status === CHAMPION_STATUS.ACTIVE)
            .reduce((earliest, state) => Math.min(earliest, state.expiresAt), Number.POSITIVE_INFINITY);
        if (!Number.isFinite(nextExpiry)) return;
        expiryTimer = scheduler.setTimeout(() => {
            expiryTimer = null;
            const changed = sweepExpired(now());
            scheduleExpiry();
            if (changed) emit();
        }, Math.max(0, nextExpiry - at));
    };

    const trim = () => {
        while (states.size > policy.maxTrackedMints) {
            const entries = [...states.entries()];
            const removable = entries.find(([, state]) => state.status !== CHAMPION_STATUS.ACTIVE)
                || entries.find(([mint]) => mint !== activeMint)
                || entries[0];
            states.delete(removable[0]);
            evictions += 1;
        }
    };

    const snapshotFor = (mint) => {
        const canonical = canonicalMint(mint);
        const at = now();
        return states.get(canonical) || inactiveChampionState(canonical, sequence, at);
    };

    const activate = (request, source) => {
        if (destroyed) throw new Error('ChampionController is destroyed');
        assertActivationRequest(request);
        const mint = canonicalMint(request.mint);
        const activatedAt = now();
        const activeMintExpired = sweepExpired(activatedAt);
        const previous = states.get(mint);
        const durationMs = policy.durationFor(source);
        sequence += 1;
        const activation = activeChampionState({
            mint,
            activationId: String(createActivationId({ mint, source, sequence, now: activatedAt })),
            source,
            activatedAt,
            expiresAt: policy.expiresAt(activatedAt, source),
            durationMs,
            displayLabel: request.displayLabel ?? null,
            sequence,
            updatedAt: activatedAt,
        });
        states.delete(mint);
        states.set(mint, activation);
        activations += 1;
        if (previous?.status === CHAMPION_STATUS.ACTIVE) reactivations += 1;
        trim();
        scheduleExpiry();
        if (mint === activeMint || activeMintExpired) emit();
        return activation;
    };

    return Object.freeze({
        setActiveMint(mint) {
            if (destroyed) return null;
            activeMint = canonicalMint(mint);
            sweepExpired(now());
            scheduleExpiry();
            emit();
            return snapshotFor(activeMint);
        },
        activateSimulatedChampion(request) {
            return activate(request, CHAMPION_SOURCE.SIMULATION);
        },
        activateTestChampion(request) {
            return activate(request, CHAMPION_SOURCE.TEST);
        },
        deactivate(mint = activeMint, reason = 'deactivated') {
            if (destroyed || !mint) return false;
            const canonical = canonicalMint(mint);
            const previous = states.get(canonical);
            if (!previous || previous.status !== CHAMPION_STATUS.ACTIVE) return false;
            sequence += 1;
            states.set(canonical, Object.freeze({
                ...inactiveChampionState(canonical, sequence, now()),
                reason: typeof reason === 'string' && reason ? reason.slice(0, 40) : 'deactivated',
            }));
            scheduleExpiry();
            if (canonical === activeMint) emit();
            return true;
        },
        getSnapshot(mint = activeMint) {
            if (!mint) return null;
            const activeMintExpired = sweepExpired(now());
            const snapshot = snapshotFor(mint);
            scheduleExpiry();
            if (activeMintExpired) emit();
            return snapshot;
        },
        subscribe(listener) {
            if (typeof listener !== 'function') throw new TypeError('Champion subscriber must be a function');
            listeners.add(listener);
            if (activeMint && !destroyed) {
                sweepExpired(now());
                scheduleExpiry();
                listener(snapshotFor(activeMint));
            }
            return () => listeners.delete(listener);
        },
        getDiagnostics() {
            const at = now();
            const activeMintExpired = sweepExpired(at);
            scheduleExpiry();
            if (activeMintExpired) emit();
            const tracked = [...states.values()];
            return Object.freeze({
                destroyed,
                activeMint,
                activeCount: tracked.filter((state) => state.status === CHAMPION_STATUS.ACTIVE).length,
                trackedMints: tracked.length,
                timerCount: expiryTimer === null ? 0 : 1,
                listenerCount: listeners.size,
                activations,
                reactivations,
                expirations,
                evictions,
                policy: Object.freeze({
                    reactivation: policy.reactivation,
                    maxActivePerMint: policy.maxActivePerMint,
                    maxTrackedMints: policy.maxTrackedMints,
                }),
                states: Object.freeze(tracked.map((state) => Object.freeze({
                    mint: state.mint,
                    status: state.status,
                    activationId: state.activationId,
                    source: state.source,
                    remainingMs: state.status === CHAMPION_STATUS.ACTIVE ? Math.max(0, state.expiresAt - at) : 0,
                    sequence: state.sequence,
                }))),
            });
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            if (expiryTimer !== null) scheduler.clearTimeout(expiryTimer);
            expiryTimer = null;
            states.clear();
            listeners.clear();
            activeMint = null;
        },
    });
}

function assertActivationRequest(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new TypeError('Champion activation request must be an object');
    const allowed = new Set(['mint', 'displayLabel']);
    for (const key of Object.keys(request)) {
        if (!allowed.has(key)) throw new TypeError(`Champion activation request contains unknown field: ${key}`);
    }
    if (!Object.hasOwn(request, 'mint')) throw new TypeError('Champion activation request requires a mint');
}

function defaultActivationId({ source, sequence, now }) {
    const random = globalThis.crypto?.randomUUID?.() || `${now.toString(36)}-${sequence.toString(36)}`;
    return `${source}:${random}`;
}
