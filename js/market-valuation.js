import { positive } from './market-selection.js';

export const VALUATION_POLICY = Object.freeze({ staleAfterMs: 30_000, corroborationAgeMs: 15_000, priceTolerance: 0.05, basisRelativeTolerance: .01 });

export function providerValuation({ tokenMint, marketIdentity = null, source, priceUsd,
    marketCap = null, fdv = null, supplyBasis = null, observedAt = null, receivedAt = Date.now() }) {
    const mc = positive(marketCap);
    const diluted = positive(fdv);
    const price = positive(priceUsd);
    const kind = !price ? 'UNKNOWN' : mc ? 'MARKET_CAP' : diluted ? 'FDV' : 'UNKNOWN';
    return {
        tokenMint, marketIdentity, source, priceUsd: price,
        kind, valueUsd: kind === 'MARKET_CAP' ? mc : kind === 'FDV' ? diluted : null,
        supplyBasis, observedAt, receivedAt, sourceEpoch: 0,
        raw: { marketCap: mc, fdv: diluted },
        freshness: kind === 'UNKNOWN' ? 'UNAVAILABLE' : 'DEGRADED',
        evidenceLevel: 'PROVIDER_INDICATIVE', authorityEligible: false,
        provenance: { valuation: kind === 'UNKNOWN' ? 'UNAVAILABLE'
            : supplyBasis ? 'DERIVED_FDV' : kind === 'MARKET_CAP' ? 'PROVIDER_MARKET_CAP' : 'PROVIDER_FDV',
        time: observedAt === null ? 'PROVIDER_OBSERVATION_TIME_UNKNOWN' : 'PROVIDER_TIMESTAMP' },
    };
}

export function valuationIdentity(v) {
    return JSON.stringify([v.tokenMint, v.source, v.marketIdentity, v.kind, v.supplyBasis]);
}

// Token-scoped and monotonic. A source/base change is a rebase, never a trade.
export function createValuationBoundary(tokenMint) {
    let current = null;
    let epoch = 0;
    return {
        accept(candidate, now = Date.now()) {
            if (!candidate || candidate.tokenMint !== tokenMint || !Number.isFinite(candidate.receivedAt)
                || !['MARKET_CAP', 'FDV', 'UNKNOWN'].includes(candidate.kind)
                || !['dexscreener', 'helius-fallback'].includes(candidate.source)
                || (candidate.kind !== 'UNKNOWN' && (!positive(candidate.valueUsd) || !positive(candidate.priceUsd)))
                || candidate.receivedAt > now || candidate.receivedAt < (current?.receivedAt ?? 0)
                || (candidate.observedAt !== null && (!Number.isFinite(candidate.observedAt) || candidate.observedAt > now))) return null;
            if (current && valuationIdentity(current) === valuationIdentity(candidate)
                && candidate.observedAt !== null && current.observedAt !== null && candidate.observedAt < current.observedAt) return null;
            const priorBasis = current?.valueUsd / current?.priceUsd;
            const nextBasis = candidate.valueUsd / candidate.priceUsd;
            const basisChanged = positive(priorBasis) && positive(nextBasis)
                && Math.abs(nextBasis / priorBasis - 1) > VALUATION_POLICY.basisRelativeTolerance;
            const rebase = !current || valuationIdentity(current) !== valuationIdentity(candidate) || basisChanged;
            if (rebase) epoch += 1;
            current = { ...candidate, evidenceLevel: 'PROVIDER_INDICATIVE', authorityEligible: false,
                sourceEpoch: epoch, movementCause: basisChanged ? 'VALUATION_BASIS_REBASE'
                : rebase ? 'SOURCE_REBASE' : 'PROVIDER_UPDATE' };
            return current;
        },
        snapshot(now = Date.now()) {
            if (!current) return null;
            return { ...current, freshness: now - current.receivedAt > VALUATION_POLICY.staleAfterMs ? 'STALE' : current.freshness };
        },
    };
}

// Diagnostic evidence classification for M10.2; no impact/terrain/shock logic.
// Repeated snapshots from the same provider or browser estimates never qualify.
export function corroborateValuation(previous, next, observation, now = Date.now()) {
    if (!previous || !next || valuationIdentity(previous) !== valuationIdentity(next)
        || previous.sourceEpoch !== next.sourceEpoch) return { status: 'SOURCE_REBASE', authorityEligible: false };
    if (!positive(next.priceUsd) || !positive(next.valueUsd)) return { status: 'UNAVAILABLE', authorityEligible: false };
    const e = observation;
    if (e?.evidenceLevel !== 'CHAIN_VERIFIED' || e.tokenMint !== next.tokenMint
        || !['CONFIRMED', 'FINALIZED'].includes(e.settlement) || e.poolAddress !== next.marketIdentity
        || !Number.isFinite(e.blockTime) || now - e.blockTime * 1000 < 0
        || now - e.blockTime * 1000 > VALUATION_POLICY.corroborationAgeMs
        || !positive(e.executionPriceUsd) || e.priceProvenance !== 'INDEPENDENT_QUOTE') {
        return { status: 'UNCORROBORATED', authorityEligible: false };
    }
    const agrees = Math.abs(e.executionPriceUsd / next.priceUsd - 1) <= VALUATION_POLICY.priceTolerance;
    return { status: agrees ? 'PRICE_CORROBORATED' : 'DISAGREEMENT',
        // Executed price corroborates price, not circulating supply or MC.
        authorityEligible: false, priceCorroborated: agrees, evidenceId: e.id };
}

export function valuationLabel(valuation) {
    return valuation?.kind === 'MARKET_CAP' ? 'MC' : valuation?.kind === 'FDV' ? 'FDV' : 'VALUATION';
}
