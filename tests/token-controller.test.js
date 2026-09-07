import { describe, expect, it, vi } from 'vitest';
import { createTokenContext, TOKEN_DISCOVERY_STATUS } from '../js/token-context.js';
import { createTokenController, TOKEN_UI_STATUS } from '../js/token-controller.js';
import { DEFAULT_TOKEN_CONTEXT } from '../js/token-presets.js';

const ANSEM = DEFAULT_TOKEN_CONTEXT.identity.mint;
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const SOL = 'So11111111111111111111111111111111111111112';

describe('token controller lifecycle', () => {
    it('mounts ANSEM directly for the base route', async () => {
        const harness = createHarness();
        await harness.controller.selectDefault();
        expect(harness.mounts.map((session) => session.context.identity.mint)).toEqual([ANSEM]);
        expect(harness.states.at(-1).status).toBe(TOKEN_UI_STATUS.DEFAULT);
    });

    it('resolves and mounts a token submitted by CA', async () => {
        const harness = createHarness();
        await harness.controller.select(USDC);
        expect(harness.resolveToken).toHaveBeenCalledWith(USDC, expect.objectContaining({ signal: expect.any(AbortSignal) }));
        expect(harness.controller.getDiagnostics().activeMint).toBe(USDC);
    });

    it('updates history only after successful resolution', async () => {
        const harness = createHarness();
        await harness.controller.select(JUP, { history: 'push' });
        expect(harness.routes).toEqual([{ mint: JUP, history: 'push' }]);
        expect(harness.states.map((state) => state.status)).toEqual(['resolving', 'resolved']);
    });

    it('keeps the current token when an input mint is valid but unavailable', async () => {
        const harness = createHarness({
            resolveToken: async (mint) => mint === JUP ? failure(TOKEN_DISCOVERY_STATUS.UNAVAILABLE) : success(mint),
        });
        await harness.controller.select(USDC);
        const first = harness.mounts[0];
        await harness.controller.select(JUP);
        expect(first.destroyed).toBe(false);
        expect(harness.controller.getDiagnostics().activeMint).toBe(USDC);
        expect(harness.states.at(-1).status).toBe('not-available');
    });

    it('clears the active token when an unresolvable URL is the source of truth', async () => {
        const harness = createHarness({ resolveToken: async () => failure(TOKEN_DISCOVERY_STATUS.UNSUPPORTED) });
        await harness.controller.selectDefault();
        await harness.controller.select(USDC, { history: 'none', clearOnFailure: true });
        expect(harness.mounts[0].destroyed).toBe(true);
        expect(harness.controller.getDiagnostics().activeMint).toBeNull();
    });

    it('destroys runtime A before mounting runtime B', async () => {
        const order = [];
        const harness = createHarness({ order });
        await harness.controller.select(USDC);
        await harness.controller.select(JUP);
        expect(order).toEqual([`mount:${USDC}`, `destroy:${USDC}`, `mount:${JUP}`]);
    });

    it('commits only C during a rapid A to B to C race', async () => {
        const requests = new Map();
        const harness = createHarness({
            resolveToken: (mint) => {
                const pending = deferred();
                requests.set(mint, pending);
                return pending.promise;
            },
        });
        const a = harness.controller.select(USDC);
        const b = harness.controller.select(JUP);
        const c = harness.controller.select(SOL);
        requests.get(JUP).resolve(success(JUP));
        requests.get(USDC).resolve(success(USDC));
        requests.get(SOL).resolve(success(SOL));
        await Promise.all([a, b, c]);
        expect(harness.mounts.map((session) => session.context.identity.mint)).toEqual([SOL]);
        expect(harness.controller.getDiagnostics().activeMint).toBe(SOL);
    });

    it('ignores a late response from A after B has become current', async () => {
        const lateA = deferred();
        const harness = createHarness({ resolveToken: (mint) => mint === USDC ? lateA.promise : success(mint) });
        const a = harness.controller.select(USDC);
        await harness.controller.select(JUP);
        lateA.resolve(success(USDC));
        await a;
        expect(harness.controller.getDiagnostics().activeMint).toBe(JUP);
        expect(harness.mounts).toHaveLength(1);
    });

    it('does not duplicate a runtime when the active mint is selected again', async () => {
        const harness = createHarness();
        await harness.controller.select(USDC);
        await harness.controller.select(USDC);
        expect(harness.mounts).toHaveLength(1);
        expect(harness.resolveToken).toHaveBeenCalledTimes(1);
    });

    it('rejects an invalid mint before discovery and leaves no route mutation', async () => {
        const harness = createHarness();
        await harness.controller.select('not-a-mint');
        expect(harness.resolveToken).not.toHaveBeenCalled();
        expect(harness.routes).toEqual([]);
        expect(harness.states.at(-1).status).toBe(TOKEN_UI_STATUS.INVALID);
    });

    it('aborts pending discovery and destroys the active runtime on teardown', async () => {
        const pending = deferred();
        let signal;
        const harness = createHarness({ resolveToken: (_mint, options) => { signal = options.signal; return pending.promise; } });
        await harness.controller.selectDefault();
        void harness.controller.select(USDC);
        harness.controller.destroy();
        expect(signal.aborted).toBe(true);
        expect(harness.mounts[0].destroyed).toBe(true);
        expect(harness.controller.getDiagnostics()).toMatchObject({ stopped: true, activeMint: null, pendingMint: null });
    });

    it.each([
        TOKEN_DISCOVERY_STATUS.UNAVAILABLE,
        TOKEN_DISCOVERY_STATUS.UNSUPPORTED,
        TOKEN_DISCOVERY_STATUS.TEMPORARY_ERROR,
        TOKEN_DISCOVERY_STATUS.UPSTREAM_FAILURE,
    ])('preserves the discovery status %s for user-facing mapping', async (status) => {
        const harness = createHarness({ resolveToken: async () => failure(status) });
        await harness.controller.select(USDC);
        expect(harness.states.at(-1).status).toBe(status);
    });

    it('maps a resolver timeout abort to a recoverable temporary error', async () => {
        const timeoutError = new Error('timed out');
        timeoutError.name = 'AbortError';
        const harness = createHarness({ resolveToken: async () => { throw timeoutError; } });
        await harness.controller.select(USDC);
        expect(harness.states.at(-1).status).toBe(TOKEN_UI_STATUS.TEMPORARY_ERROR);
        expect(harness.controller.getDiagnostics().pendingMint).toBeNull();
    });
});

