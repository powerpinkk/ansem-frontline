import { ANSEM_MINT } from './token-presets.js';
import { createThemeDefinition } from './theme-definition.js';
import { createThemeRegistry } from './theme-registry.js';
import { createThemeResolver } from './theme-resolver.js';

export const THEME_IDS = Object.freeze({ ANSEM: 'ansem', GENERIC: 'generic' });

const ANSEM_MATERIALS = {
    buyBody: '#111613', buyHead: '#0a100c', buyAccent: '#00ff88', buyEye: '#021008', buyEyeEmissive: '#00ff88',
    sellBody: '#9a6845', sellHead: '#b27b52', sellDetail: '#55351f', sellEye: '#2c000d', sellEyeEmissive: '#8f002c', sellLaser: '#5b001d',
    snout: '#050505', buyParticle: '#00ff88', sellParticle: '#ff3366', dust: '#9b7653',
    crowdBuyBody: '#090d0b', crowdBuyAccent: '#00b96a', crowdBuyAccentEmissive: '#007a46', crowdBuyDetail: '#15221c', crowdBuyEyes: '#00ff72',
    crowdSellBody: '#a86f49', crowdSellAccent: '#59331f', crowdSellDetail: '#4a2b1b', crowdSellEyes: '#ff003c',
    projectileBuy: '#00ff88', projectileSell: '#ff3366',
    heroPrimary: '#111b18', heroWing: '#183c30', heroWingEmissive: '#052a1c', heroSkin: '#75452f',
    heroCloth: '#090d0d', heroHair: '#100b08', heroEnergy: '#00b965', heroEnergyEmissive: '#00c86c',
    heroSaddle: '#075d3b', heroSaddleEmissive: '#00a85e', heroOrnament: '#ffc928',
    heroOrnamentEmissive: '#7a4300', heroBeam: '#00ff88',
};

const ANSEM_COPY = {
    legendBuy: 'bull = verified buy', legendSell: 'grizzly = verified sell',
    buyForce: 'BULL FORCE', sellForce: 'BEAR FORCE', buyUnit: 'BLACK BULL', sellUnit: 'GRIZZLY',
    buySingular: 'Bull', sellSingular: 'Bear', buyPlural: 'Bulls', sellPlural: 'Grizzlies',
    buyWhale: 'Bull Whale', sellWhale: 'Bear Whale', buyEmoji: '🐂', sellEmoji: '🐻',
    buyBattle: 'Bulls break grizzly ranks · fresh sellers reinforce from their camp',
    sellBattle: 'Grizzlies break bull ranks · fresh buyers reinforce from the King’s camp',
    contestedBattle: 'Both sides cross contested ground while 60s SOL flow moves the marker',
    quietBattle: 'No verified SOL flow in 60s · tracked 5m market ranks muster behind the front',
    supportEvent: 'BULL SWARM', supportOwner: "King's support", wardEvent: "KING'S WARD",
    reclamationEvent: "KING'S RECLAMATION",
};

const ANSEM_PIXEL = {
    background: '#020504', ground: '#6c4b2e', groundEdge: '#2f7745', groundOverlay: '#9b7144',
    grid: '#7ba58d', rise: '#00ff88', fall: '#ff164f', treeTrunk: '#3d2315', foliageDark: '#174429',
    foliageLight: '#257143', rock: '#3b2b20', grass: '#347342', watermark: '#d8ffe9', shadow: '#020302',
    buyBody: '#050807', buyBodyAlt: '#111c17', buyHead: '#07100c', buyMuzzle: '#1a251f',
    buyHorn: '#e1fff2', buyTail: '#07100b', buyEyeAttack: '#d7ffeb', buyLeg: '#030504', buyHoof: '#1b2a23', buyGlow: '#00ff88', buyText: '#70ffc0',
    sellBody: '#a96f46', sellBodyAlt: '#c18150', sellHead: '#c88b55', sellMuzzle: '#56311e',
    sellEar: '#684027', sellEyeAttack: '#ffd5df', sellLeg: '#56351f', sellHoof: '#24160f', sellGlow: '#ff164f', sellText: '#ff7394',
    hud: '#030706', footer: '#080a09', text: '#e8fff3', muted: '#b8c8bf', offline: '#ff5a76',
};

export const ANSEM_THEME = createThemeDefinition({
    identity: { id: THEME_IDS.ANSEM, version: '1.0.0', displayName: 'ANSEM Frontline' },
    scene: {
        environment: {
            background: '#0a120e', fog: '#0a120e', fogNear: 40, fogFar: 160,
            terrainTint: '#ffffff', buyTrend: '#091a10', sellTrend: '#1a090d',
        },
        lighting: {
            ambient: { color: '#c8d8c4', intensity: 0.55 },
            hemisphere: { sky: '#b8d7d8', ground: '#2a2018', intensity: 2.2 },
            sun: { color: '#ffe0ad', intensity: 4.6 },
            rim: { color: '#00aaff', intensity: 1.5 },
        },
        hero: { visible: true },
        materials: ANSEM_MATERIALS,
    },
    ui: {
        brand: { primary: '$ANSEM', accent: 'FRONTLINE', documentTitle: '$ANSEM FRONTLINE • On-Chain Live Data' },
        colors: {
            accent: '#00ff88', buy: '#00ff88', sell: '#ff3366', chartSell: '#9b1739', gold: '#ffd700', background: '#020302',
            surface: 'rgba(10,12,10,0.75)', border: 'rgba(255,255,255,0.08)', bodyGlow: '#0c1813',
        },
        copy: ANSEM_COPY,
    },
    pixel: { colors: ANSEM_PIXEL },
    companion: { background: '#020403' },
    assets: {},
});

