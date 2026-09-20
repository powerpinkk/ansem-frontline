import { activeTrade } from './market-evidence.js';

export const MARKET_BAND_POLICY = Object.freeze([
    Object.freeze({ minimum: 0, maximum: 10_000, majorInterval: 1_000, subdivisions: 5 }),
    Object.freeze({ minimum: 10_000, maximum: 100_000, majorInterval: 10_000, subdivisions: 5 }),
    Object.freeze({ minimum: 100_000, maximum: 1_000_000, majorInterval: 50_000, subdivisions: 5 }),
    Object.freeze({ minimum: 1_000_000, maximum: 100_000_000, majorInterval: 500_000, subdivisions: 5 }),
    Object.freeze({ minimum: 100_000_000, maximum: 1_000_000_000, majorInterval: 1_000_000, subdivisions: 5 }),
    Object.freeze({ minimum: 1_000_000_000, maximum: 100_000_000_000, majorInterval: 500_000_000, subdivisions: 5 }),
    Object.freeze({ minimum: 100_000_000_000, maximum: Number.POSITIVE_INFINITY, majorInterval: 5_000_000_000, subdivisions: 5 }),
]);

export const MARKET_TERRAIN_POLICY = Object.freeze({
    worldUnitsPerBand: 10,
    desktop: Object.freeze({ minimumWidth: 1_100, bandsBehind: 4, bandsAhead: 4, labelStride: 1 }),
    tablet: Object.freeze({ minimumWidth: 700, bandsBehind: 3, bandsAhead: 3, labelStride: 1 }),
    mobile: Object.freeze({ minimumWidth: 0, bandsBehind: 2, bandsAhead: 2, labelStride: 2 }),
    maxTraversalBoundaries: 64,
    maxVisualDebtMs: 3_000,
    snapAfterHiddenMs: 4_000,
    responsePerSecond: 4.5,
    maxPresentationSpeedBandsPerSecond: 18,
    impactWindowMs: 2_500,
    maxImpactEvidence: 16,
    maxImpactExecutions: 64,
});

const MOVEMENT_CAUSES = Object.freeze({
    TOKEN_PRICE_UPDATE: 'TOKEN_NATIVE_MARKET_MOVE',
    TOKEN_PRICE_AND_QUOTE_FX: 'TOKEN_NATIVE_AND_QUOTE_FX_MOVE',
    QUOTE_USD_FX_UPDATE: 'QUOTE_USD_FX_MOVE',
    SUPPLY_BASIS_CHANGE: 'SUPPLY_BASIS_CHANGE',
    SOURCE_REBASE: 'SOURCE_REBASE',
    STATE_RECONCILIATION: 'RECOVERY_RECONCILIATION',
    PROVIDER_CORRECTION: 'PROVIDER_CORRECTION',
});

const IMPACT_CAUSES = new Set(['TOKEN_NATIVE_MARKET_MOVE', 'TOKEN_NATIVE_AND_QUOTE_FX_MOVE']);
const BASE_COORDINATES = buildBaseCoordinates();

function buildBaseCoordinates() {
    let coordinate = 0;
    return MARKET_BAND_POLICY.map((regime) => {
        const current = coordinate;
        if (Number.isFinite(regime.maximum)) coordinate += (regime.maximum - regime.minimum) / regime.majorInterval;
        return current;
    });
}

function decimalParts(value) {
    const text = typeof value === 'number' ? String(value) : value;
    if (typeof text !== 'string' || !/^\d+(?:\.\d+)?$/.test(text)) throw new TypeError('Valuation must be a non-negative decimal');
    const [whole, fraction = ''] = text.split('.');
    const denominator = 10n ** BigInt(fraction.length);
    const numerator = BigInt(whole + fraction);
    if (numerator < 0n) throw new TypeError('Valuation must be non-negative');
    return { numerator, denominator };
}

function compareWhole(parts, whole) {
    const target = BigInt(whole) * parts.denominator;
    return parts.numerator < target ? -1 : parts.numerator > target ? 1 : 0;
}

function regimeForParts(parts) {
    const index = MARKET_BAND_POLICY.findIndex((regime) => !Number.isFinite(regime.maximum)
        || compareWhole(parts, regime.maximum) < 0);
    return { ...MARKET_BAND_POLICY[index], index, baseCoordinate: BASE_COORDINATES[index] };
}

