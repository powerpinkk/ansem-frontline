import { assertTokenContext } from './token-context.js';
import { COMMANDER_ROLE, commanderProfileKey } from './commander-profile.js';

export const COMMANDER_LIFECYCLE = Object.freeze({
    EMPTY: 'empty',
    LOADING: 'loading',
    ACTIVE: 'active',
    DESTROYED: 'destroyed',
});

export function createCommanderController({
    registry,
    instantiate = (profile, identity) => ({ profile, ...identity }),
    onChange = () => {},
} = {}) {
    if (typeof registry?.getCommanderProfile !== 'function') throw new TypeError('Commander registry is required');
    if (typeof instantiate !== 'function' || typeof onChange !== 'function') throw new TypeError('Invalid Commander controller adapter');
    let generation = 0;
    let sequence = 0;
    let currentMint = null;
    let activeInstance = null;
    let profile = null;
    let lifecycleState = COMMANDER_LIFECYCLE.EMPTY;
    let spawnCount = 0;
    let destroyCount = 0;
    let staleCompletions = 0;

    const snapshot = () => Object.freeze({
        role: COMMANDER_ROLE,
        generation,
        tokenMint: currentMint,
        present: lifecycleState === COMMANDER_LIFECYCLE.ACTIVE && Boolean(activeInstance),
        lifecycleState,
        profile,
        profileKey: profile ? commanderProfileKey(profile) : null,
        actorId: activeInstance?.actorId || null,
        assetId: profile?.assetId || null,
        rigType: profile?.rigType || null,
        animationSetId: profile?.animationSetId || null,
        combatArchetype: profile?.combatArchetype || null,
        capabilities: profile?.capabilities || Object.freeze([]),
    });

    const publish = () => {
        const value = snapshot();
        onChange(value);
        return value;
    };

    const disposeActive = () => {
        if (!activeInstance) return;
        activeInstance.destroy?.();
        activeInstance = null;
        destroyCount += 1;
    };

    const commitInstance = (instance, requestGeneration, mint, requestedProfile, actorId) => {
        if (requestGeneration !== generation || mint !== currentMint || profile !== requestedProfile) {
            instance?.destroy?.();
            staleCompletions += 1;
            return snapshot();
        }
        activeInstance = Object.freeze({ ...(instance || {}), actorId, role: COMMANDER_ROLE });
        lifecycleState = COMMANDER_LIFECYCLE.ACTIVE;
        spawnCount += 1;
        return publish();
    };

    const setTokenContext = (context) => {
        assertTokenContext(context);
        const mint = context.identity.mint;
        const nextProfile = registry.getCommanderProfile(mint);
        const nextKey = nextProfile ? commanderProfileKey(nextProfile) : null;
        if (mint === currentMint && nextKey === (profile ? commanderProfileKey(profile) : null)
            && lifecycleState !== COMMANDER_LIFECYCLE.DESTROYED) return snapshot();
        generation += 1;
        disposeActive();
        currentMint = mint;
        profile = nextProfile;
        if (!profile) {
            lifecycleState = COMMANDER_LIFECYCLE.EMPTY;
            return publish();
        }
        lifecycleState = COMMANDER_LIFECYCLE.LOADING;
        publish();
        sequence += 1;
        const actorId = `commander:${commanderProfileKey(profile)}:${sequence}`;
        const requestGeneration = generation;
        let result;
        try {
            result = instantiate(profile, Object.freeze({ actorId, role: COMMANDER_ROLE, generation, tokenMint: mint }));
        } catch (error) {
            profile = null;
            lifecycleState = COMMANDER_LIFECYCLE.EMPTY;
            publish();
            throw error;
        }
        if (result && typeof result.then === 'function') {
            void result.then(
                (instance) => commitInstance(instance, requestGeneration, mint, nextProfile, actorId),
                () => {
                    if (requestGeneration !== generation) {
                        staleCompletions += 1;
                        return;
                    }
                    profile = null;
                    lifecycleState = COMMANDER_LIFECYCLE.EMPTY;
                    publish();
                },
            );
            return snapshot();
        }
        return commitInstance(result, requestGeneration, mint, profile, actorId);
    };

    const clearForMint = (mint) => {
        if (mint !== currentMint) return snapshot();
        generation += 1;
        disposeActive();
        currentMint = null;
        profile = null;
        lifecycleState = COMMANDER_LIFECYCLE.EMPTY;
        return publish();
    };

    const destroy = () => {
        generation += 1;
        disposeActive();
        currentMint = null;
        profile = null;
        lifecycleState = COMMANDER_LIFECYCLE.DESTROYED;
        return publish();
    };

    return Object.freeze({
        setTokenContext,
        clearForMint,
        destroy,
        getSnapshot: snapshot,
        getDiagnostics: () => Object.freeze({ ...snapshot(), spawnCount, destroyCount, staleCompletions }),
    });
}
