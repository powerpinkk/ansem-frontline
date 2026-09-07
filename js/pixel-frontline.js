import { PixelFrontline } from './pixel-engine.js';
import { tokenCacheKey, validateSolanaMint } from './token-context.js';
import { DEFAULT_TOKEN_CONTEXT } from './token-presets.js';

const canvas = document.getElementById('pixel-frontline-canvas');
const engine = new PixelFrontline(canvas);
const requestedMint = new URLSearchParams(window.location.search).get('token');
const validation = validateSolanaMint(requestedMint || DEFAULT_TOKEN_CONTEXT.identity.mint);
const channelContext = validation.ok ? validation.value : DEFAULT_TOKEN_CONTEXT;
const channel = new BroadcastChannel(tokenCacheKey('ansem-frontline:pixel', channelContext, 'v1'));
channel.addEventListener('message', (event) => engine.setSnapshot(event.data));
engine.start();
if (import.meta.env.DEV || new URLSearchParams(window.location.search).has('diagnostics')) {
    window.__ansemPixelEngine = engine;
}
window.addEventListener('pagehide', () => {
    engine.destroy();
    channel.close();
});
