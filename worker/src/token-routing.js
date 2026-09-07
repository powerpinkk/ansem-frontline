import { tokenNamespace, validateSolanaMint } from '../../js/token-context.js';

export function resolveRequestMint(url, defaultMint = '') {
    const parsed = typeof url === 'string' ? new URL(url) : url;
    const validation = validateSolanaMint(parsed.searchParams.get('mint') || defaultMint);
    return validation.ok
        ? { ok: true, mint: validation.value }
        : { ok: false, status: 400, error: { code: validation.code, message: validation.message } };
}

export function streamObjectName(mint) {
    return `frontline-stream:${tokenNamespace(mint)}`;
}

export function recentCacheUrl(configuration) {
    const pools = configuration.pools.map((pool) => pool.address).sort().join(',');
    const mint = configuration.token.mint;
    return `https://frontline-cache.invalid/recent/${encodeURIComponent(mint)}?pools=${encodeURIComponent(pools)}`;
}
