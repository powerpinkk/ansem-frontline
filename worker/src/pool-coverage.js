// Acquisition mentions and identified successful swap invocations are separate
// denominators. Unknown instructions/fetch gaps cannot turn into zero swaps.
export function summarizePoolCoverage(records) {
    const c = { mentions: 0, fetched: 0, failedTransactions: 0, pendingUnavailable: 0,
        nonSwapInstructions: 0, unclassifiedInstructions: 0, unclassifiedTransactions: 0, unprovenSwapInvocations: 0, actualSwapCandidates: 0,
        verifiedExecutions: 0, unsupportedExecutions: 0, inactiveExecutions: 0, byProtocol: {},
        usdCoverage: null, rawAmountCoverage: null, confidence: 'UNKNOWN', scope: 'RETAINED_CANONICAL_MARKET_MAX_5_MINUTES' };
    for (const r of records) {
        c.mentions += 1;
        if (!r.poolResult) { c.pendingUnavailable += 1; continue; }
        c.fetched += 1;
        if (r.poolResult.status === 'FAILED') c.failedTransactions += 1;
        if (r.poolResult.status === 'UNVERIFIED' && !r.poolResult.executions?.length) c.unclassifiedTransactions += 1;
        c.nonSwapInstructions += r.poolResult.nonSwaps || 0;
        c.unclassifiedInstructions += r.poolResult.unclassified || 0;
        c.unprovenSwapInvocations += r.poolResult.unprovenSwapInvocations || 0;
        for (const execution of r.poolResult.executions || []) {
            const p = c.byProtocol[execution.protocol] ||= { actualSwapCandidates: 0, verifiedExecutions: 0, unsupportedExecutions: 0 };
            c.actualSwapCandidates += 1; p.actualSwapCandidates += 1;
            if (execution.status === 'VERIFIED' && ['CONFIRMED','FINALIZED','FINALIZE_PENDING'].includes(r.state)) {
                c.verifiedExecutions += 1; p.verifiedExecutions += 1;
            } else { c.unsupportedExecutions += 1; p.unsupportedExecutions += 1;
                if (execution.status === 'VERIFIED') c.inactiveExecutions += 1; }
        }
    }
    c.verifiedSwapFraction = c.actualSwapCandidates ? c.verifiedExecutions / c.actualSwapCandidates : null;
    for (const p of Object.values(c.byProtocol)) p.verifiedSwapFraction = p.actualSwapCandidates ? p.verifiedExecutions / p.actualSwapCandidates : null;
    c.confidence = !c.mentions ? 'UNKNOWN' : c.pendingUnavailable || c.unclassifiedInstructions || c.unclassifiedTransactions
        || c.unprovenSwapInvocations || c.unsupportedExecutions ? 'DEGRADED' : 'PARTIAL';
    return c;
}
