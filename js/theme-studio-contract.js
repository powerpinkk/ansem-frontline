import { createThemeDefinition, THEME_DEFINITION_LIMITS } from './theme-definition.js';

export const THEME_STUDIO_FORMAT = 'ansem-frontline-theme';
export const THEME_STUDIO_SCHEMA_VERSION = 1;
export const THEME_STUDIO_MAX_IMPORT_BYTES = 64 * 1024;

const color = (path, label, section) => ({ path, label, section, type: 'color' });
const text = (path, label, section, maxLength, help = '') => ({ path, label, section, type: 'text', maxLength, help });
const number = (path, label, section, bounds) => ({ path, label, section, type: 'number', ...bounds });

export const THEME_STUDIO_SECTIONS = deepFreeze([
    {
        id: 'identity', label: 'Identity', description: 'Portable theme identity and the controlled product label.',
        controls: [
            text('identity.id', 'Theme ID', 'identity', 40, 'Lowercase letters, numbers and hyphens.'),
            text('identity.displayName', 'Display name', 'identity', THEME_DEFINITION_LIMITS.displayName),
        ],
    },
    {
        id: 'environment', label: 'Environment', description: 'Atmosphere, terrain and reusable scene lights.',
        controls: [
            color('scene.environment.background', 'Battlefield background', 'environment'),
            color('scene.environment.fog', 'Fog colour', 'environment'),
            number('scene.environment.fogNear', 'Fog near', 'environment', THEME_DEFINITION_LIMITS.fogNear),
            number('scene.environment.fogFar', 'Fog far', 'environment', THEME_DEFINITION_LIMITS.fogFar),
            color('scene.environment.terrainTint', 'Terrain tint', 'environment'),
            color('scene.environment.buyTrend', 'Buy territory', 'environment'),
            color('scene.environment.sellTrend', 'Sell territory', 'environment'),
            color('scene.lighting.ambient.color', 'Ambient colour', 'environment'),
            number('scene.lighting.ambient.intensity', 'Ambient intensity', 'environment', THEME_DEFINITION_LIMITS.lightIntensity),
            color('scene.lighting.hemisphere.sky', 'Sky light', 'environment'),
            color('scene.lighting.hemisphere.ground', 'Ground light', 'environment'),
            number('scene.lighting.hemisphere.intensity', 'Hemisphere intensity', 'environment', THEME_DEFINITION_LIMITS.lightIntensity),
            color('scene.lighting.sun.color', 'Sun colour', 'environment'),
            number('scene.lighting.sun.intensity', 'Sun intensity', 'environment', THEME_DEFINITION_LIMITS.lightIntensity),
            color('scene.lighting.rim.color', 'Rim colour', 'environment'),
            number('scene.lighting.rim.intensity', 'Rim intensity', 'environment', THEME_DEFINITION_LIMITS.lightIntensity),
        ],
    },
    {
        id: 'factions', label: 'Factions', description: 'Core buy, sell and commander presentation without changing market semantics.',
        controls: [
            { path: 'scene.hero.visible', label: 'Show commander', section: 'factions', type: 'boolean' },
            color('scene.materials.buyBody', 'Buy body', 'factions'),
            color('scene.materials.buyHead', 'Buy head', 'factions'),
            color('scene.materials.buyAccent', 'Buy accent', 'factions'),
            color('scene.materials.crowdBuyAccent', 'Buy ranks accent', 'factions'),
            color('scene.materials.sellBody', 'Sell body', 'factions'),
            color('scene.materials.sellHead', 'Sell head', 'factions'),
            color('scene.materials.sellDetail', 'Sell detail', 'factions'),
            color('scene.materials.crowdSellAccent', 'Sell ranks accent', 'factions'),
            color('scene.materials.heroPrimary', 'Commander primary', 'factions'),
            color('scene.materials.heroWing', 'Commander wings', 'factions'),
            color('scene.materials.heroEnergy', 'Commander energy', 'factions'),
            color('scene.materials.heroOrnament', 'Commander ornament', 'factions'),
        ],
    },
    {
        id: 'effects', label: 'Effects', description: 'Particles, projectiles and combat highlights already supported by M6.',
        controls: [
            color('scene.materials.buyParticle', 'Buy particles', 'effects'),
            color('scene.materials.sellParticle', 'Sell particles', 'effects'),
            color('scene.materials.dust', 'Battlefield dust', 'effects'),
            color('scene.materials.projectileBuy', 'Buy projectiles', 'effects'),
            color('scene.materials.projectileSell', 'Sell projectiles', 'effects'),
            color('scene.materials.sellLaser', 'Sell highlight', 'effects'),
            color('scene.materials.heroBeam', 'Commander beam', 'effects'),
        ],
    },
    {
        id: 'ui', label: 'Interface', description: 'Bounded product copy and presentation tokens rendered as text only.',
        controls: [
            text('ui.brand.primary', 'Brand primary', 'ui', THEME_DEFINITION_LIMITS.brand),
            text('ui.brand.accent', 'Brand accent', 'ui', THEME_DEFINITION_LIMITS.brand),
            text('ui.brand.documentTitle', 'Document title', 'ui', THEME_DEFINITION_LIMITS.documentTitle),
            color('ui.colors.accent', 'Interface accent', 'ui'),
            color('ui.colors.buy', 'Buy signal', 'ui'),
            color('ui.colors.sell', 'Sell signal', 'ui'),
            color('ui.colors.chartSell', 'Sell chart', 'ui'),
            color('ui.colors.gold', 'Special accent', 'ui'),
            color('ui.colors.background', 'Page background', 'ui'),
            color('ui.colors.bodyGlow', 'Page glow', 'ui'),
            text('ui.copy.legendBuy', 'Buy legend', 'ui', THEME_DEFINITION_LIMITS.copy),
            text('ui.copy.legendSell', 'Sell legend', 'ui', THEME_DEFINITION_LIMITS.copy),
            text('ui.copy.buyForce', 'Buy force label', 'ui', THEME_DEFINITION_LIMITS.copy),
            text('ui.copy.sellForce', 'Sell force label', 'ui', THEME_DEFINITION_LIMITS.copy),
            text('ui.copy.buyAdvance', 'Buy advance state', 'ui', THEME_DEFINITION_LIMITS.copy),
            text('ui.copy.sellAdvance', 'Sell advance state', 'ui', THEME_DEFINITION_LIMITS.copy),
        ],
    },
    {
        id: 'pixel', label: 'Pixel Frontline', description: 'The embedded and Picture-in-Picture palette, updated in place.',
        controls: [
            color('pixel.colors.background', 'Pixel background', 'pixel'),
            color('pixel.colors.ground', 'Ground', 'pixel'),
            color('pixel.colors.groundEdge', 'Ground edge', 'pixel'),
            color('pixel.colors.grid', 'Chart grid', 'pixel'),
            color('pixel.colors.rise', 'Rising trace', 'pixel'),
            color('pixel.colors.fall', 'Falling trace', 'pixel'),
            color('pixel.colors.buyBody', 'Buy sprite', 'pixel'),
            color('pixel.colors.buyGlow', 'Buy glow', 'pixel'),
            color('pixel.colors.sellBody', 'Sell sprite', 'pixel'),
            color('pixel.colors.sellGlow', 'Sell glow', 'pixel'),
            color('pixel.colors.text', 'Primary text', 'pixel'),
            color('pixel.colors.muted', 'Muted text', 'pixel'),
            color('companion.background', 'Companion background', 'pixel'),
        ],
    },
]);

