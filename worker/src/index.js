export { StreamHub } from './stream-hub.js';
import { parseClientConfiguration } from './configuration.js';
import { normalizeHeliusMarket, SOL_MINT } from './market-fallback.js';
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
            return Response.json({ ok: true, service: 'ansem-frontline-stream' }, { headers });
        }
        if (url.pathname === '/market') {
            const token = resolveRequestMint(url, env.DEFAULT_TOKEN_MINT);
            if (!token.ok) return invalidMintResponse(token, origin, allowedOrigins);
            return fetchFallbackMarket(env, origin, token.mint, allowedOrigins);
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

async function fetchFallbackMarket(env, origin, mint, allowedOrigins) {
    try {
        const [token, sol] = await Promise.all([
            fetchHeliusAsset(env, mint),
            fetchHeliusAsset(env, SOL_MINT),
        ]);
        const market = normalizeHeliusMarket(token, sol, { mint });
        if (!market) throw new Error('Helius price data unavailable');
        if (!market.pools.length) {
            return Response.json({
                status: market.status,
                error: { code: 'NO_SAFE_FALLBACK_POOLS', message: 'No verified fallback pools are configured for this mint' },
                token: market.token,
            }, { status: 422, headers: corsHeaders(origin, allowedOrigins) });
        }
        return Response.json(market, { headers: corsHeaders(origin, allowedOrigins) });
    } catch (error) {
        console.error('[market-fallback] request failed', error instanceof Error ? error.name : 'UnknownError');
        return Response.json({ error: 'Market fallback unavailable' }, { status: 503, headers: corsHeaders(origin, allowedOrigins) });
    }
}

async function fetchHeliusAsset(env, mint) {
    const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(env.HELIUS_API_KEY)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0', id: mint, method: 'getAsset',
            params: { id: mint, displayOptions: { showFungible: true } },
        }),
        signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Helius asset ${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new Error(`Helius asset RPC ${payload.error.code}`);
    if (payload.result?.id !== mint) throw new Error('Helius asset identity mismatch');
    return payload.result;
}

function invalidMintResponse(result, origin, allowedOrigin) {
    return Response.json({ status: 'invalid-mint', error: result.error }, {
        status: result.status || 400,
        headers: corsHeaders(origin, allowedOrigin),
    });
}
