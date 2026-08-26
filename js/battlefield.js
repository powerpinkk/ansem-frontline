function finiteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function sideForce(sol, activityCount, hourlyCount, verifiedCount, cap) {
    const activity = finiteNumber(activityCount);
    const hourly = finiteNumber(hourlyCount);
    const verified = finiteNumber(verifiedCount);
    const volume = finiteNumber(sol);
    if (activity === 0 && hourly === 0 && verified === 0 && volume < 0.001) return 0;

    // The one-hour count supplies strategic army depth; five-minute activity
    // and verified 60-second SOL supply the active wave. All volume terms are
    // deliberately sub-linear so one whale never masquerades as hundreds of
    // independent swaps.
    const hourlyRanks = Math.sqrt(hourly) * 3.8;
    const activityRanks = activity * 0.75;
    const volumeRanks = Math.sqrt(volume) * 8.5;
    const recentRanks = verified * 1.5;
    return Math.round(clamp(hourlyRanks + activityRanks + volumeRanks + recentRanks, Math.max(1, verified), cap));
}

export function deriveVisualForces({
    buySol = 0,
    sellSol = 0,
    buyCount = 0,
    sellCount = 0,
    buyCount1h = 0,
    sellCount1h = 0,
    verifiedBuyCount = 0,
    verifiedSellCount = 0,
    maxPerSide = 260,
} = {}) {
    const cap = Math.max(1, Math.round(finiteNumber(maxPerSide) || 260));
    const bull = sideForce(buySol, buyCount, buyCount1h, verifiedBuyCount, cap);
    const bear = sideForce(sellSol, sellCount, sellCount1h, verifiedSellCount, cap);
    const totalSol = finiteNumber(buySol) + finiteNumber(sellSol);
    const totalActivity = finiteNumber(buyCount) + finiteNumber(sellCount);
    const intensity = clamp(
        Math.log1p(totalSol * 1.8 + totalActivity * 0.35) / Math.log(501),
        0,
        1,
    );
    const hourTotal = finiteNumber(buyCount1h) + finiteNumber(sellCount1h);
    const hourBalance = hourTotal > 0
        ? (finiteNumber(buyCount1h) - finiteNumber(sellCount1h)) / hourTotal
        : 0;
    return { bull, bear, total: bull + bear, intensity, cap, hourBalance, hourTotal };
}

export function deriveForceDoctrine(type, tactics = {}) {
    const direction = type === 'bull' ? 1 : -1;
    const balance = clamp(Number(tactics.balance) || 0, -1, 1);
    const sideBalance = balance * direction;
    const flowIntensity = clamp(Number(tactics.flowIntensity) || 0, 0, 1);
    const activityLevel = clamp(Number(tactics.activityLevel) || 0, 0, 1);

    let stance = 'muster';
    if (flowIntensity >= 0.035 && Math.abs(balance) < 0.12) stance = 'clash';
    else if (sideBalance >= 0.42) stance = 'surge';
    else if (sideBalance >= 0.12) stance = 'advance';
    else if (sideBalance <= -0.42) stance = 'reinforce';
    else if (sideBalance <= -0.12) stance = 'resist';

    return {
        stance,
        direction,
        sideBalance,
        aggression: clamp(0.34 + flowIntensity * 0.38 + sideBalance * 0.32, 0.12, 1),
        speed: 0.72 + activityLevel * 0.2 + flowIntensity * 0.36 + Math.max(0, sideBalance) * 0.18,
        cohesion: clamp(0.78 - flowIntensity * 0.2 - Math.max(0, -sideBalance) * 0.14, 0.42, 0.9),
        penetration: clamp(sideBalance * 10 + flowIntensity * 2.5, -11, 12),
    };
}

export function deriveKingDirective({ tactics = {}, defending = false, supporting = false, mode: forcedMode = null } = {}) {
    const balance = clamp(Number(tactics.balance) || 0, -1, 1);
    const flowIntensity = clamp(Number(tactics.flowIntensity) || 0, 0, 1);
    let mode = 'overwatch';
    if (defending) mode = 'defend';
    else if (supporting) mode = 'rally';
    else if (flowIntensity >= 0.04 && balance >= 0.18) mode = 'lead';
    else if (flowIntensity >= 0.04 && balance <= -0.18) mode = 'guard';
    else if (flowIntensity >= 0.04) mode = 'marshal';
    if (['defend', 'rally', 'lead', 'marshal', 'overwatch', 'guard'].includes(forcedMode)) mode = forcedMode;

    const trailingByMode = {
        defend: 9,
        rally: 12,
        lead: 14,
        marshal: 18,
        overwatch: 22,
        guard: 28,
    };
    const altitudeByMode = {
        defend: 13.2,
        rally: 12.8,
        lead: 11.7,
        marshal: 13.1,
        overwatch: 13.6,
        guard: 14.6,
    };
    return {
        mode,
        trailingDistance: trailingByMode[mode],
        altitude: altitudeByMode[mode],
        response: mode === 'defend' ? 3.8 : mode === 'rally' ? 2.2 : mode === 'guard' ? 1.7 : 1.35,
        maxSpeed: mode === 'defend' ? 19 : mode === 'rally' ? 14 : mode === 'guard' ? 12 : 10,
    };
}

export function shouldKingWard(tactics = {}) {
    const balance = clamp(Number(tactics.balance) || 0, -1, 1);
    return balance >= -0.15;
}
