import { CHAMPION_STATUS } from './champion-state.js';

export function initChampionUI({ documentRef = document, windowRef = window, now = () => Date.now() } = {}) {
    const root = documentRef.getElementById('champion-status');
    const label = documentRef.getElementById('champion-status-label');
    const countdown = documentRef.getElementById('champion-countdown');
    const announcement = documentRef.getElementById('champion-announcement');
    let snapshot = null;
    let interval = 0;
    let lastSemanticStatus = CHAMPION_STATUS.INACTIVE;
    let updates = 0;

    const stopCountdown = () => {
        if (interval) windowRef.clearInterval(interval);
        interval = 0;
    };

    const renderTime = () => {
        if (!snapshot || snapshot.status !== CHAMPION_STATUS.ACTIVE || snapshot.expiresAt <= now()) return;
        const remaining = Math.max(0, snapshot.expiresAt - now());
        const minutes = Math.floor(remaining / 60_000);
        const seconds = Math.floor((remaining % 60_000) / 1_000);
        const text = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        if (countdown) countdown.textContent = text;
        root?.setAttribute('aria-label', `Simulated User Champion active, ${minutes} minutes ${seconds} seconds remaining`);
    };

    const setSnapshot = (next) => {
        stopCountdown();
        snapshot = next;
        updates += 1;
        const active = next?.status === CHAMPION_STATUS.ACTIVE && next.expiresAt > now();
        if (root) root.hidden = !active;
        if (label) label.textContent = active ? 'USER CHAMPION · SIMULATED' : 'USER CHAMPION';
        if (active) {
            renderTime();
            interval = windowRef.setInterval(renderTime, 1_000);
        }
        const semanticStatus = active ? CHAMPION_STATUS.ACTIVE : next?.status || CHAMPION_STATUS.INACTIVE;
        if (announcement && semanticStatus !== lastSemanticStatus) {
            announcement.textContent = semanticStatus === CHAMPION_STATUS.ACTIVE
                ? 'Simulated User Champion activated.'
                : lastSemanticStatus === CHAMPION_STATUS.ACTIVE
                    ? 'User Champion expired or was deactivated.'
                    : '';
        }
        lastSemanticStatus = semanticStatus;
    };

    return Object.freeze({
        setSnapshot,
        getDiagnostics: () => Object.freeze({
            status: snapshot?.status || CHAMPION_STATUS.INACTIVE,
            mint: snapshot?.mint || null,
            countdownTimerCount: interval ? 1 : 0,
            updates,
            visible: root ? !root.hidden : false,
        }),
        destroy() {
            stopCountdown();
            snapshot = null;
            if (root) root.hidden = true;
        },
    });
}