function safeWhole(bigint, label) {
    const value = Number(bigint);
    if (!Number.isFinite(value)) throw new RangeError(`${label} exceeds renderable numeric range`);
    return value;
}

export function marketBand(value) {
    const parts = decimalParts(value);
    const regime = regimeForParts(parts);
    const offset = parts.numerator - BigInt(regime.minimum) * parts.denominator;
    const span = BigInt(regime.majorInterval) * parts.denominator;
    const completed = offset / span;
    const remainder = offset % span;
    const lower = BigInt(regime.minimum) + completed * BigInt(regime.majorInterval);
    const upper = lower + BigInt(regime.majorInterval);
    const progress = Number(remainder * 1_000_000_000n / span) / 1_000_000_000;
    return Object.freeze({
        regimeIndex: regime.index,
        minimum: regime.minimum,
        maximum: regime.maximum,
        majorInterval: regime.majorInterval,
        minorInterval: regime.majorInterval / regime.subdivisions,
        subdivisions: regime.subdivisions,
        lower: safeWhole(lower, 'Band lower boundary'),
        upper: safeWhole(upper, 'Band upper boundary'),
        progress,
    });
}

export function valuationToLogicalCoordinate(value) {
    const parts = decimalParts(value);
    const regime = regimeForParts(parts);
    const offset = parts.numerator - BigInt(regime.minimum) * parts.denominator;
    const span = BigInt(regime.majorInterval) * parts.denominator;
    const completed = offset / span;
    const remainder = offset % span;
    const completedNumber = Number(completed);
    if (!Number.isFinite(completedNumber)) throw new RangeError('Valuation coordinate exceeds numeric range');
    const progress = Number(remainder * 1_000_000_000n / span) / 1_000_000_000;
    return regime.baseCoordinate + completedNumber + progress;
}

export function logicalCoordinateToValuation(coordinate) {
    if (!Number.isFinite(coordinate) || coordinate < 0) throw new TypeError('Logical coordinate must be finite and non-negative');
    let regimeIndex = MARKET_BAND_POLICY.length - 1;
    for (let index = 0; index < MARKET_BAND_POLICY.length - 1; index += 1) {
        if (coordinate < BASE_COORDINATES[index + 1]) { regimeIndex = index; break; }
    }
    const regime = MARKET_BAND_POLICY[regimeIndex];
    const value = regime.minimum + (coordinate - BASE_COORDINATES[regimeIndex]) * regime.majorInterval;
    if (!Number.isFinite(value)) throw new RangeError('Logical coordinate cannot be represented as a valuation');
    return value;
}

export function formatValuation(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return '—';
    const units = [
        { threshold: 1_000_000_000, divisor: 1_000_000_000, suffix: 'B' },
        { threshold: 1_000_000, divisor: 1_000_000, suffix: 'M' },
        { threshold: 1_000, divisor: 1_000, suffix: 'K' },
    ];
    const unit = units.find((candidate) => numeric >= candidate.threshold);
    if (!unit) return `$${Math.round(numeric)}`;
    const scaled = numeric / unit.divisor;
    const decimals = scaled < 10 && !Number.isInteger(scaled) ? 1 : 0;
    return `$${scaled.toFixed(decimals).replace(/\.0$/, '')}${unit.suffix}`;
}

function nextBoundary(value) {
    return marketBand(value).upper;
}

function previousBoundary(value) {
    const band = marketBand(value);
    if (value > band.lower) return band.lower;
    if (value <= 0) return 0;
    const interval = value === band.minimum && band.regimeIndex > 0
        ? MARKET_BAND_POLICY[band.regimeIndex - 1].majorInterval
        : band.majorInterval;
    return value - interval;
}

