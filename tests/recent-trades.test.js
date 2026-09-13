import { expect, it, vi } from 'vitest';
import { fetchRecentCandidates } from '../worker/src/recent-trades.js';
import { signatureFor } from './fixtures/integrity.js';
it('deduplicates history mentions and retains failures while excluding future, old and unknown time', async () => {
    const recent = { signature: signatureFor(), slot: 42, blockTime: 500 };
    const rpc = vi.fn(async () => [recent, { ...recent, err: {} },
        { signature: signatureFor(2), blockTime: 1 }, { signature: signatureFor(3), blockTime: 700 },
        { signature: signatureFor(4), blockTime: null }]);
    const cursors = new Map();
    expect(await fetchRecentCandidates(rpc, [{ address: 'a' }, { address: 'b' }], cursors, 600_000))
        .toEqual({ candidates: [recent], cursors, coverageIncomplete: false });
    expect(cursors.size).toBe(2);
    await fetchRecentCandidates(rpc, [{ address: 'a' }], cursors, 600_000);
    expect(rpc.mock.lastCall[1][1]).toMatchObject({ until: recent.signature, limit: 12, commitment: 'confirmed' });
    expect(rpc.mock.calls.every(([method]) => method === 'getSignaturesForAddress')).toBe(true);
});
it('bounds pool reads and reports truncation or outage without promoting candidates', async () => {
    const rpc = vi.fn(async (_m, [address]) => {
        if (address === '0') throw new Error('429');
        return Array.from({ length: 12 }, (_, i) => ({ signature: signatureFor(i), slot: i, blockTime: 500 }));
    });
    const result = await fetchRecentCandidates(rpc, Array.from({ length: 100 }, (_, i) => ({ address: String(i) })), new Map(), 600_000);
    expect(rpc).toHaveBeenCalledTimes(5);
    expect(result.coverageIncomplete).toBe(true);
    expect(result.candidates).toHaveLength(12);
    expect(result.candidates.every((s) => !s.evidenceLevel)).toBe(true);
});
