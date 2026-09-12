import { CHAMPION_STATUS, USER_CHAMPION_ROLE, assertChampionState, canonicalMint } from './champion-state.js';

export function sanitizeChampionSnapshot(snapshot, expectedMint, now = Date.now()) {
    if (!snapshot) return null;
    assertChampionState(snapshot);
    const mint = canonicalMint(expectedMint);
    if (snapshot.mint !== mint) return null;
    const status = snapshot.status === CHAMPION_STATUS.ACTIVE && snapshot.expiresAt <= now
        ? CHAMPION_STATUS.EXPIRED
        : snapshot.status;
    return Object.freeze({
        status,
        mint,
        activationId: snapshot.activationId,
        source: snapshot.source,
        activatedAt: snapshot.activatedAt,
        expiresAt: snapshot.expiresAt,
        durationMs: snapshot.durationMs,
        presentationRole: USER_CHAMPION_ROLE,
        displayLabel: snapshot.displayLabel,
        reason: status === CHAMPION_STATUS.EXPIRED ? 'expired' : snapshot.reason,
        sequence: snapshot.sequence,
        updatedAt: snapshot.updatedAt,
    });
}

export function acceptChampionMessage(previous, candidate, expectedMint, now = Date.now()) {
    let snapshot;
    try {
        snapshot = sanitizeChampionSnapshot(candidate, expectedMint, now);
    } catch {
        return Object.freeze({ accepted: false, reason: 'invalid', snapshot: previous || null });
    }
    if (!snapshot) return Object.freeze({ accepted: false, reason: 'cross-token', snapshot: previous || null });
    if (previous && snapshot.sequence <= previous.sequence) {
        return Object.freeze({ accepted: false, reason: 'stale', snapshot: previous });
    }
    return Object.freeze({ accepted: true, reason: 'accepted', snapshot });
}
