import { describe, expect, it } from 'vitest';
import {
    DEMO_COMMANDER_PROFILE as BASE_PROFILE,
    COMMANDER_ASSET_CATALOG,

    commanderProfileKey,
    createCommanderProfileRegistry,
    validateCommanderProfile,
} from '../js/commander-profile.js';
import { createTokenContext } from '../js/token-context.js';
import { FIXTURE_MINT } from './fixtures/market-token.js';

const DEMO_COMMANDER_PROFILE = { ...BASE_PROFILE, tokenMint: FIXTURE_MINT };
const COMMANDER_PROFILE_REGISTRY = createCommanderProfileRegistry([DEMO_COMMANDER_PROFILE]);
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const UNKNOWN = 'So11111111111111111111111111111111111111112';

describe('CommanderProfile validation and bundled registry', () => {
    it('validates and freezes the versioned ANSEM profile', () => {
        const result = validateCommanderProfile(DEMO_COMMANDER_PROFILE);
        expect(result).toMatchObject({ ok: true, errors: [] });
        expect(result.profile).toMatchObject({ tokenMint: FIXTURE_MINT, assetId: 'black-bull-v1', version: 1 });
        expect(commanderProfileKey(result.profile)).toBe('frontline-black-bull@1');
        expect(Object.isFrozen(result.profile)).toBe(true);
        expect(COMMANDER_ASSET_CATALOG['black-bull-v1'].kind).toBe('bundled-procedural');
    });

    it.each([
        ['invalid mint', { tokenMint: 'not-a-mint' }, 'TOKEN_MINT'],
        ['invalid version', { version: 0 }, 'PROFILE_VERSION'],
        ['unknown asset', { assetId: 'https://evil.invalid/commander.glb' }, 'ASSET_ID'],
        ['unsupported rig', { rigType: 'ARBITRARY_SCRIPT_RIG' }, 'RIG_TYPE'],
        ['unsupported animation', { animationSetId: 'remote-animation' }, 'ANIMATION_SET'],
        ['invalid combat archetype', { combatArchetype: 'unbounded-force' }, 'COMBAT_ARCHETYPE'],
    ])('fails closed for %s', (_label, change, code) => {
        const result = validateCommanderProfile({ ...DEMO_COMMANDER_PROFILE, ...change });
        expect(result.ok).toBe(false);
        expect(result.errors).toContain(code);
        expect(result.profile).toBeUndefined();
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1_000_000])('rejects unsafe scale %s', (scale) => {
        expect(validateCommanderProfile({ ...DEMO_COMMANDER_PROFILE, scale })).toMatchObject({
            ok: false,
            errors: expect.arrayContaining(['SCALE']),
        });
    });

    it('rejects duplicate mint mappings and duplicate versioned identities', () => {
        expect(() => createCommanderProfileRegistry([
            DEMO_COMMANDER_PROFILE,
            { ...DEMO_COMMANDER_PROFILE, id: 'another-profile' },
        ])).toThrow(/token mapping/);
        expect(() => createCommanderProfileRegistry([
            DEMO_COMMANDER_PROFILE,
            { ...DEMO_COMMANDER_PROFILE, tokenMint: USDC },
        ])).toThrow(/identity/);
    });

    it('uses exact, case-sensitive mint identity with no symbol or name fallback', () => {
        expect(COMMANDER_PROFILE_REGISTRY.getCommanderProfile(FIXTURE_MINT)).toMatchObject({
            id: 'frontline-black-bull',
            version: 1,
        });
        expect(COMMANDER_PROFILE_REGISTRY.getCommanderProfile(USDC)).toBeNull();
        expect(COMMANDER_PROFILE_REGISTRY.getCommanderProfile(JUP)).toBeNull();
        expect(COMMANDER_PROFILE_REGISTRY.getCommanderProfile(UNKNOWN)).toBeNull();
        expect(COMMANDER_PROFILE_REGISTRY.getCommanderProfile('not-a-mint')).toBeNull();
        expect(COMMANDER_PROFILE_REGISTRY.getCommanderProfile(FIXTURE_MINT.replace('c', 'C'))).toBeNull();
        const hostileMetadata = createTokenContext({ mint: USDC, symbol: 'ANSEM', name: 'The Black Bull' });
        expect(COMMANDER_PROFILE_REGISTRY.getCommanderProfile(hostileMetadata.identity.mint)).toBeNull();
    });
});
