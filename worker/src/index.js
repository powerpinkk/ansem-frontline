export { StreamHub } from './stream-hub.js';
import { parseClientConfiguration } from './configuration.js';
import { fetchGeckoProxy } from './gecko-proxy.js';
import { corsHeaders, isAllowedOrigin } from './origin-policy.js';
import { resolveRequestMint, streamObjectName } from './token-routing.js';

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const origin = request.headers.get('Origin');
        const allowedOrigins = env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN;
        if (!isAllowedOrigin(origin, allowedOrigins)) return new Response('Origin not allowed', { status: 403 });
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin, allowedOrigins) });
        if (url.pathname === '/health') {
            const headers = corsHeaders(origin, allowedOrigins);
            headers['cache-control'] = 'no-store';
            return Response.json({ ok: true, service: 'ansem-frontline-stream',
                buildId: env.WORKER_BUILD_ID || 'ansem-frontline-worker-recovery-v1',
                envelopeVersion: 4, healthSchemaVersion: 1 }, { headers });
        }
        if (url.pathname === '/market') {
            const token = resolveRequestMint(url, env.DEFAULT_TOKEN_MINT);
            if (!token.ok) return invalidMintResponse(token, origin, allowedOrigins);
            return fetchTokenObject(request, env, origin, allowedOrigins, token.mint);
        }
        if (url.pathname === '/recent') return fetchRecentSnapshot(request, env, origin, allowedOrigins);
        if (url.pathname.startsWith('/gecko/')) return fetchGeckoProxy(request, origin, allowedOrigins);
        if (url.pathname !== '/stream') return new Response('Not found', { status: 404 });
        const token = resolveRequestMint(url, env.DEFAULT_TOKEN_MINT);
        if (!token.ok) return invalidMintResponse(token, origin, allowedOrigins);
        const id = env.STREAM_HUB.idFromName(streamObjectName(token.mint));
        return env.STREAM_HUB.get(id).fetch(request);
    },
};

async function fetchTokenObject(request, env, origin, allowedOrigins, mint) {
    const url = new URL(request.url);
    url.searchParams.set('mint', mint);
    const id = env.STREAM_HUB.idFromName(streamObjectName(mint));
    const response = await env.STREAM_HUB.get(id).fetch(new Request(url, { method: request.method,
        headers: { accept: 'application/json' } }));
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders(origin, allowedOrigins))) headers.set(key, value);
    headers.set('access-control-expose-headers', 'Retry-After');
    if (!response.ok) headers.set('cache-control', 'no-store');
    return new Response(response.body, { status: response.status, headers });
}

async function fetchRecentSnapshot(request, env, origin, allowedOrigins) {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders(origin, allowedOrigins) });
    const raw = await request.text();
    const configuration = parseClientConfiguration(raw, { defaultMint: env.DEFAULT_TOKEN_MINT });
    if (!configuration) return new Response('Invalid configuration', { status: 400, headers: corsHeaders(origin, allowedOrigins) });
    const url = new URL(request.url);
    url.searchParams.set('mint', configuration.token.mint);
    const id = env.STREAM_HUB.idFromName(streamObjectName(configuration.token.mint));
    const response = await env.STREAM_HUB.get(id).fetch(new Request(url, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'configure', token: configuration.token }) }));
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders(origin, allowedOrigins))) headers.set(key, value);
    headers.set('cache-control', 'no-store');
    return new Response(response.body, { status: response.status, headers });
}

function invalidMintResponse(result, origin, allowedOrigin) {
    return Response.json({ status: 'invalid-mint', error: result.error }, {
        status: result.status || 400,
        headers: corsHeaders(origin, allowedOrigin),
    });
}
