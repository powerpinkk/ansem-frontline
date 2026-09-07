import { TOKEN_UI_STATUS } from './token-controller.js';

const CONNECTION_LABELS = {
    connecting: 'CONNECTING',
    online: 'LIVE',
    offline: 'OFFLINE',
    degraded: 'DEGRADED',
};

export function createTokenViewModel(context) {
    const identity = context?.identity || {};
    const referencePool = context?.resources?.referencePool || null;
    return {
        mint: String(identity.mint || '').slice(0, 44),
        shortMint: shortenAddress(identity.mint),
        symbol: boundedDisplayText(identity.symbol, 16) || 'TOKEN',
        name: boundedDisplayText(identity.name, 80) || 'Solana token',
        imageUrl: safeTokenImageUrl(context?.metadata?.imageUrl),
        supply: context?.supply === null || context?.supply === undefined
            ? null
            : formatSupply(context.supply),
        pool: referencePool ? `${boundedDisplayText(referencePool.dexId, 40) || 'SOLANA'} · ${shortenAddress(referencePool.address)}` : null,
        source: boundedDisplayText(context?.discovery?.source, 40) || 'configuration',
    };
}

export function safeTokenImageUrl(value) {
    if (!value) return null;
    try {
        const url = new URL(String(value));
        return url.protocol === 'https:' ? url.toString() : null;
    } catch {
        return null;
    }
}

export function shortenAddress(value) {
    const text = String(value || '');
    return text.length > 16 ? `${text.slice(0, 6)}…${text.slice(-6)}` : text;
}

export async function copyText(value, {
    clipboard = globalThis.navigator?.clipboard,
    documentRef = globalThis.document,
} = {}) {
    const text = String(value || '').slice(0, 2_048);
    if (!text) return false;
    try {
        if (clipboard?.writeText) {
            await clipboard.writeText(text);
            return true;
        }
    } catch {
        // Continue to the selection-based fallback below.
    }
    if (!documentRef?.createElement || typeof documentRef.execCommand !== 'function') return false;
    const field = documentRef.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    documentRef.body.append(field);
    field.select();
    let copied;
    try {
        copied = documentRef.execCommand('copy');
    } finally {
        field.remove();
    }
    return copied;
}

