export const DEFAULT_CHAMPION_DURATION_MS = 30 * 60 * 1_000;
export const DEFAULT_CHAMPION_MAX_TRACKED_MINTS = 12;

export function createChampionPolicy({
    durationMs = DEFAULT_CHAMPION_DURATION_MS,
    testDurationMs = durationMs,
    maxTrackedMints = DEFAULT_CHAMPION_MAX_TRACKED_MINTS,
} = {}) {
    const simulationDuration = positiveDuration(durationMs, 'Champion duration');
    const controlledTestDuration = positiveDuration(testDurationMs, 'Champion test duration');
    if (!Number.isInteger(maxTrackedMints) || maxTrackedMints < 1 || maxTrackedMints > 64) {
        throw new TypeError('Champion tracked mint limit must be between 1 and 64');
    }
    return Object.freeze({
        maxActivePerMint: 1,
        maxTrackedMints,
        reactivation: 'refresh',
        durationFor(source) {
            if (source === 'simulation') return simulationDuration;
            if (source === 'test') return controlledTestDuration;
            throw new TypeError('Champion policy does not accept this activation source');
        },
        expiresAt(activatedAt, source) {
            if (!Number.isFinite(activatedAt) || activatedAt < 0) throw new TypeError('Champion activation time is invalid');
            return activatedAt + this.durationFor(source);
        },
    });
}

function positiveDuration(value, label) {
    if (!Number.isInteger(value) || value < 100 || value > 24 * 60 * 60 * 1_000) {
        throw new TypeError(`${label} must be between 100 ms and 24 hours`);
    }
    return value;
}
