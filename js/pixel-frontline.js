import { PixelFrontline } from './pixel-engine.js';

const canvas = document.getElementById('pixel-frontline-canvas');
const engine = new PixelFrontline(canvas);
const channel = new BroadcastChannel('ansem-frontline-pixel');
channel.addEventListener('message', (event) => engine.setSnapshot(event.data));
engine.start();
if (import.meta.env.DEV || new URLSearchParams(window.location.search).has('diagnostics')) {
    window.__ansemPixelEngine = engine;
}
window.addEventListener('pagehide', () => {
    engine.destroy();
    channel.close();
});
