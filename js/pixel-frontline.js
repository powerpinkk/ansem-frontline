import { PixelFrontline, pixelPresentation } from './pixel-engine.js';
import { tokenCacheKey, validateSolanaMint } from './token-context.js';
import { DEFAULT_TOKEN_CONTEXT } from './token-presets.js';
import { THEME_REGISTRY, THEME_RESOLVER } from './theme-presets.js';
import { acceptChampionMessage } from './champion-sync.js';

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
let lastChampionSnapshot = null;
channel.addEventListener('message', (event) => {
    if (event.data?.mint && event.data.mint !== tokenContext.identity.mint) return;
    const themeId = event.data?.presentation?.themeId;
    if (themeId) {
        currentTheme = THEME_REGISTRY.resolve(themeId);
        engine.setTheme(pixelPresentation(currentTheme));
    }
    if (event.data?.champion) {
        const accepted = acceptChampionMessage(
            lastChampionSnapshot,
            event.data.champion,
            tokenContext.identity.mint,
            Date.now(),
        );
        if (accepted.accepted) lastChampionSnapshot = accepted.snapshot;
    }
    engine.setSnapshot({ ...event.data, champion: lastChampionSnapshot });
});
engine.start();
if (import.meta.env.DEV || new URLSearchParams(window.location.search).has('diagnostics')) {
    window.__ansemPixelEngine = engine;
}
window.addEventListener('pagehide', () => {
    engine.destroy();
    channel.close();
});
