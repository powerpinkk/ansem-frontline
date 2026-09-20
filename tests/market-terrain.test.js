import { describe, expect, it } from 'vitest';
import {
    MARKET_BAND_POLICY,
    MARKET_TERRAIN_POLICY,
    createBandTraversal,
    createMarketTerrain,
    createVisibleTerrainWindow,
    formatValuation,
    logicalCoordinateToValuation,
    marketBand,
    scoreMarketImpact,
    valuationToLogicalCoordinate,
} from '../js/market-terrain.js';
import { canonicalEvent, MINT } from './fixtures/integrity.js';

const valuation = (value, overrides = {}) => ({
    tokenMint: MINT,
    marketIdentity: 'canonical-market',
    sourceEpoch: 1,
    kind: 'PROTOCOL_MARKET_CAP',
    protocolDefinition: 'PUMP_PROTOCOL_MARKET_CAP_V1',
    valueUsd: String(value),
    freshness: 'FRESH',
    authorityEligible: true,
    nativeObservedAt: 1_000,
    movementCause: 'TOKEN_PRICE_UPDATE',
    ...overrides,
});

describe('market terrain band policy', () => {
    it('keeps the exact product intervals centralized', () => {
        expect(MARKET_BAND_POLICY.map(({ minimum, maximum, majorInterval }) => [minimum, maximum, majorInterval])).toEqual([
            [0, 10_000, 1_000],
            [10_000, 100_000, 10_000],
            [100_000, 1_000_000, 50_000],
            [1_000_000, 100_000_000, 500_000],
            [100_000_000, 1_000_000_000, 1_000_000],
            [1_000_000_000, 100_000_000_000, 500_000_000],
            [100_000_000_000, Number.POSITIVE_INFINITY, 5_000_000_000],
        ]);
    });

    it.each([
        [0, 1_000, 0, 1_000, 200],
        [9_999, 1_000, 9_000, 10_000, 200],
        [10_000, 10_000, 10_000, 20_000, 2_000],
        [100_000, 50_000, 100_000, 150_000, 10_000],
        [1_000_000, 500_000, 1_000_000, 1_500_000, 100_000],
        [100_000_000, 1_000_000, 100_000_000, 101_000_000, 200_000],
        [1_000_000_000, 500_000_000, 1_000_000_000, 1_500_000_000, 100_000_000],
        [100_000_000_000, 5_000_000_000, 100_000_000_000, 105_000_000_000, 1_000_000_000],
    ])('maps exact boundary %s with lower-inclusive semantics', (value, interval, lower, upper, minor) => {
        expect(marketBand(value)).toMatchObject({ majorInterval: interval, lower, upper, minorInterval: minor, subdivisions: 5 });
    });

    it('places 1.2M exactly 40 percent through the 1M to 1.5M band', () => {
        expect(marketBand('1200000')).toMatchObject({ lower: 1_000_000, upper: 1_500_000, progress: 0.4 });
    });

    it.each([500, 5_000, 50_000, 500_000, 5_000_000, 500_000_000, 5_000_000_000, 50_000_000_000, 500_000_000_000])('round-trips the cumulative scale at %s', (value) => {
        const coordinate = valuationToLogicalCoordinate(String(value));
        expect(Number.isFinite(coordinate)).toBe(true);
        expect(logicalCoordinateToValuation(coordinate)).toBeCloseTo(value, 5);
    });

    it.each([10_000, 100_000, 1_000_000, 100_000_000, 1_000_000_000, 100_000_000_000])('is continuous around regime boundary %s', (boundary) => {
        const before = valuationToLogicalCoordinate(String(boundary - boundary / 1_000_000));
        const exact = valuationToLogicalCoordinate(String(boundary));
        const after = valuationToLogicalCoordinate(String(boundary + boundary / 1_000_000));
        expect(before).toBeLessThan(exact);
        expect(after).toBeGreaterThan(exact);
        expect(exact - before).toBeLessThan(0.001);
        expect(after - exact).toBeLessThan(0.001);
    });

    it('does not flap or jump across the 1M policy boundary', () => {
        const coordinates = [995_000, 1_005_000, 998_000, 1_010_000].map((value) => valuationToLogicalCoordinate(String(value)));
        expect(coordinates).toEqual([36.9, 37.01, 36.96, 37.02]);
    });

    it.each([
        [999, '$999'], [1_000, '$1K'], [10_000, '$10K'], [100_000, '$100K'], [1_000_000, '$1M'],
        [1_200_000, '$1.2M'], [100_000_000, '$100M'], [1_000_000_000, '$1B'],
        [1_500_000_000, '$1.5B'], [100_000_000_000, '$100B'], [105_000_000_000, '$105B'],
    ])('formats %s as %s', (value, expected) => expect(formatValuation(value)).toBe(expected));
});

