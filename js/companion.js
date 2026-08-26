import { PixelFrontline, createPixelSnapshot } from './pixel-engine.js';
import { state } from './state.js';

const CHANNEL_NAME = 'ansem-frontline-pixel';

export function initPixelCompanion({ setSceneActive }) {
    const button = document.getElementById('pixel-mode-btn');
    const returnButton = document.getElementById('companion-return');
    const dockScreen = document.getElementById('companion-dock-screen');
    if (!button || !dockScreen) return;

    const channel = new BroadcastChannel(CHANNEL_NAME);
    let companionWindow = null;
    let embeddedEngine = null;
    let publishTimer = 0;
    let closePoll = 0;

    const publish = () => {
        const snapshot = createPixelSnapshot(state);
        channel.postMessage(snapshot);
        embeddedEngine?.setSnapshot(snapshot);
    };

    const restoreMain = () => {
        window.clearInterval(publishTimer);
        window.clearInterval(closePoll);
        publishTimer = 0;
        closePoll = 0;
        embeddedEngine?.destroy();
        embeddedEngine = null;
        if (companionWindow && !companionWindow.closed) companionWindow.close();
        companionWindow = null;
        document.body.classList.remove('companion-active');
        dockScreen.hidden = true;
        window.__ansemCompanionActive = false;
        setSceneActive(!document.hidden);
        button.setAttribute('aria-pressed', 'false');
    };

    const activateMainDock = () => {
        document.body.classList.add('companion-active');
        dockScreen.hidden = false;
        window.__ansemCompanionActive = true;
        setSceneActive(false);
        button.setAttribute('aria-pressed', 'true');
        publish();
        publishTimer = window.setInterval(publish, 500);
        closePoll = window.setInterval(() => {
            if (!companionWindow || companionWindow.closed) restoreMain();
        }, 700);
    };

    const createPictureInPictureSurface = async () => {
        const pip = await window.documentPictureInPicture.requestWindow({ width: 960, height: 170 });
        pip.document.title = '$ANSEM Pixel Frontline · 30S';
        const style = pip.document.createElement('style');
        style.textContent = '*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#020403}canvas{display:block;width:100%;height:100%;image-rendering:pixelated}';
        const canvas = pip.document.createElement('canvas');
        canvas.setAttribute('aria-label', 'Pixel battlefield driven by verified swaps from the last 30 seconds');
        pip.document.head.append(style);
        pip.document.body.append(canvas);
        embeddedEngine = new PixelFrontline(canvas);
        embeddedEngine.start();
        pip.addEventListener('pagehide', restoreMain, { once: true });
        return pip;
    };

    const createPopupSurface = () => {
        const width = Math.min(1040, Math.max(680, window.screen.availWidth - 100));
        const height = 180;
        const left = Math.max(0, Math.floor((window.screen.availWidth - width) / 2));
        const top = Math.max(0, window.screen.availHeight - height - 24);
        const popup = window.open(
            '/pixel-frontline.html',
            'ansem-pixel-frontline',
            `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes`,
        );
        if (!popup) return null;
        try {
            popup.moveTo(left, top);
            popup.resizeTo(width, height);
        } catch {
            // The OS/browser may ignore placement. The companion remains usable.
        }
        return popup;
    };

    button.addEventListener('click', async () => {
        if (window.__ansemCompanionActive) {
            companionWindow?.focus();
            return;
        }
        try {
            companionWindow = window.documentPictureInPicture?.requestWindow
                ? await createPictureInPictureSurface()
                : createPopupSurface();
        } catch {
            companionWindow = createPopupSurface();
        }
        if (!companionWindow) {
            button.classList.add('popup-blocked');
            window.setTimeout(() => button.classList.remove('popup-blocked'), 1_800);
            return;
        }
        activateMainDock();
    });

    returnButton?.addEventListener('click', restoreMain);
    window.addEventListener('pagehide', () => {
        window.clearInterval(publishTimer);
        window.clearInterval(closePoll);
        channel.close();
    });
}