export function createBandTraversal(startValuation, targetValuation, options = {}) {
    const start = Number(startValuation);
    const target = Number(targetValuation);
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(target) || target < 0) {
        throw new TypeError('Traversal valuations must be finite and non-negative');
    }
    const startCoordinate = valuationToLogicalCoordinate(String(startValuation));
    const targetCoordinate = valuationToLogicalCoordinate(String(targetValuation));
    const direction = target > start ? 'BULLISH' : target < start ? 'BEARISH' : 'SIDEWAYS';
    const crossedCount = direction === 'BULLISH'
        ? Math.max(0, Math.floor(targetCoordinate + 1e-9) - Math.floor(startCoordinate + 1e-9))
        : direction === 'BEARISH'
            ? Math.max(0, Math.ceil(startCoordinate - 1e-9) - Math.ceil(targetCoordinate - 1e-9))
            : 0;
    const limit = options.maxBoundaries ?? MARKET_TERRAIN_POLICY.maxTraversalBoundaries;
    const boundaries = [];
    if (direction === 'BULLISH') {
        for (let boundary = nextBoundary(start); boundary <= target && boundaries.length < limit; boundary = nextBoundary(boundary)) {
            boundaries.push(boundary);
        }
    } else if (direction === 'BEARISH') {
        for (let boundary = previousBoundary(start); boundary >= target && boundaries.length < limit; boundary = previousBoundary(boundary)) {
            boundaries.push(boundary);
            if (boundary === 0) break;
        }
    }
    const truncated = crossedCount > boundaries.length;
    return Object.freeze({
        startValuation: start,
        targetValuation: target,
        startCoordinate,
        targetCoordinate,
        direction,
        distance: Math.abs(targetCoordinate - startCoordinate),
        crossedCount,
        crossedMajorBands: Object.freeze(boundaries),
        truncated,
        firstCrossed: boundaries[0] ?? null,
        lastCrossed: truncated ? target : boundaries.at(-1) ?? null,
        sourceEpoch: options.sourceEpoch ?? null,
        movementCause: normalizeMovementCause(options.movementCause),
        observedAt: options.observedAt ?? null,
        syntheticExecutions: Object.freeze([]),
    });
}

export function normalizeMovementCause(cause) {
    return MOVEMENT_CAUSES[cause] || cause || 'RECOVERY_RECONCILIATION';
}

function viewportPolicy(width) {
    if (width >= MARKET_TERRAIN_POLICY.desktop.minimumWidth) return MARKET_TERRAIN_POLICY.desktop;
    if (width >= MARKET_TERRAIN_POLICY.tablet.minimumWidth) return MARKET_TERRAIN_POLICY.tablet;
    return MARKET_TERRAIN_POLICY.mobile;
}

export function createVisibleTerrainWindow(logicalCoordinate, viewportWidth = 1_280) {
    if (!Number.isFinite(logicalCoordinate) || logicalCoordinate < 0) return emptyWindow();
    const policy = viewportPolicy(viewportWidth);
    const anchorCoordinate = logicalCoordinate;
    const anchorBand = Math.floor(logicalCoordinate);
    const first = Math.max(0, anchorBand - policy.bandsBehind);
    const last = anchorBand + policy.bandsAhead + 1;
    const boundaries = [];
    const minorMarks = [];
    for (let coordinate = first; coordinate <= last; coordinate += 1) {
        const valuation = logicalCoordinateToValuation(coordinate);
        boundaries.push(Object.freeze({
            coordinate,
            valuation,
            label: formatValuation(valuation),
            localX: (coordinate - anchorCoordinate) * MARKET_TERRAIN_POLICY.worldUnitsPerBand,
            labelled: (coordinate - first) % policy.labelStride === 0,
        }));
        if (coordinate < last) {
            for (let subdivision = 1; subdivision < 5; subdivision += 1) {
                const minorCoordinate = coordinate + subdivision / 5;
                minorMarks.push(Object.freeze({ coordinate: minorCoordinate,
                    localX: (minorCoordinate - anchorCoordinate) * MARKET_TERRAIN_POLICY.worldUnitsPerBand }));
            }
        }
    }
    return Object.freeze({
        anchorCoordinate,
        bandsBehind: policy.bandsBehind,
        bandsAhead: policy.bandsAhead,
        boundaries: Object.freeze(boundaries),
        minorMarks: Object.freeze(minorMarks),
        objectBudget: Object.freeze({ majorBoundaries: boundaries.length, minorMarks: minorMarks.length,
            labels: boundaries.filter((boundary) => boundary.labelled).length, frontier: 1 }),
    });
}

