const LOCAL_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/;

export function configuredOrigins(value) {
    return String(value || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
}

export function isAllowedOrigin(origin, configuration) {
    const allowedOrigins = configuredOrigins(configuration);
    return !origin
        || allowedOrigins.length === 0
        || allowedOrigins.includes(origin)
        || LOCAL_ORIGIN.test(origin);
}

export function corsHeaders(origin, configuration) {
    const fallbackOrigin = configuredOrigins(configuration)[0];
    const responseOrigin = origin && isAllowedOrigin(origin, configuration) ? origin : fallbackOrigin;
    return {
        ...(responseOrigin ? { 'access-control-allow-origin': responseOrigin } : {}),
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        vary: 'Origin',
        'cache-control': 'public, max-age=15',
    };
}
