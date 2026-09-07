const THEME_ID = /^[a-z][a-z0-9-]{0,39}$/;
const THEME_VERSION = /^\d+\.\d+\.\d+$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SAFE_CSS_COLOR = /^(?:#[0-9a-f]{6}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0(?:\.\d+)?|1(?:\.0+)?))?\s*\))$/i;
const LOCAL_ASSET_PATH = /^(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*[?:#\\])(?:[a-z0-9_.-]+\/)*[a-z0-9_.-]+$/i;

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
    const source = record(input, 'ThemeDefinition');
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

    const definition = {
        identity: {
            id: themeId(identity.id),
            version: themeVersion(identity.version),
            displayName: boundedText(identity.displayName, 80, 'Theme display name'),
        },
        scene: {
            environment: {
                background: hex(environment.background, 'scene background'),
                fog: hex(environment.fog, 'scene fog'),
                fogNear: boundedNumber(environment.fogNear, 0, 1_000, 'fog near'),
                fogFar: boundedNumber(environment.fogFar, 1, 5_000, 'fog far'),
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
                primary: boundedText(brand.primary, 24, 'brand primary'),
                accent: boundedText(brand.accent, 24, 'brand accent'),
                documentTitle: boundedText(brand.documentTitle, 100, 'document title'),
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
    return {
        color: hex(source.color, `${label} color`),
        intensity: boundedNumber(source.intensity, 0, 20, `${label} intensity`),
    };
}

function hemisphereLight(value) {
    const source = record(value, 'hemisphere light');
    return {
        sky: hex(source.sky, 'hemisphere sky'),
        ground: hex(source.ground, 'hemisphere ground'),
        intensity: boundedNumber(source.intensity, 0, 20, 'hemisphere intensity'),
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
    return Object.fromEntries(keys.map((key) => [key, boundedText(source[key], 180, `${label} ${key}`)]));
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
    return value.toLowerCase().replace(/\s+/g, '');
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

function deepFreeze(value) {
    Object.values(value).forEach((child) => {
        if (child && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child);
    });
    return Object.freeze(value);
}
