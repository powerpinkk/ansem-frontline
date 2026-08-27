function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Returns the squared X/Z distance from a point to a finite movement segment.
 * The projection is exposed so callers can order every collision along a
 * charge, which prevents low frame rates from changing who was hit first.
 */
export function pointToSegmentDistanceSquared(pointX, pointZ, startX, startZ, endX, endZ) {
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
    return { distanceSquared: dx * dx + dz * dz, projection };
}

export function sweptCircleIntersects({
    pointX,
    pointZ,
    startX,
    startZ,
    endX,
    endZ,
    radius,
}) {
    const result = pointToSegmentDistanceSquared(pointX, pointZ, startX, startZ, endX, endZ);
    const segmentX = endX - startX;
    const segmentZ = endZ - startZ;
    const offsetX = startX - pointX;
    const offsetZ = startZ - pointZ;
    const a = segmentX * segmentX + segmentZ * segmentZ;
    const c = offsetX * offsetX + offsetZ * offsetZ - radius * radius;
    if (a <= 0.000001) {
        const hit = c <= 0;
        return { hit, entryProjection: hit ? 0 : null, ...result };
    }
    const b = 2 * (offsetX * segmentX + offsetZ * segmentZ);
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return { hit: false, entryProjection: null, ...result };
    const root = Math.sqrt(discriminant);
    const entry = (-b - root) / (2 * a);
    const exit = (-b + root) / (2 * a);
    const hit = exit >= 0 && entry <= 1;
    return {
        hit,
        entryProjection: hit ? clamp(entry, 0, 1) : null,
        ...result,
    };
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
