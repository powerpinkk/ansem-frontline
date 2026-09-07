import { validateSolanaMint } from './token-context.js';

export const TOKEN_QUERY_PARAMETER = 'token';

export function readTokenRoute(value) {
    const url = toUrl(value);
    const requested = url.searchParams.get(TOKEN_QUERY_PARAMETER);
    if (requested === null) return { kind: 'default', mint: null };
    const validation = validateSolanaMint(requested);
    return validation.ok
        ? { kind: 'token', mint: validation.value }
        : { kind: 'invalid', mint: requested.slice(0, 80), validation };
}

export function buildTokenUrl(value, mint, defaultMint) {
    const url = toUrl(value);
    const validation = validateSolanaMint(mint);
    if (!validation.ok) throw new TypeError(validation.message);
    if (validation.value === defaultMint) url.searchParams.delete(TOKEN_QUERY_PARAMETER);
    else url.searchParams.set(TOKEN_QUERY_PARAMETER, validation.value);
    return url;
}

export function historyPath(url) {
    const parsed = toUrl(url);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function toUrl(value) {
    if (value instanceof URL) return new URL(value.toString());
    return new URL(String(value), 'https://frontline.local/');
}
