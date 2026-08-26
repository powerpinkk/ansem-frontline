export const ARENA = Object.freeze({
    minX: -68,
    maxX: 68,
    minZ: -32,
    maxZ: 32,
    spawnBullX: -62,
    spawnBearX: 62,
});

export const UNIT_LIFETIME_MS = 75_000;
export const WHALE_LIFETIME_MS = 105_000;

export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export function clampArenaPosition(position, padding = 0) {
    return {
        x: clamp(position.x, ARENA.minX + padding, ARENA.maxX - padding),
        z: clamp(position.z, ARENA.minZ + padding, ARENA.maxZ - padding),
    };
}

export function tradeLane(trade, sequence = 0) {
    const source = String(trade?.txHash || trade?.id || sequence);
    let hash = 2166136261;
    for (let i = 0; i < source.length; i++) {
        hash ^= source.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    const normalized = (hash >>> 0) / 4294967295;
    const lanePadding = 4;
    return ARENA.minZ + lanePadding + normalized * (ARENA.maxZ - ARENA.minZ - lanePadding * 2);
}

export function formationTarget(type, frontlineX, lane, formationIndex = 0, isWhale = false) {
    const direction = type === 'bull' ? -1 : 1;
    const row = Math.floor(formationIndex / 7);
    const depth = (isWhale ? 7 : 4.5) + row * 2.8;
    return clampArenaPosition({
        x: frontlineX + direction * depth,
        z: clamp(lane, ARENA.minZ + 1.5, ARENA.maxZ - 1.5),
    }, isWhale ? 4 : 1.5);
}

export function tacticalPatrolTarget(type, frontlineX, lane, phase = 0, isWhale = false, crossingSide = 1, elapsed = 0) {
    const side = crossingSide >= 0 ? 1 : -1;
    const depth = (isWhale ? 7.5 : 9.5) + (Math.sin(phase * 1.31) + 1) * 1.4;
    const sideBias = type === 'bull' ? 0.7 : -0.7;
    return clampArenaPosition({
        x: frontlineX + side * depth + sideBias,
        z: lane + Math.sin(elapsed * 0.34 + phase * 1.7) * (isWhale ? 1.6 : 2.5),
    }, isWhale ? 4 : 1.5);
}

export function isUnitStranded(type, unitX, frontlineX, margin = 6) {
    return type === 'bull'
        ? unitX > frontlineX + margin
        : unitX < frontlineX - margin;
}

export function unitHasExpired(entity, now = Date.now()) {
    const lifetime = entity.isWhale ? WHALE_LIFETIME_MS : UNIT_LIFETIME_MS;
    return now - entity.bornAt >= lifetime;
}

export function isFinitePosition(position) {
    return Number.isFinite(position.x) && Number.isFinite(position.z);
}
