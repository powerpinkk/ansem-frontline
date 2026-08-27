import {
    PIXEL_SOURCE_HEIGHT,
    PIXEL_SOURCE_WIDTH,
    PixelFrontline,
    createPixelSnapshot,
} from './pixel-engine.js';
import { state } from './state.js';

const CHANNEL_NAME = 'ansem-frontline-pixel';
const PIP_WIDTH = PIXEL_SOURCE_WIDTH;
const PIP_HEIGHT = PIXEL_SOURCE_HEIGHT;

export function initPixelCompanion({ setSceneActive }) {
    const button = document.getElementById('pixel-mode-btn');
    const returnButton = document.getElementById('companion-return');
    const dockScreen = document.getElementById('companion-dock-screen');
    if (!button || !dockScreen) return;

    const channel = new BroadcastChannel(CHANNEL_NAME);
    const canvas = document.createElement('canvas');
    const video = document.createElement('video');
    let videoEngine = null;
    let documentEngine = null;
    let companionWindow = null;
    let stream = null;
    let mode = null;
    let publishTimer = 0;
    let pipRequested = false;
    let restoring = false;

    canvas.width = PIP_WIDTH;
    canvas.height = PIP_HEIGHT;
    canvas.className = 'pixel-pip-source';
    canvas.style.width = `${PIP_WIDTH}px`;
    canvas.style.height = `${PIP_HEIGHT}px`;
    canvas.setAttribute('aria-hidden', 'true');
    video.className = 'pixel-pip-video';
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.disablePictureInPicture = false;
    video.setAttribute('aria-hidden', 'true');
    document.body.append(canvas, video);

    videoEngine = new PixelFrontline(canvas);
    const publish = () => {
        const snapshot = createPixelSnapshot(state);
        channel.postMessage(snapshot);
        videoEngine?.setSnapshot(snapshot);
        documentEngine?.setSnapshot(snapshot);
    };
    publish();
    videoEngine.draw(performance.now());

    if (typeof canvas.captureStream === 'function') {
        stream = canvas.captureStream(24);
        video.srcObject = stream;
        void video.play().catch(() => {});
    }

    const setUnavailableState = () => {
        button.classList.add('pip-unavailable');
        button.setAttribute('aria-label', 'Picture-in-Picture is unavailable in this browser');
        window.setTimeout(() => {
            button.classList.remove('pip-unavailable');
            button.setAttribute('aria-label', 'Open the 30-second pixel companion in Picture-in-Picture');
        }, 2_800);
    };

    const activateMainDock = (nextMode) => {
        mode = nextMode;
        document.body.classList.add('companion-active');
        dockScreen.hidden = false;
        window.__ansemCompanionActive = true;
        setSceneActive(false);
        button.setAttribute('aria-pressed', 'true');
        publish();
        if (mode === 'video') videoEngine.start();
        publishTimer = window.setInterval(publish, 500);
    };

    const restoreMain = async ({ exitPip = true } = {}) => {
        if (restoring) return;
        restoring = true;
        window.clearInterval(publishTimer);
        publishTimer = 0;
        if (mode === 'video') videoEngine.destroy();
        if (mode === 'document') {
            documentEngine?.destroy();
            documentEngine = null;
            if (exitPip && companionWindow && !companionWindow.closed) companionWindow.close();
            companionWindow = null;
        }
        if (exitPip && document.pictureInPictureElement === video) {
            try {
                await document.exitPictureInPicture();
            } catch {
                // The user agent may already be closing the native PiP surface.
            }
        }
        mode = null;
        document.body.classList.remove('companion-active');
        dockScreen.hidden = true;
        window.__ansemCompanionActive = false;
        setSceneActive(!document.hidden);
        button.setAttribute('aria-pressed', 'false');
        restoring = false;
    };

    video.addEventListener('leavepictureinpicture', () => {
        void restoreMain({ exitPip: false });
    });

    const openVideoPictureInPicture = async () => {
        const supported = stream
            && typeof video.requestPictureInPicture === 'function'
            && document.pictureInPictureEnabled !== false;
        if (!supported) return false;
        publish();
        videoEngine.draw(performance.now());
        await video.play();
        pipRequested = true;
        await video.requestPictureInPicture();
        activateMainDock('video');
        return true;
    };

    const openDocumentPictureInPicture = async () => {
        if (typeof window.documentPictureInPicture?.requestWindow !== 'function') return false;
        const pip = await window.documentPictureInPicture.requestWindow({ width: PIP_WIDTH, height: PIP_HEIGHT });
        pip.document.title = '$ANSEM Pixel Frontline · 30S';
        const style = pip.document.createElement('style');
        style.textContent = '*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#020403}canvas{display:block;width:100%;height:100%;image-rendering:pixelated}';
        const pipCanvas = pip.document.createElement('canvas');
        pipCanvas.width = PIP_WIDTH;
        pipCanvas.height = PIP_HEIGHT;
        pipCanvas.setAttribute('aria-label', 'Pixel battlefield and real-time 30-second price trace');
        pip.document.head.append(style);
        pip.document.body.append(pipCanvas);
        companionWindow = pip;
        documentEngine = new PixelFrontline(pipCanvas);
        documentEngine.start();
        pip.addEventListener('pagehide', () => void restoreMain({ exitPip: false }), { once: true });
        activateMainDock('document');
        return true;
    };

    button.addEventListener('click', async () => {
        if (window.__ansemCompanionActive) {
            await restoreMain();
            return;
        }
        button.classList.remove('pip-unavailable');
        try {
            // The standard video API is preferred: the canvas is captured as a
            // real video stream, so the browser opens its native always-on-top
            // PiP surface instead of a tab or ordinary popup.
            if (await openVideoPictureInPicture()) return;
            if (await openDocumentPictureInPicture()) return;
        } catch (error) {
            console.warn('[pixel-pip]', error);
            if (!window.__ansemCompanionActive) {
                try {
                    if (await openDocumentPictureInPicture()) return;
                } catch (fallbackError) {
                    console.warn('[pixel-document-pip]', fallbackError);
                }
            }
        }
        setUnavailableState();
    });

    returnButton?.addEventListener('click', () => void restoreMain());
    window.__ansemCompanionDiagnostics = () => ({
        active: Boolean(window.__ansemCompanionActive),
        mode,
        pipRequested,
        hasVideoPip: typeof video.requestPictureInPicture === 'function',
        hasDocumentPip: typeof window.documentPictureInPicture?.requestWindow === 'function',
        pixel: videoEngine?.getDiagnostics() || null,
    });
    window.addEventListener('pagehide', () => {
        window.clearInterval(publishTimer);
        documentEngine?.destroy();
        videoEngine?.destroy();
        stream?.getTracks().forEach((track) => track.stop());
        channel.close();
    });
}
