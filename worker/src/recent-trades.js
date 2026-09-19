// History only supplies candidates to the shared live verifier and journal.
// Pools have already passed independent server discovery and owner checks.
export async function fetchRecentCandidates(rpc, pools, cursors, now = Date.now()) {
    const results = await Promise.allSettled(pools.slice(0, 5).map(async (pool) => {
        const until = cursors.get(pool.address);
        const signatures = await rpc('getSignaturesForAddress', [pool.address,
            { limit: 12, commitment: 'confirmed', ...(until ? { until } : {}) }]);
        if (!Array.isArray(signatures) || signatures.length > 12) throw new Error('Invalid signatures');
        if (signatures[0]?.signature) cursors.set(pool.address, signatures[0].signature);
        return { full: signatures.length === 12, candidates: signatures.slice().reverse().filter((s) =>
            Number.isFinite(s.blockTime) && now - s.blockTime * 1000 >= 0
            && now - s.blockTime * 1000 <= 300_000) };
    }));
    return { candidates: [...new Map(results.filter((r) => r.status === 'fulfilled')
        .flatMap((r) => r.value.candidates).map((s) => [s.signature, s])).values()],
    cursors, coverageIncomplete: results.some((r) => r.status === 'rejected' || r.value.full) };
}