describe('band traversal and bounded windows', () => {
    it('enumerates 100K to 600K exactly without synthetic executions', () => {
        const traversal = createBandTraversal(100_000, 600_000, { sourceEpoch: 3, movementCause: 'TOKEN_PRICE_UPDATE' });
        expect(traversal.direction).toBe('BULLISH');
        expect(traversal.crossedMajorBands).toEqual([
            150_000, 200_000, 250_000, 300_000, 350_000,
            400_000, 450_000, 500_000, 550_000, 600_000,
        ]);
        expect(traversal.targetValuation).toBe(600_000);
        expect(traversal.syntheticExecutions).toEqual([]);
    });

    it('enumerates the reverse boundaries once in bearish order', () => {
        expect(createBandTraversal(600_000, 100_000).crossedMajorBands).toEqual([
            550_000, 500_000, 450_000, 400_000, 350_000,
            300_000, 250_000, 200_000, 150_000, 100_000,
        ]);
    });

    it('counts a boundary crossed by a small fractional move in either direction', () => {
        const bullish = createBandTraversal(149_000, 151_000);
        const bearish = createBandTraversal(151_000, 149_000);
        expect(bullish).toMatchObject({ crossedCount: 1, crossedMajorBands: [150_000] });
        expect(bearish).toMatchObject({ crossedCount: 1, crossedMajorBands: [150_000] });
    });

    it.each([[90_000, 150_000], [950_000, 1_200_000], [90_000_000, 110_000_000],
        [950_000_000, 1_200_000_000], [95_000_000_000, 105_000_000_000]])('crosses regimes monotonically for %s to %s', (start, target) => {
        const traversal = createBandTraversal(start, target);
        expect(traversal.targetCoordinate).toBeGreaterThan(traversal.startCoordinate);
        expect(new Set(traversal.crossedMajorBands).size).toBe(traversal.crossedMajorBands.length);
    });

    it.each([[1_000_000, 10_000_000], [1_000_000, 50_000_000], [50_000_000, 10_000_000]])('bounds traversal metadata and visible allocation for extreme move %s to %s', (start, target) => {
        const traversal = createBandTraversal(start, target);
        expect(traversal.crossedMajorBands.length).toBeLessThanOrEqual(MARKET_TERRAIN_POLICY.maxTraversalBoundaries);
        const window = createVisibleTerrainWindow(traversal.targetCoordinate, 1_280);
        expect(window.objectBudget.majorBoundaries).toBeLessThanOrEqual(10);
        expect(window.objectBudget.minorMarks).toBeLessThanOrEqual(36);
    });

    it('reduces labels and geometry on mobile without changing the financial coordinate', () => {
        const coordinate = valuationToLogicalCoordinate('1200000');
        const desktop = createVisibleTerrainWindow(coordinate, 1_440);
        const mobile = createVisibleTerrainWindow(coordinate, 390);
        expect(mobile.boundaries.length).toBeLessThan(desktop.boundaries.length);
        expect(mobile.objectBudget.labels).toBeLessThan(desktop.objectBudget.labels);
        expect(mobile.anchorCoordinate).toBe(desktop.anchorCoordinate);
    });
});