function emptyWindow() {
    return Object.freeze({ anchorCoordinate: 0, bandsBehind: 0, bandsAhead: 0,
        boundaries: Object.freeze([]), minorMarks: Object.freeze([]),
        objectBudget: Object.freeze({ majorBoundaries: 0, minorMarks: 0, labels: 0, frontier: 0 }) });
}

function impactCategory(score) {
    if (score >= 0.82) return 'SHOCK';
    if (score >= 0.6) return 'EXTREME';
    if (score >= 0.35) return 'STRONG';
    return 'NORMAL';
}

function availableComponent(value, provenance) {
    return value === null || value === undefined || !Number.isFinite(value)
        ? Object.freeze({ available: false, value: null, provenance })
        : Object.freeze({ available: true, value, provenance });
}

export function scoreMarketImpact(executions, context = {}) {
    const verified = executions.filter(activeTrade);
    if (!verified.length || !IMPACT_CAUSES.has(normalizeMovementCause(context.movementCause))) return null;
    const buys = verified.filter((event) => event.isBuy).length;
    const sells = verified.length - buys;
    const direction = buys === sells ? 'MIXED' : buys > sells ? 'BULLISH' : 'BEARISH';
    const quoteAmounts = verified.map((event) => Number(event.quoteAmount)).filter((value) => Number.isFinite(value) && value > 0);
    const liquidityRatios = verified.map((event) => Number(event.liquidityRatio)).filter((value) => Number.isFinite(value) && value >= 0);
    const countScore = Math.min(1, Math.log2(verified.length + 1) / 5);
    const concentrationScore = verified.length < 2 ? 0 : Math.min(1, verified.length / 12);
    const imbalanceScore = Math.abs(buys - sells) / verified.length;
    const quoteScore = quoteAmounts.length ? Math.min(1, Math.log10(1 + quoteAmounts.reduce((sum, value) => sum + value, 0)) / 4) : null;
    const liquidityScore = liquidityRatios.length ? Math.min(1, Math.max(...liquidityRatios) * 8) : null;
    const valuationScore = Number.isFinite(context.percentageDelta)
        ? Math.min(1, Math.abs(context.percentageDelta) / 25) : null;
    const components = Object.freeze({
        executionCount: availableComponent(countScore, 'CHAIN_VERIFIED_EXECUTION_COUNT'),
        temporalConcentration: availableComponent(concentrationScore, 'CHAIN_VERIFIED_EXECUTION_WINDOW'),
        directionalImbalance: availableComponent(imbalanceScore, 'CHAIN_VERIFIED_EXECUTION_DIRECTION'),
        quoteMagnitude: availableComponent(quoteScore, 'CHAIN_VERIFIED_QUOTE_AMOUNTS'),
        liquidityRatio: availableComponent(liquidityScore, 'VERIFIED_OR_EXPLICIT_POOL_LIQUIDITY_RATIO'),
        valuationDelta: availableComponent(valuationScore, 'CANONICAL_VALUATION_DELTA'),
    });
    const weights = { executionCount: 0.2, temporalConcentration: 0.18, directionalImbalance: 0.18,
        quoteMagnitude: 0.14, liquidityRatio: 0.18, valuationDelta: 0.12 };
    let weighted = 0;
    let availableWeight = 0;
    for (const [name, component] of Object.entries(components)) {
        if (!component.available) continue;
        weighted += component.value * weights[name];
        availableWeight += weights[name];
    }
    const score = availableWeight ? Math.min(1, weighted / availableWeight) : 0;
    return Object.freeze({ direction, category: impactCategory(score), score,
        verifiedExecutionCount: verified.length, buys, sells,
        timeWindowMs: context.timeWindowMs ?? 0,
        valuationDelta: context.valuationDelta ?? null,
        percentageDelta: context.percentageDelta ?? null,
        crossedBands: context.crossedBands ?? 0,
        cause: normalizeMovementCause(context.movementCause), components });
}

