import { PixelFrontline, pixelPresentation } from './pixel-engine.js';
import { tokenCacheKey, validateSolanaMint } from './token-context.js';
import { DEFAULT_TOKEN_CONTEXT } from './token-presets.js';
import { THEME_REGISTRY, THEME_RESOLVER } from './theme-presets.js';

const canvas = document.getElementById('pixel-frontline-canvas');
const requestedMint = new URLSearchParams(window.location.search).get('token');
const validation = validateSolanaMint(requestedMint || DEFAULT_TOKEN_CONTEXT.identity.mint);
const channelContext = validation.ok ? validation.value : DEFAULT_TOKEN_CONTEXT;
const tokenContext = validation.ok && validation.value === DEFAULT_TOKEN_CONTEXT.identity.mint
    ? DEFAULT_TOKEN_CONTEXT
    : validation.ok
        ? { identity: { mint: validation.value, chain: 'solana' } }
        : DEFAULT_TOKEN_CONTEXT;
let currentTheme = THEME_RESOLVER.resolve(tokenContext);
const engine = new PixelFrontline(canvas, pixelPresentation(currentTheme));
const channel = new BroadcastChannel(tokenCacheKey('ansem-frontline:pixel', channelContext, 'v1'));
channel.addEventListener('message', (event) => {
    const themeId = event.data?.presentation?.themeId;
    if (themeId) {
        currentTheme = THEME_REGISTRY.resolve(themeId);
        engine.setTheme(pixelPresentation(currentTheme));
    }
    engine.setSnapshot(event.data);
});
engine.start();
if (import.meta.env.DEV || new URLSearchParams(window.location.search).has('diagnostics')) {
    window.__ansemPixelEngine = engine;
}
window.addEventListener('pagehide', () => {
    engine.destroy();
    channel.close();
});
