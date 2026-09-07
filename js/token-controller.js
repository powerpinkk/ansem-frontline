import { TOKEN_DISCOVERY_STATUS, validateSolanaMint } from './token-context.js';

export const TOKEN_UI_STATUS = Object.freeze({
    DEFAULT: 'default',
    RESOLVING: 'resolving',
    RESOLVED: TOKEN_DISCOVERY_STATUS.RESOLVED,
    INVALID: TOKEN_DISCOVERY_STATUS.INVALID,
    UNAVAILABLE: TOKEN_DISCOVERY_STATUS.UNAVAILABLE,
    UNSUPPORTED: TOKEN_DISCOVERY_STATUS.UNSUPPORTED,
    TEMPORARY_ERROR: TOKEN_DISCOVERY_STATUS.TEMPORARY_ERROR,
    UPSTREAM_FAILURE: TOKEN_DISCOVERY_STATUS.UPSTREAM_FAILURE,
});

export function createTokenController({
    defaultContext,
    resolveToken,
    mountRuntime,
    onState = () => {},
    onRoute = () => {},
}) {
    let activeSession = null;
    let pending = null;
    let generation = 0;
    let stopped = false;

    const cancelPending = () => {
        pending?.controller.abort();
        pending = null;
    };

    const deactivate = () => {
        if (!activeSession) return;
        activeSession.destroy?.();
        activeSession = null;
    };

    const commit = (resolution, { history = 'none', requestedMint } = {}) => {
        if (stopped) return null;
        const mint = resolution.context.identity.mint;
        if (activeSession?.context?.identity?.mint === mint) {
            onState({
                status: mint === defaultContext.identity.mint ? TOKEN_UI_STATUS.DEFAULT : TOKEN_UI_STATUS.RESOLVED,
                context: activeSession.context,
                requestedMint: mint,
            });
            if (history !== 'none') onRoute({ mint, history });
            return activeSession;
        }
        deactivate();
        activeSession = mountRuntime(resolution);
        if (!activeSession) throw new Error('Runtime mount did not return a session');
        onState({
            status: mint === defaultContext.identity.mint ? TOKEN_UI_STATUS.DEFAULT : TOKEN_UI_STATUS.RESOLVED,
            context: activeSession.context || resolution.context,
            requestedMint: requestedMint || mint,
        });
        if (history !== 'none') onRoute({ mint, history });
        return activeSession;
    };

    const showFailure = (resolution, { clearOnFailure, requestedMint }) => {
        if (clearOnFailure) deactivate();
        onState({
            status: resolution.status,
            error: resolution.error,
            requestedMint,
            context: clearOnFailure ? null : activeSession?.context || null,
        });
        return resolution;
    };

    const selectDefault = ({ history = 'none' } = {}) => {
        generation += 1;
        cancelPending();
        const resolution = {
            ok: true,
            status: TOKEN_DISCOVERY_STATUS.RESOLVED,
            context: defaultContext,
            market: null,
        };
        return Promise.resolve(commit(resolution, { history, requestedMint: defaultContext.identity.mint }));
    };

    const select = async (rawMint, {
        history = 'push',
        clearOnFailure = false,
    } = {}) => {
        if (stopped) return null;
        const requestedMint = typeof rawMint === 'string' ? rawMint : '';
        const validation = validateSolanaMint(requestedMint);
        const requestGeneration = ++generation;
        cancelPending();
        if (!validation.ok) {
            return showFailure({
                ok: false,
                status: TOKEN_UI_STATUS.INVALID,
                error: { code: validation.code, message: validation.message },
            }, { clearOnFailure, requestedMint: requestedMint.slice(0, 80) });
        }
        if (validation.value === defaultContext.identity.mint) return selectDefault({ history });
        if (activeSession?.context?.identity?.mint === validation.value) {
            return commit({ context: activeSession.context }, { history, requestedMint: validation.value });
        }

        const controller = new AbortController();
        pending = { controller, mint: validation.value, generation: requestGeneration };
        onState({
            status: TOKEN_UI_STATUS.RESOLVING,
            requestedMint: validation.value,
            context: activeSession?.context || null,
        });
        let resolution;
        try {
            resolution = await resolveToken(validation.value, { signal: controller.signal });
        } catch (error) {
            if (controller.signal.aborted) return null;
            resolution = {
                ok: false,
                status: error?.name === 'AbortError'
                    ? TOKEN_UI_STATUS.TEMPORARY_ERROR
                    : TOKEN_UI_STATUS.UPSTREAM_FAILURE,
                error: error?.name === 'AbortError'
                    ? { code: 'DISCOVERY_TEMPORARY', message: 'Token discovery is temporarily unavailable' }
                    : { code: 'DISCOVERY_UPSTREAM', message: 'Token discovery upstream failed' },
            };
        }
        if (stopped || controller.signal.aborted || requestGeneration !== generation) return null;
        pending = null;
        if (!resolution?.ok) return showFailure(resolution, { clearOnFailure, requestedMint: validation.value });
        return commit(resolution, { history, requestedMint: validation.value });
    };

    return {
        select,
        selectDefault,
        destroy() {
            stopped = true;
            generation += 1;
            cancelPending();
            deactivate();
        },
        getActiveSession: () => activeSession,
        getDiagnostics: () => ({
            activeMint: activeSession?.context?.identity?.mint || null,
            pendingMint: pending?.mint || null,
            generation,
            stopped,
        }),
    };
}