export function createMarketTerrain(tokenMint, options = {}) {
    if (typeof tokenMint !== 'string' || !tokenMint) throw new TypeError('Terrain requires a token mint');
    const policy = { ...MARKET_TERRAIN_POLICY, ...options.policy };
    let current = null;
    let presentationCoordinate = null;
    let targetCoordinate = null;
    let lastAdvanceAt = null;
    let status = 'WAITING';
    let traversal = null;
    let rebase = null;
    let impact = null;
    let executions = [];
    let supersededTraversals = 0;

    function clearImpactWindow(now) {
        executions = executions.filter((event) => now - event.timestamp <= policy.impactWindowMs).slice(-policy.maxImpactExecutions);
    }

    function snapshot(viewportWidth = 1_280) {
        const logicalCoordinate = current ? valuationToLogicalCoordinate(current.valueUsd) : null;
        const band = current ? marketBand(current.valueUsd) : null;
        const window = presentationCoordinate === null ? emptyWindow() : createVisibleTerrainWindow(presentationCoordinate, viewportWidth);
        const distance = presentationCoordinate === null || targetCoordinate === null ? 0 : Math.abs(targetCoordinate - presentationCoordinate);
        return Object.freeze({
            tokenMint,
            status,
            authoritativeValuation: current ? Number(current.valueUsd) : null,
            valuationLabel: current ? formatValuation(current.valueUsd) : '—',
            valuationKind: current?.kind ?? null,
            logicalCoordinate,
            presentationCoordinate,
            targetCoordinate,
            presentationLocalX: presentationCoordinate === null ? null
                : (presentationCoordinate - window.anchorCoordinate) * policy.worldUnitsPerBand,
            targetLocalX: targetCoordinate === null ? null
                : (targetCoordinate - window.anchorCoordinate) * policy.worldUnitsPerBand,
            direction: traversal?.direction ?? 'SIDEWAYS',
            freshness: current?.freshness ?? 'DEGRADED',
            sourceEpoch: current?.sourceEpoch ?? null,
            movementCause: normalizeMovementCause(current?.movementCause),
            visualDebtMs: Math.min(policy.maxVisualDebtMs, distance / policy.maxPresentationSpeedBandsPerSecond * 1_000),
            band,
            traversal,
            rebase,
            impact,
            supersededTraversals,
            window,
        });
    }

    return Object.freeze({
        observeValuation(value, now = Date.now()) {
            if (!value || value.authorityEligible !== true || value.freshness !== 'FRESH') {
                status = current ? 'DEGRADED' : 'WAITING';
                impact = null;
                return snapshot();
            }
            if (value.tokenMint !== tokenMint || value.kind !== 'PROTOCOL_MARKET_CAP'
                || typeof value.valueUsd !== 'string' || Number(value.valueUsd) <= 0) return snapshot();
            const nextCoordinate = valuationToLogicalCoordinate(value.valueUsd);
            if (!current) {
                current = value;
                presentationCoordinate = nextCoordinate;
                targetCoordinate = nextCoordinate;
                lastAdvanceAt = now;
                status = 'LIVE';
                traversal = null;
                rebase = null;
                return snapshot();
            }
            if (value.sourceEpoch < current.sourceEpoch) return snapshot();
            if (value.sourceEpoch !== current.sourceEpoch) {
                rebase = Object.freeze({ fromSourceEpoch: current.sourceEpoch, toSourceEpoch: value.sourceEpoch,
                    fromValuation: Number(current.valueUsd), toValuation: Number(value.valueUsd), at: now });
                current = value;
                presentationCoordinate = nextCoordinate;
                targetCoordinate = nextCoordinate;
                lastAdvanceAt = now;
                traversal = null;
                impact = null;
                executions = [];
                status = 'LIVE';
                return snapshot();
            }
            if (nextCoordinate === targetCoordinate) {
                current = value;
                status = 'LIVE';
                return snapshot();
            }
            const previous = current;
            if (traversal && presentationCoordinate !== targetCoordinate) supersededTraversals += 1;
            traversal = createBandTraversal(previous.valueUsd, value.valueUsd, {
                sourceEpoch: value.sourceEpoch,
                movementCause: value.movementCause,
                observedAt: value.nativeObservedAt,
                maxBoundaries: policy.maxTraversalBoundaries,
            });
            current = value;
            targetCoordinate = nextCoordinate;
            lastAdvanceAt = now;
            status = 'LIVE';
            const previousValue = Number(previous.valueUsd);
            const nextValue = Number(value.valueUsd);
            const percentageDelta = previousValue > 0 ? (nextValue - previousValue) / previousValue * 100 : null;
            clearImpactWindow(now);
            impact = scoreMarketImpact(executions, { movementCause: value.movementCause,
                valuationDelta: nextValue - previousValue, percentageDelta,
                crossedBands: traversal.crossedCount, timeWindowMs: policy.impactWindowMs });
            return snapshot();
        },
        observeExecution(event, now = Date.now()) {
            if (status !== 'LIVE' || !current || !activeTrade(event) || event.tokenMint !== tokenMint
                || event.sourceEpoch !== current.sourceEpoch) return snapshot();
            const timestamp = Number.isFinite(event.timestamp) ? event.timestamp : now;
            executions.push({ ...event, timestamp });
            clearImpactWindow(now);
            impact = scoreMarketImpact(executions, { movementCause: current.movementCause,
                crossedBands: traversal?.crossedCount ?? 0, timeWindowMs: policy.impactWindowMs });
            if (impact) {
                impact = Object.freeze({ ...impact,
                    clusterType: impact.direction === 'BULLISH' ? 'CLUSTERED_BUY_WAVE'
                        : impact.direction === 'BEARISH' ? 'CLUSTERED_SELL_WAVE' : 'RAPID_EXECUTION_CLUSTER',
                    evidence: Object.freeze(executions.slice(-policy.maxImpactEvidence).map((item) => item.id)),
                    evidenceTruncated: executions.length > policy.maxImpactEvidence,
                });
            }
            return snapshot();
        },
        reconcileExecution(event, now = Date.now()) {
            if (!event?.id) return snapshot();
            executions = executions.filter((item) => item.id !== event.id);
            if (status === 'LIVE' && current && activeTrade(event) && event.tokenMint === tokenMint
                && event.sourceEpoch === current.sourceEpoch) {
                const timestamp = Number.isFinite(event.timestamp) ? event.timestamp : now;
                executions.push({ ...event, timestamp });
            }
            clearImpactWindow(now);
            impact = scoreMarketImpact(executions, { movementCause: current?.movementCause,
                crossedBands: traversal?.crossedCount ?? 0, timeWindowMs: policy.impactWindowMs });
            return snapshot();
        },
        advance(now = Date.now(), viewportWidth = 1_280) {
            if (presentationCoordinate === null || targetCoordinate === null) return snapshot(viewportWidth);
            const elapsedMs = lastAdvanceAt === null ? 0 : Math.max(0, now - lastAdvanceAt);
            lastAdvanceAt = now;
            const distance = targetCoordinate - presentationCoordinate;
            if (Math.abs(distance) < 1e-6 || elapsedMs <= 0) return snapshot(viewportWidth);
            if (elapsedMs >= policy.snapAfterHiddenMs) {
                presentationCoordinate = targetCoordinate;
                return snapshot(viewportWidth);
            }
            const responseStep = Math.abs(distance) * (1 - Math.exp(-policy.responsePerSecond * elapsedMs / 1_000));
            const maximumStep = policy.maxPresentationSpeedBandsPerSecond * elapsedMs / 1_000;
            const step = Math.min(Math.abs(distance), Math.max(responseStep, Math.min(Math.abs(distance), maximumStep * 0.2)), maximumStep);
            presentationCoordinate += Math.sign(distance) * step;
            if (Math.abs(targetCoordinate - presentationCoordinate) < 1e-4) presentationCoordinate = targetCoordinate;
            return snapshot(viewportWidth);
        },
        degrade() { status = current ? 'DEGRADED' : 'WAITING'; impact = null; return snapshot(); },
        reset() {
            current = null; presentationCoordinate = null; targetCoordinate = null; lastAdvanceAt = null;
            status = 'WAITING'; traversal = null; rebase = null; impact = null; executions = []; supersededTraversals = 0;
            return snapshot();
        },
        getSnapshot: snapshot,
        getDiagnostics(viewportWidth = 1_280) {
            const result = snapshot(viewportWidth);
            return { ...result, impactEvidenceCount: executions.length,
                budgets: { maxTraversalBoundaries: policy.maxTraversalBoundaries,
                    maxImpactExecutions: policy.maxImpactExecutions, maxImpactEvidence: policy.maxImpactEvidence } };
        },
    });
}