describe('market frontier authority and presentation', () => {
    it('initializes around 20M without a fake zero-to-market traversal', () => {
        const terrain = createMarketTerrain(MINT);
        const result = terrain.observeValuation(valuation(20_000_000, { movementCause: 'SOURCE_REBASE' }), 1_000);
        expect(result.authoritativeValuation).toBe(20_000_000);
        expect(result.presentationCoordinate).toBe(result.targetCoordinate);
        expect(result.traversal).toBeNull();
        expect(result.impact).toBeNull();
    });

    it('treats a repeated authoritative value as an idempotent refresh', () => {
        const terrain = createMarketTerrain(MINT);
        terrain.observeValuation(valuation(20_000_000), 1_000);
        const result = terrain.observeValuation(valuation(20_000_000), 1_050);
        expect(result.traversal).toBeNull();
        expect(result.presentationCoordinate).toBe(result.targetCoordinate);
        expect(result.authoritativeValuation).toBe(20_000_000);
    });

    it('rejects indicative, stale, degraded, Mayhem and foreign-token valuation authority', () => {
        const cases = [
            valuation(1_000_000, { authorityEligible: false }),
            valuation(1_000_000, { freshness: 'DEGRADED' }),
            valuation(1_000_000, { tokenMint: 'foreign' }),
            valuation(1_000_000, { authorityEligible: false, movementCause: 'UNSUPPORTED_MAYHEM' }),
        ];
        for (const value of cases) {
            const terrain = createMarketTerrain(MINT);
            expect(terrain.observeValuation(value).authoritativeValuation).toBeNull();
        }
    });

    it('retargets a rapid 100K to 600K to 200K reversal immediately', () => {
        const terrain = createMarketTerrain(MINT);
        terrain.observeValuation(valuation(100_000), 1_000);
        terrain.observeValuation(valuation(600_000), 1_100);
        const moving = terrain.advance(1_200);
        expect(moving.presentationCoordinate).not.toBe(moving.targetCoordinate);
        const reversed = terrain.observeValuation(valuation(200_000), 1_250);
        expect(reversed.authoritativeValuation).toBe(200_000);
        expect(reversed.targetCoordinate).toBe(valuationToLogicalCoordinate('200000'));
        expect(reversed.direction).toBe('BEARISH');
        expect(reversed.supersededTraversals).toBe(1);
        expect(reversed.visualDebtMs).toBeLessThanOrEqual(MARKET_TERRAIN_POLICY.maxVisualDebtMs);
    });

    it('uses latest reality after a background pause instead of replaying missed motion', () => {
        const terrain = createMarketTerrain(MINT);
        terrain.observeValuation(valuation(1_000_000), 1_000);
        terrain.observeValuation(valuation(50_000_000), 1_100);
        const resumed = terrain.advance(6_000);
        expect(resumed.presentationCoordinate).toBe(resumed.targetCoordinate);
    });

    it('treats a source epoch change as a rebase without traversal or impact', () => {
        const terrain = createMarketTerrain(MINT);
        terrain.observeValuation(valuation(1_000_000, { sourceEpoch: 1 }), 1_000);
        const result = terrain.observeValuation(valuation(10_000_000, {
            sourceEpoch: 2, movementCause: 'SOURCE_REBASE', marketIdentity: 'pumpswap-market',
        }), 1_100);
        expect(result.rebase).toMatchObject({ fromSourceEpoch: 1, toSourceEpoch: 2 });
        expect(result.presentationCoordinate).toBe(result.targetCoordinate);
        expect(result.traversal).toBeNull();
        expect(result.impact).toBeNull();
    });

    it('moves the USD frontier for FX without creating buy/sell impact', () => {
        const terrain = createMarketTerrain(MINT);
        terrain.observeValuation(valuation(1_000_000), 1_000);
        terrain.observeValuation(valuation(1_100_000, { movementCause: 'QUOTE_USD_FX_UPDATE' }), 1_100);
        const result = terrain.observeExecution(canonicalEvent({ timestamp: 1_150 }), 1_150);
        expect(result.targetCoordinate).toBeGreaterThan(result.presentationCoordinate);
        expect(result.movementCause).toBe('QUOTE_USD_FX_MOVE');
        expect(result.impact).toBeNull();
    });

    it.each(['SUPPLY_BASIS_CHANGE', 'PROVIDER_CORRECTION', 'STATE_RECONCILIATION'])('preserves %s frontier adjustment without inventing impact', (movementCause) => {
        const terrain = createMarketTerrain(MINT);
        terrain.observeValuation(valuation(1_000_000), 1_000);
        const result = terrain.observeValuation(valuation(1_200_000, { movementCause }), 1_100);
        expect(result.targetCoordinate).toBeGreaterThan(result.presentationCoordinate);
        expect(result.impact).toBeNull();
    });

    it('freezes the last authoritative target while degraded and reconciles on recovery', () => {
        const terrain = createMarketTerrain(MINT);
        terrain.observeValuation(valuation(1_000_000), 1_000);
        const live = terrain.observeValuation(valuation(2_000_000), 1_100);
        const frozen = terrain.observeValuation(null, 1_200);
        expect(frozen.status).toBe('DEGRADED');
        expect(frozen.targetCoordinate).toBe(live.targetCoordinate);
        const recovered = terrain.observeValuation(valuation(2_500_000, { movementCause: 'STATE_RECONCILIATION' }), 1_300);
        expect(recovered.status).toBe('LIVE');
        expect(recovered.authoritativeValuation).toBe(2_500_000);
    });

    it('isolates tokens and refuses a verified execution from another epoch', () => {
        const terrain = createMarketTerrain(MINT);
        terrain.observeValuation(valuation(1_000_000), 1_000);
        expect(terrain.observeExecution(canonicalEvent({ sourceEpoch: 2 }), 1_100).impact).toBeNull();
        expect(terrain.observeExecution(canonicalEvent({ tokenMint: 'foreign' }), 1_100).impact).toBeNull();
    });
});

