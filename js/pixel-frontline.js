import { PixelFrontline } from './pixel-engine.js';
import { tokenCacheKey } from './token-context.js';
import { DEFAULT_TOKEN_CONTEXT } from './token-presets.js';

const canvas = document.getElementById('pixel-frontline-canvas');
const engine = new PixelFrontline(canvas);
const channel = new BroadcastChannel(tokenCacheKey('ansem-frontline:pixel', DEFAULT_TOKEN_CONTEXT, 'v1'));
channel.addEventListener('message', (event) => engine.setSnapshot(event.data));
engine.start();
if (import.meta.env.DEV || new URLSearchParams(window.location.search).has('diagnostics')) {
    window.__ansemPixelEngine = engine;
}
window.addEventListener('pagehide', () => {
    engine.destroy();
    channel.close();
});
