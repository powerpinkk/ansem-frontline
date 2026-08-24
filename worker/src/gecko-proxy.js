const GECKO_ROUTE = /^\/gecko\/networks\/solana\/pools\/([1-9A-HJ-NP-Za-km-z]{32,44})\/(trades|ohlcv\/minute)$/;

export function parseGeckoProxyUrl(requestUrl) {
    const url = new URL(requestUrl);
    const match = url.pathname.match(GECKO_ROUTE);
    if (!match) return null;

    const [, poolAddress, resource] = match;
    const upstream = new URL(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolAddress}/${resource}`);
    if (resource === 'ohlcv/minute') {
        const requestedLimit = Number.parseInt(url.searchParams.get('limit') || '60', 10);
        upstream.searchParams.set('limit', String(Math.max(1, Math.min(60, Number.isFinite(requestedLimit) ? requestedLimit : 60))));
    }
    return { upstream: upstream.toString(), cacheTtl: resource === 'trades' ? 8 : 30 };
}

export async function fetchGeckoProxy(request, origin, allowedOrigin) {
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    const route = parseGeckoProxyUrl(request.url);
    if (!route) return new Response('Not found', { status: 404 });

    try {
        const upstream = await fetch(route.upstream, {
            headers: { accept: 'application/json', 'user-agent': 'ANSEM-Frontline/2.0' },
            signal: AbortSignal.timeout(8_000),
            cf: { cacheEverything: true, cacheTtl: route.cacheTtl },
        });
        const headers = proxyHeaders(origin, allowedOrigin, route.cacheTtl);
        if (!upstream.ok) {
            return Response.json({ error: 'Market history temporarily unavailable' }, { status: upstream.status, headers });
        }
        return new Response(upstream.body, { status: 200, headers });
    } catch (error) {
        console.error('[gecko-proxy]', error instanceof Error ? error.name : 'UnknownError');
        return Response.json({ error: 'Market history temporarily unavailable' }, {
            status: 503,
            headers: proxyHeaders(origin, allowedOrigin, 2),
        });
    }
}

function proxyHeaders(origin, allowedOrigin, maxAge) {
    return {
        'access-control-allow-origin': origin || allowedOrigin,
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `public, max-age=${maxAge}`,
        vary: 'Origin',
    };
}
