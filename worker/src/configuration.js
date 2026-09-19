import { validateSolanaMint } from '../../js/token-context.js';

// Identifiers only. Legacy browser quotes, labels, pools and conclusions are
// ignored; the server independently discovers and validates its subscriptions.
export function parseClientConfiguration(raw, { expectedMint = '', defaultMint = '' } = {}) {
    if (typeof raw !== 'string' || raw.length > 8000) return null;
    let message;
    try { message = JSON.parse(raw); } catch { return null; }
    if (message?.type !== 'configure') return null;
    const validation = validateSolanaMint(message.token?.mint || message.mint || defaultMint);
    if (!validation.ok || (expectedMint && validation.value !== expectedMint)
        || (message.token?.chain && message.token.chain !== 'solana')) return null;
    return { token: { mint: validation.value, chain: 'solana' } };
}
