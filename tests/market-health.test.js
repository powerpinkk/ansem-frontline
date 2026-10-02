import { describe, expect, it } from 'vitest';
import { deriveMarketHealth, formatPriceDisplay } from '../js/market-health.js';

const authoritative = {
    authorityEligible: true,
    valueUsd: '178500000',
    unitPriceUsd: '0.1785',
    quoteFreshness: 'FRESH',
};

function state(overrides = {}) {
    return {
        price: 0.18,
        valuation: { kind: 'MARKET_CAP', valueUsd: 179_000_000 },
        canonicalValuation: authoritative,
        marketSelection: { pairAddress: 'provider-pool' },
        canonicalMarket: { address: 'verified-pool' },
        workerConnected: true,
        executionStreamStatus: 'online',
        integrity: { degraded: false, coverageIncomplete: false },
        liveTrades: [],
        lastTradeAt: 0,
        ...overrides,
    };
}

describe('market capability and status semantics', () => {
    it('never formats missing, invalid or zero price as a numeric zero', () => {
        expect(formatPriceDisplay(null)).toBe('—');
        expect(formatPriceDisplay(undefined)).toBe('—');
        expect(formatPriceDisplay(Number.NaN)).toBe('—');
        expect(formatPriceDisplay(0)).toBe('—');
        expect(formatPriceDisplay(0.18)).toBe('$0.180000');
    });

    it('keeps authoritative price and valuation available in a quiet verified market', () => {
        expect(deriveMarketHealth(state())).toMatchObject({
            priceAvailable: true,
            valuationState: 'AUTHORITATIVE',
            terrainAuthorityAvailable: true,
            executionStreamHealthy: true,
            pressureAvailable: true,
            flowState: 'QUIET',
            lastVerifiedExecutionAt: null,
            degradedReasons: [],
        });
    });

    it('preserves market state while independently marking the execution stream down', () => {
        const health = deriveMarketHealth(state({ executionStreamStatus: 'offline' }));
        expect(health).toMatchObject({ priceAvailable: true, valuationState: 'AUTHORITATIVE',
            terrainAuthorityAvailable: true, executionStreamHealthy: false, pressureAvailable: false, flowState: 'DEGRADED' });
        expect(health.degradedReasons).toContain('EXECUTION_STREAM_UNAVAILABLE');
    });

    it('keeps verified flow capability independent when valuation authority is absent', () => {
        const health = deriveMarketHealth(state({ canonicalValuation: null }));
        expect(health).toMatchObject({ valuationState: 'INDICATIVE', terrainAuthorityAvailable: false,
            executionStreamHealthy: true, pressureAvailable: true, flowState: 'QUIET' });
        expect(health.degradedReasons).toContain('VALUATION_AUTHORITY_UNAVAILABLE');
    });

    it('reports the production Helius gate without erasing indicative market data', () => {
        const health = deriveMarketHealth(state({ canonicalValuation: null, canonicalMarket: null,
            executionStreamStatus: 'offline', integrity: { degraded: true, identityFailure: 'RPC_HTTP_429',
                coverageIncomplete: true } }));
        expect(health).toMatchObject({ marketIdentityAvailable: true, canonicalMarketAvailable: false,
            priceState: 'INDICATIVE', valuationState: 'INDICATIVE', terrainAuthorityAvailable: false,
            executionStreamHealthy: false, flowState: 'DEGRADED' });
        expect(health.degradedReasons).toEqual(expect.arrayContaining([
            'RPC_RATE_LIMITED', 'NO_CANONICAL_MARKET', 'VALUATION_AUTHORITY_UNAVAILABLE',
            'EXECUTION_STREAM_UNAVAILABLE', 'EXECUTION_COVERAGE_INCOMPLETE',
        ]));
    });

    it('uses schema-v1 capabilities so old gaps and lifetime failures cannot poison a recovered quiet window', () => {
        const health = deriveMarketHealth(state({ price: 0, indicativePrice: 0, valuation: null,
            integrity: { rpcFailures: 9, coverageIncomplete: true, health: { schemaVersion: 1,
                discoveryAvailable: { available: true }, marketStateAvailable: { available: true },
                quoteUsdAvailable: { available: true }, valuationAvailable: { available: true },
                terrainAuthorityAvailable: { available: true }, executionStreamAvailable: { available: true },
                currentWindow: { complete: true }, historicalCoverage: { incomplete: true, totalGaps: 2 } } } }));
        expect(health).toMatchObject({ canonicalPriceAvailable: true, priceState: 'AUTHORITATIVE',
            valuationState: 'AUTHORITATIVE', terrainAuthorityAvailable: true,
            executionStreamHealthy: true, flowState: 'QUIET' });
        expect(health.degradedReasons).not.toContain('EXECUTION_RPC_FAILURES');
    });
});
