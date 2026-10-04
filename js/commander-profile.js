import { validateSolanaMint } from './token-context.js';
import { ANSEM_MINT } from './token-presets.js';

export const COMMANDER_ROLE = 'commander';
export const COMMANDER_SCALE_LIMITS = Object.freeze({ min: 0.25, max: 4 });
export const COMMANDER_RIG_TYPES = Object.freeze(['QUADRUPED_BULL_RIDER']);
export const COMMANDER_ANIMATION_SETS = Object.freeze(['bull-commander-v1']);
export const COMMANDER_PRESENTATION_BEHAVIORS = Object.freeze(['battlefield-leader-v1']);
export const COMMANDER_COMBAT_ARCHETYPES = Object.freeze(['heavy-bull']);
export const COMMANDER_CAPABILITIES = Object.freeze([
    'MOVEMENT',
    'LEADERSHIP',
    'MELEE',
    'CHARGE',
    'IMPACT_REACTION',
]);

export const COMMANDER_ASSET_CATALOG = Object.freeze({
    'black-bull-v1': Object.freeze({
        id: 'black-bull-v1',
        kind: 'bundled-procedural',
        rigTypes: Object.freeze(['QUADRUPED_BULL_RIDER']),
        animationSets: Object.freeze(['bull-commander-v1']),
    }),
});

const PROFILE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const MATERIAL_POLICIES = new Set(['theme-hero']);

export const ANSEM_COMMANDER_PROFILE = Object.freeze({
    id: 'ansem-black-bull',
    version: 1,
    tokenMint: ANSEM_MINT,
    display: Object.freeze({ name: 'Black Bull Commander', title: 'ANSEM Commander' }),
    assetId: 'black-bull-v1',
    rigType: 'QUADRUPED_BULL_RIDER',
    materialPolicy: 'theme-hero',
    animationSetId: 'bull-commander-v1',
    scale: 1.22,
    presentationBehavior: 'battlefield-leader-v1',
    combatArchetype: 'heavy-bull',
    capabilities: Object.freeze(['MOVEMENT', 'LEADERSHIP', 'MELEE', 'CHARGE', 'IMPACT_REACTION']),
    metadata: Object.freeze({ provenance: 'source-controlled', configuredFor: 'ANSEM' }),
});

export function commanderProfileKey(profile) {
    return `${profile.id}@${profile.version}`;
}

export function validateCommanderProfile(candidate, { assetCatalog = COMMANDER_ASSET_CATALOG } = {}) {
    const errors = [];
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        return { ok: false, errors: Object.freeze(['PROFILE_OBJECT']) };
    }
    if (typeof candidate.id !== 'string' || !PROFILE_ID.test(candidate.id)) errors.push('PROFILE_ID');
    if (!Number.isInteger(candidate.version) || candidate.version < 1) errors.push('PROFILE_VERSION');
    if (!validateSolanaMint(candidate.tokenMint).ok) errors.push('TOKEN_MINT');
    const asset = typeof candidate.assetId === 'string' ? assetCatalog[candidate.assetId] : null;
    if (!asset) errors.push('ASSET_ID');
    if (!COMMANDER_RIG_TYPES.includes(candidate.rigType) || (asset && !asset.rigTypes.includes(candidate.rigType))) {
        errors.push('RIG_TYPE');
    }
    if (!COMMANDER_ANIMATION_SETS.includes(candidate.animationSetId)
        || (asset && !asset.animationSets.includes(candidate.animationSetId))) {
        errors.push('ANIMATION_SET');
    }
    const scale = Number(candidate.scale);
    if (!Number.isFinite(scale) || scale < COMMANDER_SCALE_LIMITS.min || scale > COMMANDER_SCALE_LIMITS.max) {
        errors.push('SCALE');
    }
    if (!COMMANDER_PRESENTATION_BEHAVIORS.includes(candidate.presentationBehavior)) {
        errors.push('PRESENTATION_BEHAVIOR');
    }
    if (!COMMANDER_COMBAT_ARCHETYPES.includes(candidate.combatArchetype)) errors.push('COMBAT_ARCHETYPE');
    if (!MATERIAL_POLICIES.has(candidate.materialPolicy)) errors.push('MATERIAL_POLICY');
    if (!Array.isArray(candidate.capabilities) || !candidate.capabilities.length
        || candidate.capabilities.some((capability) => !COMMANDER_CAPABILITIES.includes(capability))
        || new Set(candidate.capabilities).size !== candidate.capabilities.length) {
        errors.push('CAPABILITIES');
    }
    if (typeof candidate.display?.name !== 'string' || !candidate.display.name.trim()
        || typeof candidate.display?.title !== 'string' || !candidate.display.title.trim()) {
        errors.push('DISPLAY');
    }
    if (errors.length) return { ok: false, errors: Object.freeze([...new Set(errors)]) };

    const profile = {
        id: candidate.id,
        version: candidate.version,
        tokenMint: candidate.tokenMint,
        display: Object.freeze({
            name: candidate.display.name.trim().slice(0, 80),
            title: candidate.display.title.trim().slice(0, 80),
        }),
        assetId: candidate.assetId,
        rigType: candidate.rigType,
        materialPolicy: candidate.materialPolicy,
        animationSetId: candidate.animationSetId,
        scale,
        presentationBehavior: candidate.presentationBehavior,
        combatArchetype: candidate.combatArchetype,
        capabilities: Object.freeze([...candidate.capabilities]),
        metadata: Object.freeze({ provenance: String(candidate.metadata?.provenance || 'source-controlled').slice(0, 80) }),
    };
    return { ok: true, errors: Object.freeze([]), profile: Object.freeze(profile) };
}

export function createCommanderProfileRegistry(profiles, options = {}) {
    if (!Array.isArray(profiles)) throw new TypeError('Commander profiles must be an array');
    const byMint = new Map();
    const identities = new Set();
    for (const candidate of profiles) {
        const result = validateCommanderProfile(candidate, options);
        if (!result.ok) throw new TypeError(`Invalid CommanderProfile: ${result.errors.join(', ')}`);
        const key = commanderProfileKey(result.profile);
        if (identities.has(key)) throw new TypeError(`Duplicate CommanderProfile identity: ${key}`);
        if (byMint.has(result.profile.tokenMint)) {
            throw new TypeError(`Duplicate CommanderProfile token mapping: ${result.profile.tokenMint}`);
        }
        identities.add(key);
        byMint.set(result.profile.tokenMint, result.profile);
    }
    return Object.freeze({
        getCommanderProfile(tokenMint) {
            if (!validateSolanaMint(tokenMint).ok) return null;
            return byMint.get(tokenMint) || null;
        },
        size: byMint.size,
    });
}

export const COMMANDER_PROFILE_REGISTRY = createCommanderProfileRegistry([ANSEM_COMMANDER_PROFILE]);

export function getCommanderProfile(tokenMint) {
    return COMMANDER_PROFILE_REGISTRY.getCommanderProfile(tokenMint);
}
