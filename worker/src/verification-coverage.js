export function verificationCategory(result) {
    if (result.event && ['CONFIRMED', 'FINALIZED'].includes(result.event.settlement)) return result.event.routeKind?.startsWith('JUPITER') ? 'verifiedRouted' : 'verifiedDirect';
    if (result.status === 'FAILED' || ['REJECTED', 'RECONCILIATION_UNKNOWN'].includes(result.event?.settlement)) return 'failedInvalid';
    if (result.reason === 'TRACKED_TOKEN_INTERMEDIATE') return 'intermediateOnly';
    if (result.reason === 'TRACKED_TOKEN_NOT_INVOLVED') return 'notInvolved';
    if (result.reason === 'NO_POSITIVE_SWAP_EVIDENCE') return 'noSwapEvidence';
    if (result.reason?.startsWith('UNSUPPORTED_') || result.reason === 'ROUTER_QUOTE_UNSUPPORTED') return 'unsupportedRouterVersion';
    return 'ambiguousAttribution';
}

export function summarizeCoverage(records) {
    const coverage = { candidates: 0, evaluated: 0, pendingUnavailable: 0, verifiedDirect: 0, verifiedRouted: 0,
        unsupportedRouterVersion: 0, ambiguousAttribution: 0, failedInvalid: 0, intermediateOnly: 0,
        notInvolved: 0, noSwapEvidence: 0, rawVerifiedTrackedAmount: '0', rawAmountCoverage: null, usdCoverage: null };
    let raw = 0n;
    for (const record of records) {
        coverage.candidates += 1;
        if (!record.category) { coverage.pendingUnavailable += 1; continue; }
        coverage.evaluated += 1; coverage[record.category] += 1;
        if (record.category.startsWith('verified')) raw += BigInt(record.event.rawTokenAmount);
    }
    coverage.rawVerifiedTrackedAmount = String(raw);
    coverage.verifiedCandidateFraction = coverage.evaluated ? (coverage.verifiedDirect + coverage.verifiedRouted) / coverage.evaluated : null;
    coverage.confidence = !coverage.candidates ? 'UNKNOWN' : coverage.pendingUnavailable || coverage.unsupportedRouterVersion
        || coverage.ambiguousAttribution || coverage.noSwapEvidence || !(coverage.verifiedDirect + coverage.verifiedRouted) ? 'DEGRADED' : 'PARTIAL';
    coverage.scope = 'RETAINED_UNIQUE_CANDIDATES_MAX_5_MINUTES';
    return coverage;
}
