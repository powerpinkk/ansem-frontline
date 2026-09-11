const THEME_ID = /^[a-z][a-z0-9-]{0,39}$/;
const THEME_VERSION = /^\d+\.\d+\.\d+$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SAFE_CSS_COLOR = /^(?:#[0-9a-f]{6}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0(?:\.\d+)?|1(?:\.0+)?))?\s*\))$/i;
const LOCAL_ASSET_PATH = /^(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*[?:#\\])(?:[a-z0-9_.-]+\/)*[a-z0-9_.-]+$/i;
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const THEME_DEFINITION_LIMITS = Object.freeze({
    fogNear: Object.freeze({ min: 0, max: 1_000, step: 1 }),
    fogFar: Object.freeze({ min: 1, max: 5_000, step: 1 }),
    lightIntensity: Object.freeze({ min: 0, max: 20, step: 0.05 }),
    displayName: 80,
    brand: 24,
    documentTitle: 100,
    copy: 180,
});

const SCENE_MATERIAL_KEYS = Object.freeze([
    'buyBody', 'buyHead', 'buyAccent', 'buyEye', 'buyEyeEmissive',
    'sellBody', 'sellHead', 'sellDetail', 'sellEye', 'sellEyeEmissive', 'sellLaser',
    'snout', 'buyParticle', 'sellParticle', 'dust',
    'crowdBuyBody', 'crowdBuyAccent', 'crowdBuyAccentEmissive', 'crowdBuyDetail', 'crowdBuyEyes',
    'crowdSellBody', 'crowdSellAccent', 'crowdSellDetail', 'crowdSellEyes',
    'projectileBuy', 'projectileSell',
    'heroPrimary', 'heroWing', 'heroWingEmissive', 'heroSkin', 'heroCloth', 'heroHair',
    'heroEnergy', 'heroEnergyEmissive', 'heroSaddle', 'heroSaddleEmissive',
    'heroOrnament', 'heroOrnamentEmissive', 'heroBeam',
]);

const UI_COLOR_KEYS = Object.freeze(['accent', 'buy', 'sell', 'chartSell', 'gold', 'background', 'surface', 'border', 'bodyGlow']);
const UI_COPY_KEYS = Object.freeze([
    'legendBuy', 'legendSell', 'buyForce', 'sellForce', 'buyUnit', 'sellUnit',
    'buySingular', 'sellSingular', 'buyPlural', 'sellPlural', 'buyWhale', 'sellWhale',
    'buyEmoji', 'sellEmoji', 'buyBattle', 'sellBattle', 'contestedBattle', 'quietBattle',
    'buyAdvance', 'sellAdvance', 'contestedState', 'quietState',
    'supportEvent', 'supportOwner', 'wardEvent', 'reclamationEvent',
]);

const PIXEL_COLOR_KEYS = Object.freeze([
    'background', 'ground', 'groundEdge', 'groundOverlay', 'grid', 'rise', 'fall',
    'treeTrunk', 'foliageDark', 'foliageLight', 'rock', 'grass', 'watermark', 'shadow',
    'buyBody', 'buyBodyAlt', 'buyHead', 'buyMuzzle', 'buyHorn', 'buyTail', 'buyEyeAttack', 'buyLeg', 'buyHoof', 'buyGlow', 'buyText',
    'sellBody', 'sellBodyAlt', 'sellHead', 'sellMuzzle', 'sellEar', 'sellEyeAttack', 'sellLeg', 'sellHoof', 'sellGlow', 'sellText',
    'hud', 'footer', 'text', 'muted', 'offline',
]);

export function createThemeDefinition(input) {
    assertSafeObjectTree(input);
    const source = record(input, 'ThemeDefinition');
    exactKeys(source, ['identity', 'scene', 'ui', 'pixel', 'companion', 'assets'], 'ThemeDefinition');
    const identity = record(source.identity, 'ThemeDefinition.identity');
    const scene = record(source.scene, 'ThemeDefinition.scene');
    const environment = record(scene.environment, 'ThemeDefinition.scene.environment');
    const lighting = record(scene.lighting, 'ThemeDefinition.scene.lighting');
    const hero = record(scene.hero, 'ThemeDefinition.scene.hero');
    const materials = record(scene.materials, 'ThemeDefinition.scene.materials');
    const ui = record(source.ui, 'ThemeDefinition.ui');
    const brand = record(ui.brand, 'ThemeDefinition.ui.brand');
    const uiColors = record(ui.colors, 'ThemeDefinition.ui.colors');
    const copy = record(ui.copy, 'ThemeDefinition.ui.copy');
    const pixel = record(source.pixel, 'ThemeDefinition.pixel');
    const pixelColors = record(pixel.colors, 'ThemeDefinition.pixel.colors');
    const companion = record(source.companion, 'ThemeDefinition.companion');
    exactKeys(identity, ['id', 'version', 'displayName'], 'ThemeDefinition.identity');
    exactKeys(scene, ['environment', 'lighting', 'hero', 'materials'], 'ThemeDefinition.scene');
    exactKeys(environment, ['background', 'fog', 'fogNear', 'fogFar', 'terrainTint', 'buyTrend', 'sellTrend'], 'ThemeDefinition.scene.environment');
    exactKeys(lighting, ['ambient', 'hemisphere', 'sun', 'rim'], 'ThemeDefinition.scene.lighting');
    exactKeys(hero, ['visible'], 'ThemeDefinition.scene.hero');
    exactKeys(materials, SCENE_MATERIAL_KEYS, 'ThemeDefinition.scene.materials');
    exactKeys(ui, ['brand', 'colors', 'copy'], 'ThemeDefinition.ui');
    exactKeys(brand, ['primary', 'accent', 'documentTitle'], 'ThemeDefinition.ui.brand');
    exactKeys(uiColors, UI_COLOR_KEYS, 'ThemeDefinition.ui.colors');
    exactKeys(copy, UI_COPY_KEYS, 'ThemeDefinition.ui.copy');
    exactKeys(pixel, ['colors'], 'ThemeDefinition.pixel');
    exactKeys(pixelColors, PIXEL_COLOR_KEYS, 'ThemeDefinition.pixel.colors');
    exactKeys(companion, ['background'], 'ThemeDefinition.companion');

    const definition = {
        identity: {
            id: themeId(identity.id),
            version: themeVersion(identity.version),
            displayName: boundedText(identity.displayName, THEME_DEFINITION_LIMITS.displayName, 'Theme display name'),
        },
        scene: {
            environment: {
                background: hex(environment.background, 'scene background'),
                fog: hex(environment.fog, 'scene fog'),
                fogNear: boundedNumber(environment.fogNear, THEME_DEFINITION_LIMITS.fogNear.min, THEME_DEFINITION_LIMITS.fogNear.max, 'fog near'),
                fogFar: boundedNumber(environment.fogFar, THEME_DEFINITION_LIMITS.fogFar.min, THEME_DEFINITION_LIMITS.fogFar.max, 'fog far'),
                terrainTint: hex(environment.terrainTint, 'terrain tint'),
                buyTrend: hex(environment.buyTrend, 'buy trend'),
                sellTrend: hex(environment.sellTrend, 'sell trend'),
            },
            lighting: {
                ambient: light(lighting.ambient, 'ambient light'),
                hemisphere: hemisphereLight(lighting.hemisphere),
                sun: light(lighting.sun, 'sun light'),
                rim: light(lighting.rim, 'rim light'),
            },
            hero: { visible: boolean(hero.visible, 'hero visibility') },
            materials: colorRecord(materials, SCENE_MATERIAL_KEYS, 'scene material'),
        },
        ui: {
            brand: {
                primary: boundedText(brand.primary, THEME_DEFINITION_LIMITS.brand, 'brand primary'),
                accent: boundedText(brand.accent, THEME_DEFINITION_LIMITS.brand, 'brand accent'),
                documentTitle: boundedText(brand.documentTitle, THEME_DEFINITION_LIMITS.documentTitle, 'document title'),
            },
            colors: cssColorRecord(uiColors, UI_COLOR_KEYS, 'UI color'),
            copy: textRecord(copy, UI_COPY_KEYS, 'UI copy'),
        },
        pixel: { colors: colorRecord(pixelColors, PIXEL_COLOR_KEYS, 'pixel color') },
        companion: { background: hex(companion.background, 'companion background') },
        assets: assetRecord(source.assets),
    };
    if (definition.scene.environment.fogFar <= definition.scene.environment.fogNear) {
        throw new TypeError('Theme fog far must be greater than fog near');
    }
    return deepFreeze(definition);
}

export function isThemeDefinition(value) {
    try {
        createThemeDefinition(value);
        return true;
    } catch {
        return false;
    }
}

export function isSafeLocalThemeAsset(value) {
    return typeof value === 'string' && value.length <= 180 && LOCAL_ASSET_PATH.test(value);
}

function light(value, label) {
    const source = record(value, label);
    exactKeys(source, ['color', 'intensity'], label);
    return {
        color: hex(source.color, `${label} color`),
        intensity: boundedNumber(source.intensity, THEME_DEFINITION_LIMITS.lightIntensity.min, THEME_DEFINITION_LIMITS.lightIntensity.max, `${label} intensity`),
    };
}

function hemisphereLight(value) {
    const source = record(value, 'hemisphere light');
    exactKeys(source, ['sky', 'ground', 'intensity'], 'hemisphere light');
    return {
        sky: hex(source.sky, 'hemisphere sky'),
        ground: hex(source.ground, 'hemisphere ground'),
        intensity: boundedNumber(source.intensity, THEME_DEFINITION_LIMITS.lightIntensity.min, THEME_DEFINITION_LIMITS.lightIntensity.max, 'hemisphere intensity'),
    };
}

function assetRecord(value) {
    const source = value === undefined ? {} : record(value, 'ThemeDefinition.assets');
    const entries = Object.entries(source);
    if (entries.length > 16) throw new TypeError('A theme can declare at most 16 assets');
    const assets = {};
    for (const [key, path] of entries) {
        if (!THEME_ID.test(key) || !isSafeLocalThemeAsset(path)) {
            throw new TypeError('Theme assets require safe IDs and local versioned paths');
        }
        assets[key] = path;
    }
    return assets;
}

function colorRecord(source, keys, label) {
    return Object.fromEntries(keys.map((key) => [key, hex(source[key], `${label} ${key}`)]));
}

function cssColorRecord(source, keys, label) {
    return Object.fromEntries(keys.map((key) => [key, cssColor(source[key], `${label} ${key}`)]));
}

function textRecord(source, keys, label) {
    return Object.fromEntries(keys.map((key) => [key, boundedText(source[key], THEME_DEFINITION_LIMITS.copy, `${label} ${key}`)]));
}

function themeId(value) {
    if (typeof value !== 'string' || !THEME_ID.test(value)) throw new TypeError('Invalid theme ID');
    return value;
}

function themeVersion(value) {
    if (typeof value !== 'string' || !THEME_VERSION.test(value)) throw new TypeError('Invalid theme version');
    return value;
}

function hex(value, label) {
    if (typeof value !== 'string' || !HEX_COLOR.test(value)) throw new TypeError(`Invalid ${label}`);
    return value.toLowerCase();
}

function cssColor(value, label) {
    if (typeof value !== 'string' || value.length > 64 || !SAFE_CSS_COLOR.test(value)) throw new TypeError(`Invalid ${label}`);
    const normalized = value.toLowerCase().replace(/\s+/g, '');
    if (normalized.startsWith('#')) return normalized;
    const channels = normalized.match(/[\d.]+/g)?.map(Number) || [];
    if (channels.length < 3 || channels.slice(0, 3).some((channel) => channel > 255)) throw new TypeError(`Invalid ${label}`);
    return normalized;
}

function boundedText(value, maximum, label) {
    if (typeof value !== 'string') throw new TypeError(`${label} must be text`);
    const text = value.trim();
    if (!text || text.length > maximum) throw new TypeError(`${label} is outside its length limit`);
    return text;
}

function boundedNumber(value, minimum, maximum, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < minimum || number > maximum) throw new TypeError(`Invalid ${label}`);
    return number;
}

function boolean(value, label) {
    if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean`);
    return value;
}

function record(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
    return value;
}

function exactKeys(value, keys, label) {
    const allowed = new Set(keys);
    const unknown = Object.keys(value).find((key) => !allowed.has(key));
    if (unknown) throw new TypeError(`${label} contains unknown field: ${unknown}`);
    const missing = keys.find((key) => !Object.hasOwn(value, key));
    if (missing) throw new TypeError(`${label} is missing field: ${missing}`);
}

function assertSafeObjectTree(root) {
    const stack = [{ value: root, depth: 0 }];
    let nodes = 0;
    while (stack.length) {
        const { value, depth } = stack.pop();
        if (!value || typeof value !== 'object') continue;
        if (depth > 12 || ++nodes > 320) throw new TypeError('ThemeDefinition structure is too complex');
        if (Array.isArray(value)) throw new TypeError('ThemeDefinition arrays are not supported');
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) throw new TypeError('ThemeDefinition objects must be plain records');
        for (const key of Object.keys(value)) {
            if (DANGEROUS_KEYS.has(key)) throw new TypeError(`ThemeDefinition contains forbidden field: ${key}`);
            stack.push({ value: value[key], depth: depth + 1 });
        }
    }
}

function deepFreeze(value) {
    Object.values(value).forEach((child) => {
        if (child && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child);
    });
    return Object.freeze(value);
}