function createHarness({ resolveToken = async (mint) => success(mint), order = [] } = {}) {
    const states = [];
    const routes = [];
    const mounts = [];
    const resolver = vi.fn(resolveToken);
    const controller = createTokenController({
        defaultContext: DEFAULT_TOKEN_CONTEXT,
        resolveToken: resolver,
        mountRuntime(resolution) {
            const session = {
                context: resolution.context,
                destroyed: false,
                destroy() {
                    this.destroyed = true;
                    order.push(`destroy:${this.context.identity.mint}`);
                },
            };
            mounts.push(session);
            order.push(`mount:${session.context.identity.mint}`);
            return session;
        },
        onState: (state) => states.push(state),
        onRoute: (route) => routes.push(route),
    });
    return { controller, states, routes, mounts, resolveToken: resolver };
}

function success(mint) {
    return Promise.resolve({
        ok: true,
        status: TOKEN_DISCOVERY_STATUS.RESOLVED,
        context: mint === ANSEM ? DEFAULT_TOKEN_CONTEXT : createTokenContext({ mint, symbol: 'TEST', name: 'Test token' }),
        market: { price: 1 },
    });
}

function failure(status) {
    return { ok: false, status, error: { code: status, message: status } };
}

function deferred() {
    let resolve;
    const promise = new Promise((next) => { resolve = next; });
    return { promise, resolve };
}
