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
    return { upstream: upstream.toString(), resource, cacheTtl: resource === 'trades' ? 12 : 30 };
}

export async function fetchGeckoProxy(request, origin, allowedOrigin) {
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    const route = parseGeckoProxyUrl(request.url);
    if (!route) return new Response('Not found', { status: 404 });

    try {
        const edgeCache = typeof caches === 'undefined' ? null : caches.default;
        const cacheKey = new Request(route.upstream, { headers: { accept: 'application/json' } });
        const cached = await edgeCache?.match(cacheKey);
        if (cached) return wrapProxyResponse(cached, origin, allowedOrigin, route.cacheTtl, 'edge-cache');

        const upstream = await fetch(route.upstream, {
            headers: { accept: 'application/json', 'user-agent': 'ANSEM-Frontline/2.0' },
            signal: AbortSignal.timeout(8_000),
        });
        const headers = proxyHeaders(origin, allowedOrigin, route.cacheTtl);
        if (!upstream.ok) {
            if (upstream.status === 429) {
                headers.set('x-market-data-status', 'rate-limited-empty');
                return Response.json(emptyGeckoPayload(route.resource), { status: 200, headers });
            }
            return Response.json({ error: 'Market history temporarily unavailable' }, { status: upstream.status, headers });
        }
        const cacheable = new Response(upstream.clone().body, {
            status: 200,
            headers: {
                'content-type': 'application/json; charset=utf-8',
                'cache-control': `public, max-age=${route.cacheTtl}`,
            },
        });
        await edgeCache?.put(cacheKey, cacheable);
        return wrapProxyResponse(upstream, origin, allowedOrigin, route.cacheTtl, 'upstream');
    } catch (error) {
        console.error('[gecko-proxy]', error instanceof Error ? error.name : 'UnknownError');
        return Response.json({ error: 'Market history temporarily unavailable' }, {
            status: 503,
            headers: proxyHeaders(origin, allowedOrigin, 2),
        });
    }
}

export function emptyGeckoPayload(resource) {
    return resource === 'trades'
        ? { data: [] }
        : { data: { attributes: { ohlcv_list: [] } } };
}

function wrapProxyResponse(response, origin, allowedOrigin, cacheTtl, source) {
    const headers = proxyHeaders(origin, allowedOrigin, cacheTtl);
    headers.set('x-market-data-status', source);
    return new Response(response.body, { status: 200, headers });
}

function proxyHeaders(origin, allowedOrigin, maxAge) {
    return new Headers({
        'access-control-allow-origin': origin || allowedOrigin,
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `public, max-age=${maxAge}`,
        vary: 'Origin',
    });
}