export function initTokenUI({ onSubmit, onDefault, getCurrentUrl = () => window.location.href }) {
    const dom = {
        panel: document.getElementById('token-panel'),
        form: document.getElementById('token-form'),
        input: document.getElementById('token-mint-input'),
        load: document.getElementById('token-load-btn'),
        defaultButton: document.getElementById('token-default-btn'),
        status: document.getElementById('token-resolution-status'),
        data: document.getElementById('token-data'),
        image: document.getElementById('token-image'),
        imageFallback: document.getElementById('token-image-fallback'),
        symbol: document.getElementById('token-symbol'),
        name: document.getElementById('token-name'),
        mint: document.getElementById('token-mint-display'),
        supplyRow: document.getElementById('token-supply-row'),
        supply: document.getElementById('token-supply'),
        poolRow: document.getElementById('token-pool-row'),
        pool: document.getElementById('token-pool'),
        source: document.getElementById('token-source'),
        connection: document.getElementById('token-data-connection'),
        copyMint: document.getElementById('copy-token-mint'),
        copyUrl: document.getElementById('copy-token-url'),
    };
    let currentContext = null;
    const copyTimers = new Map();

    dom.form?.addEventListener('submit', (event) => {
        event.preventDefault();
        const mint = String(dom.input?.value || '').trim();
        if (dom.input) dom.input.value = mint;
        onSubmit?.(mint);
    });
    dom.defaultButton?.addEventListener('click', () => onDefault?.());
    dom.copyMint?.addEventListener('click', () => void copyWithFeedback(dom.copyMint, currentContext?.identity?.mint, 'CA COPIED'));
    dom.copyUrl?.addEventListener('click', () => void copyWithFeedback(dom.copyUrl, getCurrentUrl(), 'LINK COPIED'));
    dom.image?.addEventListener('error', () => showImageFallback());

    const copyWithFeedback = async (button, value, successLabel) => {
        const copied = await copyText(value);
        window.clearTimeout(copyTimers.get(button));
        const original = button.textContent;
        button.textContent = copied ? successLabel : 'COPY FAILED';
        copyTimers.set(button, window.setTimeout(() => {
            button.textContent = original;
            copyTimers.delete(button);
        }, 1_800));
    };

    const showImageFallback = () => {
        if (dom.image) {
            dom.image.hidden = true;
            dom.image.removeAttribute('src');
        }
        if (dom.imageFallback) dom.imageFallback.hidden = false;
    };

    const renderContext = (context) => {
        currentContext = context || null;
        if (!context) {
            if (dom.data) dom.data.hidden = true;
            return;
        }
        const view = createTokenViewModel(context);
        if (dom.data) dom.data.hidden = false;
        if (dom.input && document.activeElement !== dom.input) dom.input.value = view.mint;
        setText(dom.symbol, view.symbol);
        setText(dom.name, view.name);
        setText(dom.mint, view.shortMint);
        if (dom.mint) dom.mint.title = view.mint;
        setText(dom.source, view.source.toUpperCase());
        if (dom.supplyRow) dom.supplyRow.hidden = view.supply === null;
        if (view.supply !== null) setText(dom.supply, view.supply);
        if (dom.poolRow) dom.poolRow.hidden = !view.pool;
        if (view.pool) setText(dom.pool, view.pool.toUpperCase());
        setText(dom.imageFallback, view.symbol.slice(0, 1).toUpperCase());
        if (view.imageUrl && dom.image) {
            dom.image.src = view.imageUrl;
            dom.image.alt = `${view.name} token logo`;
            dom.image.hidden = false;
            if (dom.imageFallback) dom.imageFallback.hidden = true;
        } else {
            showImageFallback();
        }
    };

    return {
        setState({ status, context, requestedMint, error } = {}) {
            const resolving = status === TOKEN_UI_STATUS.RESOLVING;
            if (dom.panel) dom.panel.setAttribute('aria-busy', String(resolving));
            if (dom.load) {
                dom.load.disabled = resolving;
                dom.load.textContent = resolving ? 'WAIT' : 'LOAD';
            }
            if (context) renderContext(context);
            else if (status !== TOKEN_UI_STATUS.RESOLVING) renderContext(null);
            if (dom.status) {
                dom.status.className = `token-resolution-status ${status || TOKEN_UI_STATUS.DEFAULT}`;
                dom.status.textContent = statusMessage(status, { context, requestedMint, error });
            }
        },
        renderContext,
        setConnection(status) {
            if (!dom.connection) return;
            dom.connection.className = `token-data-connection ${status}`;
            dom.connection.textContent = CONNECTION_LABELS[status] || String(status || '').toUpperCase();
        },
        focusInput() {
            dom.input?.focus();
            dom.input?.select();
        },
        destroy() {
            copyTimers.forEach((timer) => window.clearTimeout(timer));
            copyTimers.clear();
        },
    };
}

function statusMessage(status, { context, requestedMint } = {}) {
    const label = context?.identity?.symbol || shortenAddress(requestedMint) || 'Token';
    switch (status) {
        case TOKEN_UI_STATUS.DEFAULT:
            return 'ANSEM is the default Frontline token.';
        case TOKEN_UI_STATUS.RESOLVING:
            return `Resolving ${shortenAddress(requestedMint)} and compatible pools…`;
        case TOKEN_UI_STATUS.RESOLVED:
            return `${label} resolved. Frontline is using this token.`;
        case TOKEN_UI_STATUS.INVALID:
            return 'Enter a valid 32-byte Solana mint using base58 characters.';
        case TOKEN_UI_STATUS.UNAVAILABLE:
            return 'This mint is valid, but no usable Solana market data was found.';
        case TOKEN_UI_STATUS.UNSUPPORTED:
            return 'This token is valid, but its available pools are not supported yet.';
        case TOKEN_UI_STATUS.TEMPORARY_ERROR:
            return 'Token discovery is temporarily unavailable. Try again shortly.';
        case TOKEN_UI_STATUS.UPSTREAM_FAILURE:
            return 'The market-data provider returned an invalid or unavailable response.';
        default:
            return 'Ready to load a Solana token.';
    }
}

function boundedDisplayText(value, maximum) {
    return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function formatSupply(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return null;
    return number.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function setText(element, value) {
    if (element) element.textContent = String(value ?? '');
}