export const GENERIC_THEME = createThemeDefinition({
    identity: { id: THEME_IDS.GENERIC, version: '1.0.0', displayName: 'Generic Frontline' },
    scene: {
        environment: {
            background: '#0b1218', fog: '#0b1218', fogNear: 40, fogFar: 160,
            terrainTint: '#dce6e8', buyTrend: '#0b2223', sellTrend: '#251619',
        },
        lighting: {
            ambient: { color: '#c7d2da', intensity: 0.52 },
            hemisphere: { sky: '#a9c7d6', ground: '#242a30', intensity: 2.0 },
            sun: { color: '#ffe3b5', intensity: 4.4 },
            rim: { color: '#5ac8fa', intensity: 1.6 },
        },
        hero: { visible: true },
        materials: {
            ...ANSEM_MATERIALS,
            buyBody: '#26363c', buyHead: '#1a282e', buyAccent: '#55d6c2', buyEye: '#061719', buyEyeEmissive: '#55f2dd',
            sellBody: '#8f625c', sellHead: '#ad7770', sellDetail: '#513733', sellEye: '#241113', sellEyeEmissive: '#ff806f', sellLaser: '#9c403b',
            buyParticle: '#55d6c2', sellParticle: '#ff806f', dust: '#82909a',
            crowdBuyBody: '#223137', crowdBuyAccent: '#3da996', crowdBuyAccentEmissive: '#247568', crowdBuyDetail: '#334950', crowdBuyEyes: '#55f2dd',
            crowdSellBody: '#845c57', crowdSellAccent: '#694541', crowdSellDetail: '#4f3734', crowdSellEyes: '#ff806f',
            projectileBuy: '#55d6c2', projectileSell: '#ff806f',
            heroPrimary: '#34434a', heroWing: '#3d5660', heroWingEmissive: '#173842', heroSkin: '#83604e',
            heroCloth: '#182127', heroHair: '#211b18', heroEnergy: '#3da996', heroEnergyEmissive: '#55d6c2',
            heroSaddle: '#305e63', heroSaddleEmissive: '#317f80', heroOrnament: '#d8c27a',
            heroOrnamentEmissive: '#6e5b22', heroBeam: '#55d6c2',
        },
    },
    ui: {
        brand: { primary: 'TOKEN', accent: 'FRONTLINE', documentTitle: 'TOKEN FRONTLINE • On-Chain Live Data' },
        colors: {
            accent: '#55d6c2', buy: '#55d6c2', sell: '#ff806f', chartSell: '#d45f58', gold: '#d8c27a', background: '#071017',
            surface: 'rgba(8,18,25,0.82)', border: 'rgba(146,196,218,0.16)', bodyGlow: '#102936',
        },
        copy: {
            ...ANSEM_COPY,
            legendBuy: 'buy unit = verified buy', legendSell: 'sell unit = verified sell',
            buyForce: 'BUY FORCE', sellForce: 'SELL FORCE', buyUnit: 'BUY UNIT', sellUnit: 'SELL UNIT',
            buySingular: 'Buy unit', sellSingular: 'Sell unit', buyPlural: 'Buy forces', sellPlural: 'Sell forces',
            buyWhale: 'Large buy', sellWhale: 'Large sell', buyEmoji: '▲', sellEmoji: '▼',
            buyBattle: 'Buy forces advance · fresh sell pressure reinforces the opposite line',
            sellBattle: 'Sell forces advance · fresh buy pressure reinforces the opposite line',
            supportEvent: 'BUY SURGE', supportOwner: 'Vanguard support', wardEvent: 'VANGUARD WARD',
            reclamationEvent: 'VANGUARD RECLAMATION',
        },
    },
    pixel: {
        colors: {
            ...ANSEM_PIXEL,
            background: '#071017', ground: '#46535a', groundEdge: '#397f79', groundOverlay: '#6b7980',
            grid: '#799aa3', rise: '#55d6c2', fall: '#ff806f', foliageDark: '#295151', foliageLight: '#3d7770',
            grass: '#4f8079', watermark: '#dff9f5', buyBody: '#26363c', buyBodyAlt: '#344a52',
            buyHead: '#1a282e', buyMuzzle: '#4a6067', buyHorn: '#d9eceb', buyTail: '#1a282e', buyEyeAttack: '#ecffff', buyLeg: '#1e2c31', buyHoof: '#42575d',
            buyGlow: '#55d6c2', buyText: '#8aeee0', sellBody: '#8f625c', sellBodyAlt: '#ad7770',
            sellHead: '#bd857d', sellMuzzle: '#5f3e3a', sellEar: '#704a45', sellEyeAttack: '#ffe4df', sellLeg: '#694541', sellHoof: '#3d2927',
            sellGlow: '#ff806f', sellText: '#ffaaa0', hud: '#09141b', footer: '#0b151b', text: '#edf8f8', muted: '#b6c8cc',
        },
    },
    companion: { background: '#071017' },
    assets: {},
});

export const THEME_REGISTRY = createThemeRegistry({
    themes: [GENERIC_THEME, ANSEM_THEME],
    fallbackId: THEME_IDS.GENERIC,
});

export const THEME_RESOLVER = createThemeResolver({
    registry: THEME_REGISTRY,
    tokenThemes: { [ANSEM_MINT]: THEME_IDS.ANSEM },
});