export const THEME_STUDIO_EDITABLE_PATHS = Object.freeze(
    THEME_STUDIO_SECTIONS.flatMap((section) => section.controls.map((control) => control.path)),
);

const EDITABLE = new Set(THEME_STUDIO_EDITABLE_PATHS);

export function serializeThemeStudioExport(definition, baseTheme) {
    const normalized = validateAuthorableTheme(definition, baseTheme);
    return `${JSON.stringify({
        format: THEME_STUDIO_FORMAT,
        schemaVersion: THEME_STUDIO_SCHEMA_VERSION,
        baseThemeId: baseTheme.identity.id,
        definition: normalized,
    }, null, 2)}\n`;
}

export function parseThemeStudioImport(source, presets) {
    if (typeof source !== 'string') throw new TypeError('Theme import must be UTF-8 JSON text');
    if (new TextEncoder().encode(source).byteLength > THEME_STUDIO_MAX_IMPORT_BYTES) {
        throw new TypeError(`Theme import exceeds ${THEME_STUDIO_MAX_IMPORT_BYTES / 1024} KB`);
    }
    let payload;
    try {
        payload = JSON.parse(source);
    } catch {
        throw new TypeError('Theme import is not valid JSON');
    }
    assertPlainEnvelope(payload);
    if (payload.format !== THEME_STUDIO_FORMAT || payload.schemaVersion !== THEME_STUDIO_SCHEMA_VERSION) {
        throw new TypeError('Unsupported Theme Studio schema');
    }
    const baseTheme = presets?.[payload.baseThemeId];
    if (!baseTheme) throw new TypeError('Theme import references an unknown base preset');
    return Object.freeze({ baseTheme, definition: validateAuthorableTheme(payload.definition, baseTheme) });
}

export function validateAuthorableTheme(candidate, baseTheme) {
    const definition = createThemeDefinition(candidate);
    const base = createThemeDefinition(baseTheme);
    if (definition.identity.version !== base.identity.version) throw new TypeError('Theme version is locked to the base preset');
    if (Object.keys(definition.assets).length) throw new TypeError('Theme Studio does not accept asset declarations');
    assertLockedParity(definition, base);
    return definition;
}

function assertLockedParity(candidate, base, prefix = '') {
    for (const key of Object.keys(base)) {
        const path = prefix ? `${prefix}.${key}` : key;
        const left = candidate[key];
        const right = base[key];
        if (left && typeof left === 'object') {
            assertLockedParity(left, right, path);
        } else if (!EDITABLE.has(path) && left !== right) {
            throw new TypeError(`Theme field is not authorable: ${path}`);
        }
    }
}

function assertPlainEnvelope(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('Theme import envelope must be an object');
    const prototype = Object.getPrototypeOf(payload);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Theme import envelope must be a plain object');
    const allowed = new Set(['format', 'schemaVersion', 'baseThemeId', 'definition']);
    for (const key of Object.keys(payload)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new TypeError('Theme import contains a forbidden field');
        if (!allowed.has(key)) throw new TypeError(`Theme import contains unknown field: ${key}`);
    }
    for (const key of allowed) {
        if (!Object.hasOwn(payload, key)) throw new TypeError(`Theme import is missing field: ${key}`);
    }
}

function deepFreeze(value) {
    Object.values(value).forEach((child) => {
        if (child && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child);
    });
    return Object.freeze(value);
}