describe('verified MarketImpact scoring and clustering', () => {
    it('uses evidence quality so equal notional has different impact in shallow liquidity', () => {
        const deep = canonicalEvent({ liquidityRatio: 0, quoteAmount: 25 });
        const shallow = canonicalEvent({ signature: '2'.repeat(64), liquidityRatio: 0.2, quoteAmount: 25 });
        const context = { movementCause: 'TOKEN_PRICE_UPDATE', percentageDelta: 1, timeWindowMs: 2_500 };
        const deepImpact = scoreMarketImpact([deep], context);
        const shallowImpact = scoreMarketImpact([shallow], context);
        expect(shallowImpact.score).toBeGreaterThan(deepImpact.score);
        expect(shallowImpact.category).not.toBe(deepImpact.category);
    });

    it('does not create trade shock for FX or source rebase', () => {
        const event = canonicalEvent();
        expect(scoreMarketImpact([event], { movementCause: 'QUOTE_USD_FX_UPDATE' })).toBeNull();
        expect(scoreMarketImpact([event], { movementCause: 'SOURCE_REBASE' })).toBeNull();
    });

    it('coalesces a bounded verified buy wave without claiming bundle identity', () => {
        const terrain = createMarketTerrain(MINT);
        terrain.observeValuation(valuation(1_000_000), 1_000);
        let result;
        for (let index = 0; index < 100; index += 1) {
            result = terrain.observeExecution(canonicalEvent({
                signature: `${String(index + 1).padStart(2, '1')}${'2'.repeat(62)}`,
                timestamp: 1_100 + index,
                slot: 100 + index,
            }), 1_200 + index);
        }
        expect(result.impact.clusterType).toBe('CLUSTERED_BUY_WAVE');
        expect(result.impact.verifiedExecutionCount).toBeLessThanOrEqual(MARKET_TERRAIN_POLICY.maxImpactExecutions);
        expect(result.impact.evidence.length).toBeLessThanOrEqual(MARKET_TERRAIN_POLICY.maxImpactEvidence);
        expect(JSON.stringify(result.impact)).not.toMatch(/bundle/i);
    });

    it('stays bounded through a deterministic mixed terrain soak', () => {
        const terrain = createMarketTerrain(MINT);
        terrain.observeValuation(valuation(100_000), 1_000);
        const sequence = [600_000, 200_000, 995_000, 1_005_000, 998_000, 1_010_000, 10_000_000, 50_000_000];
        for (let cycle = 0; cycle < 2_000; cycle += 1) {
            const value = sequence[cycle % sequence.length];
            terrain.observeValuation(valuation(value, { movementCause: cycle % 17 === 0 ? 'QUOTE_USD_FX_UPDATE' : 'TOKEN_PRICE_UPDATE' }), 1_100 + cycle * 10);
            terrain.advance(1_105 + cycle * 10, cycle % 3 === 0 ? 390 : 1_280);
        }
        const diagnostics = terrain.getDiagnostics(390);
        expect(diagnostics.window.objectBudget.majorBoundaries).toBeLessThanOrEqual(6);
        expect(diagnostics.window.objectBudget.minorMarks).toBeLessThanOrEqual(20);
        expect(diagnostics.traversal.crossedMajorBands.length).toBeLessThanOrEqual(MARKET_TERRAIN_POLICY.maxTraversalBoundaries);
        expect(diagnostics.impactEvidenceCount).toBeLessThanOrEqual(MARKET_TERRAIN_POLICY.maxImpactExecutions);
    });
});
