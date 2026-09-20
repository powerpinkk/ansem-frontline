/* global process, console, setImmediate */
import { performance } from 'node:perf_hooks';
import { createMarketTerrain, MARKET_TERRAIN_POLICY } from '../js/market-terrain.js';

const durationMs = Number(process.env.TERRAIN_SOAK_DURATION_MS || 60_000);
const tokens = ['terrain-soak-ansem', 'terrain-soak-usdc', 'terrain-soak-jup', 'terrain-soak-generic'];
const values = [
    100_000, 600_000, 200_000,
    995_000, 1_005_000, 998_000, 1_010_000,
    1_000_000, 10_000_000, 50_000_000,
    1_200_000, 1_180_000, 1_210_000,
];

let tokenIndex = 0;
let sourceEpoch = 1;
let terrain = createMarketTerrain(tokens[tokenIndex]);
let logicalNow = 1_000;
let iterations = 0;
let switches = 0;
let rebases = 0;
let degradedRecoveries = 0;
let firstHalfProcessingMs = 0;
let firstHalfSamples = 0;
let secondHalfProcessingMs = 0;
let secondHalfSamples = 0;
const maxima = { majorBoundaries: 0, minorMarks: 0, labels: 0, impactEvidence: 0, traversalBoundaries: 0 };

function canonicalValuation(value, movementCause = 'TOKEN_PRICE_UPDATE') {
    return {
        tokenMint: tokens[tokenIndex], marketIdentity: `market-${tokens[tokenIndex]}`, sourceEpoch,
        kind: 'PROTOCOL_MARKET_CAP', protocolDefinition: 'PUMP_PROTOCOL_MARKET_CAP_V1',
        valueUsd: String(value), freshness: 'FRESH', authorityEligible: true,
        nativeObservedAt: logicalNow, movementCause,
    };
}

function execution(index, isBuy) {
    const signature = `terrain-soak-${index}`;
    const poolAddress = `market-${tokens[tokenIndex]}`;
    const executionOrder = { outerIndex: 0, innerIndex: null, transactionIndex: null };
    return {
        id: `${tokens[tokenIndex]}:${signature}:${poolAddress}:0.outer:pool-v1`,
        tokenMint: tokens[tokenIndex], signature, poolAddress, marketIdentity: poolAddress, sourceEpoch,
        evidenceLevel: 'CHAIN_VERIFIED', verificationVersion: 'pool-execution-v1',
        settlement: 'CONFIRMED', economicScope: 'CANONICAL_POOL_EXECUTION', executionOrder,
        invocationPath: '0.outer', slot: index + 1, timestamp: logicalNow, isBuy,
        rawTokenAmount: '1000000', rawQuoteAmount: '25000000', quoteAmount: 0.025 + index % 40,
        liquidityRatio: (index % 8) / 100,
    };
}

function observeMaxima(snapshot) {
    maxima.majorBoundaries = Math.max(maxima.majorBoundaries, snapshot.window.objectBudget.majorBoundaries);
    maxima.minorMarks = Math.max(maxima.minorMarks, snapshot.window.objectBudget.minorMarks);
    maxima.labels = Math.max(maxima.labels, snapshot.window.objectBudget.labels);
    maxima.impactEvidence = Math.max(maxima.impactEvidence, terrain.getDiagnostics().impactEvidenceCount);
    maxima.traversalBoundaries = Math.max(maxima.traversalBoundaries, snapshot.traversal?.crossedMajorBands.length || 0);
}

function assertBounded() {
    if (maxima.majorBoundaries > 10 || maxima.minorMarks > 36 || maxima.labels > 10
        || maxima.impactEvidence > MARKET_TERRAIN_POLICY.maxImpactExecutions
        || maxima.traversalBoundaries > MARKET_TERRAIN_POLICY.maxTraversalBoundaries) {
        throw new Error(`Terrain budget exceeded: ${JSON.stringify(maxima)}`);
    }
}

globalThis.gc?.();
const heapBefore = process.memoryUsage().heapUsed;
const startedAt = performance.now();
terrain.observeValuation(canonicalValuation(values[0]), logicalNow);

while (performance.now() - startedAt < durationMs) {
    const batchStartedAt = performance.now();
    for (let batch = 0; batch < 256; batch += 1) {
        iterations += 1;
        logicalNow += 20;
        if (iterations % 500 === 0) {
            tokenIndex = (tokenIndex + 1) % tokens.length;
            sourceEpoch = 1;
            terrain = createMarketTerrain(tokens[tokenIndex]);
            terrain.observeValuation(canonicalValuation(values[iterations % values.length]), logicalNow);
            switches += 1;
        }
        let cause = 'TOKEN_PRICE_UPDATE';
        if (iterations % 97 === 0) cause = 'QUOTE_USD_FX_UPDATE';
        if (iterations % 223 === 0) cause = 'SUPPLY_BASIS_CHANGE';
        if (iterations % 389 === 0) { sourceEpoch += 1; cause = 'SOURCE_REBASE'; rebases += 1; }
        if (iterations % 173 === 0) {
            terrain.degrade();
            cause = 'STATE_RECONCILIATION';
            degradedRecoveries += 1;
        }
        const snapshot = terrain.observeValuation(canonicalValuation(values[iterations % values.length], cause), logicalNow);
        if (iterations % 3 === 0 && cause === 'TOKEN_PRICE_UPDATE') terrain.observeExecution(execution(iterations, iterations % 5 !== 0), logicalNow);
        observeMaxima(terrain.advance(logicalNow + 16, iterations % 7 === 0 ? 390 : iterations % 11 === 0 ? 820 : 1_440));
        if (snapshot.status !== 'LIVE') throw new Error(`Unexpected terrain status ${snapshot.status}`);
    }
    const batchMs = performance.now() - batchStartedAt;
    if (performance.now() - startedAt < durationMs / 2) {
        firstHalfProcessingMs += batchMs;
        firstHalfSamples += 256;
    } else {
        secondHalfProcessingMs += batchMs;
        secondHalfSamples += 256;
    }
    assertBounded();
    await new Promise((resolve) => setImmediate(resolve));
}

globalThis.gc?.();
const heapAfter = process.memoryUsage().heapUsed;
const firstHalfAverageUs = firstHalfProcessingMs / Math.max(1, firstHalfSamples) * 1_000;
const secondHalfAverageUs = secondHalfProcessingMs / Math.max(1, secondHalfSamples) * 1_000;
if (secondHalfAverageUs > firstHalfAverageUs * 3 + 25) {
    throw new Error(`Progressive slowdown detected: ${firstHalfAverageUs.toFixed(3)}us -> ${secondHalfAverageUs.toFixed(3)}us`);
}

console.log(JSON.stringify({
    durationMs: Math.round(performance.now() - startedAt), iterations, switches, rebases, degradedRecoveries,
    maxima, firstHalfAverageUs, secondHalfAverageUs, heapDeltaBytes: heapAfter - heapBefore,
    controllerTimers: 0, controllerListeners: 0,
}, null, 2));
