export const JOURNAL_POLICY = Object.freeze({ maxEntries: 1024, maxAgeMs: 300_000 });

export function isCanonicalTrade(event) {
    return event?.evidenceLevel === 'CHAIN_VERIFIED' && event.verificationVersion === 'swap-transfers-v1'
        && typeof event.tokenMint === 'string' && typeof event.signature === 'string'
        && event.id === `${event.tokenMint}:${event.signature}:net-v1`
        && Number.isSafeInteger(event.slot) && event.slot >= 0
        && typeof event.isBuy === 'boolean' && /^\d+$/.test(event.rawTokenAmount || '')
        && /^\d+$/.test(event.rawQuoteAmount || '')
        && ['CONFIRMED', 'FINALIZED', 'REJECTED', 'RECONCILIATION_UNKNOWN'].includes(event.settlement);
}

export function activeTrade(event) {
    return isCanonicalTrade(event) && ['CONFIRMED', 'FINALIZED'].includes(event.settlement);
}

export function createTradeJournal(tokenMint, policy = JOURNAL_POLICY) {
    const entries = new Map();
    let duplicates = 0;
    let rejected = 0;
    let overflow = 0;
    function prune(now) {
        for (const [id, record] of entries) if (now - record.receivedAt > policy.maxAgeMs
            || (record.event.timestamp !== null && now - record.event.timestamp > policy.maxAgeMs)) entries.delete(id);
    }
    return {
        upsert(event, now = Date.now()) {
            prune(now);
            if (!isCanonicalTrade(event) || event.tokenMint !== tokenMint
                || (event.timestamp !== null && (!Number.isFinite(event.timestamp) || event.timestamp > now || now - event.timestamp > policy.maxAgeMs))) {
                rejected += 1; return { accepted: false, fresh: false };
            }
            const previous = entries.get(event.id);
            if (previous && ['REJECTED', 'RECONCILIATION_UNKNOWN'].includes(previous.event.settlement)
                && event.settlement === 'CONFIRMED') { duplicates += 1; return { accepted: false, fresh: false }; }
            if (previous?.event.settlement === 'FINALIZED' && event.settlement !== 'FINALIZED') {
                duplicates += 1; return { accepted: false, fresh: false };
            }
            if (!previous && entries.size >= policy.maxEntries) { overflow += 1; return { accepted: false, fresh: false }; }
            if (previous && JSON.stringify(previous.event) === JSON.stringify(event)) {
                duplicates += 1; return { accepted: false, fresh: false };
            }
            // Receipt is not refreshed by replay/settlement updates.
            entries.set(event.id, { event, receivedAt: previous?.receivedAt ?? now });
            return { accepted: true, fresh: !previous, previous: previous?.event ?? null };
        },
        values(now = Date.now(), includeInactive = false) {
            prune(now);
            return [...entries.values()].map((r) => r.event).filter((e) => includeInactive || activeTrade(e))
                .sort((a, b) => a.slot - b.slot || a.id.localeCompare(b.id));
        },
        clear() { entries.clear(); },
        diagnostics() { return { size: entries.size, duplicates, rejected, overflow }; },
    };
}
