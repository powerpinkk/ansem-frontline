import { DurableObject } from 'cloudflare:workers';
import { parseTransaction } from './parser.js';
import { parseClientConfiguration } from './configuration.js';
import { normalizeHeliusMarket, SOL_MINT } from './market-fallback.js';
import { fetchGeckoProxy } from './gecko-proxy.js';
import { fetchRecentTrades } from './recent-trades.js';
import { corsHeaders, isAllowedOrigin } from './origin-policy.js';
import { recentCacheUrl, resolveRequestMint, streamObjectName } from './token-routing.js';

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const origin = request.headers.get('Origin');
        const allowedOrigins = env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN;
        if (!isAllowedOrigin(origin, allowedOrigins)) return new Response('Origin not allowed', { status: 403 });
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin, allowedOrigins) });
        if (url.pathname === '/health') {
            return Response.json({ ok: true, service: 'ansem-frontline-stream' });
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
    if (request.method !== 'POST') {
        return Response.json({ error: 'Method not allowed' }, {
            status: 405,
            headers: corsHeaders(origin, allowedOrigins),
        });
    }
    try {
        const raw = await request.text();
        if (raw.length > 8_000) throw new Error('Configuration too large');
        const configuration = parseClientConfiguration(raw, { defaultMint: env.DEFAULT_TOKEN_MINT });
        if (!configuration) {
            return Response.json({ error: 'Invalid configuration' }, {
                status: 400,
                headers: corsHeaders(origin, allowedOrigins),
            });
        }
        const cacheKey = recentCacheKey(configuration);
        const cache = caches.default;
        const cached = await cache.match(cacheKey);
        let payload;
        if (cached) {
            payload = await cached.json();
        } else {
            payload = await fetchRecentTrades(env, configuration);
            const cachedResponse = Response.json(payload, {
                headers: { 'cache-control': 'public, max-age=45' },
            });
            await cache.put(cacheKey, cachedResponse);
        }
        return Response.json(payload, { headers: corsHeaders(origin, allowedOrigins) });
    } catch (error) {
        console.error('[recent-trades] request failed', error instanceof Error ? error.name : 'UnknownError');
        return Response.json({ error: 'Recent swaps unavailable' }, {
            status: 503,
            headers: corsHeaders(origin, allowedOrigins),
        });
    }
}

function recentCacheKey(configuration) {
    return new Request(recentCacheUrl(configuration));
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
    return payload.result;
}

export class StreamHub extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.ctx = ctx;
        this.env = env;
        this.upstream = null;
        this.requestToPool = new Map();
        this.subscriptionToPool = new Map();
        this.seenSignatures = new Set();
        this.market = { tokenPriceUsd: 0, solPriceUsd: 0, updatedAt: 0 };
        this.pools = [];
        this.activePoolKey = '';
        this.tokenMint = '';
    }

    async fetch(request) {
        if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
        const token = resolveRequestMint(new URL(request.url), this.env.DEFAULT_TOKEN_MINT);
        if (!token.ok) return invalidMintResponse(token, request.headers.get('Origin'), this.env.ALLOWED_ORIGINS || this.env.ALLOWED_ORIGIN);
        if (this.tokenMint && this.tokenMint !== token.mint) return new Response('Token runtime mismatch', { status: 409 });
        this.tokenMint = token.mint;
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.ctx.acceptWebSocket(server);
        server.send(JSON.stringify({ type: 'status', status: this.upstream?.readyState === WebSocket.OPEN ? 'live' : 'connecting' }));
        return new Response(null, { status: 101, webSocket: client });
    }

    async webSocketMessage(_socket, raw) {
        const configuration = parseClientConfiguration(
            typeof raw === 'string' ? raw : new TextDecoder().decode(raw),
            { expectedMint: this.tokenMint },
        );
        if (!configuration) {
            this.broadcast({ type: 'status', status: 'invalid-configuration' });
            return;
        }
        const nextPoolKey = `${this.tokenMint}:${configuration.pools.map((pool) => pool.address).sort().join(':')}`;
        if (this.activePoolKey && nextPoolKey !== this.activePoolKey) this.closeUpstream('Pool configuration changed');
        this.pools = configuration.pools;
        this.activePoolKey = nextPoolKey;
        this.market = configuration.market;
        await this.ensureUpstream().catch((error) => this.handleFailure(error));
    }

    async webSocketClose() {
        if (this.ctx.getWebSockets().length === 0) this.closeUpstream();
    }

    async webSocketError() {
        if (this.ctx.getWebSockets().length === 0) this.closeUpstream();
    }

    async alarm() {
        if (this.ctx.getWebSockets().length) await this.ensureUpstream().catch((error) => this.handleFailure(error));
    }

    async ensureUpstream() {
        if (this.upstream?.readyState === WebSocket.OPEN || this.upstream?.readyState === WebSocket.CONNECTING) return;
        if (!this.env.HELIUS_API_KEY) {
            this.broadcast({ type: 'status', status: 'missing-helius-key' });
            return;
        }
        if (!this.pools.length) throw new Error('No pools configured by client');
        await this.connectUpstream(this.pools);
    }

    async connectUpstream(pools) {
        const socket = new WebSocket(`wss://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(this.env.HELIUS_API_KEY)}`);
        this.upstream = socket;
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                socket.close(1013, 'Upstream handshake timeout');
                reject(new Error('Helius WebSocket handshake timed out'));
            }, 10_000);
            socket.addEventListener('open', () => {
                clearTimeout(timeout);
                this.broadcast({ type: 'status', status: 'live', pools: pools.length });
                pools.forEach((pool, index) => {
                    const id = index + 1;
                    this.requestToPool.set(id, pool);
                    socket.send(JSON.stringify({
                        jsonrpc: '2.0', id, method: 'logsSubscribe',
                        params: [{ mentions: [pool.address] }, { commitment: 'confirmed' }],
                    }));
                });
                resolve();
            }, { once: true });
            socket.addEventListener('error', () => {
                clearTimeout(timeout);
                reject(new Error('Helius WebSocket connection failed'));
            }, { once: true });
        });
        socket.addEventListener('message', (event) => this.handleUpstreamMessage(event.data));
        socket.addEventListener('close', () => {
            if (this.upstream === socket) this.scheduleReconnect();
        });
        socket.addEventListener('error', () => socket.close(1011, 'Upstream error'));
    }

    handleUpstreamMessage(raw) {
        let message;
        try { message = JSON.parse(raw); } catch { return; }
        if (message.id && message.result) {
            const pool = this.requestToPool.get(message.id);
            if (pool) this.subscriptionToPool.set(message.result, pool);
            return;
        }
        if (message.method !== 'logsNotification' || message.params?.result?.value?.err) return;
        const signature = message.params.result.value.signature;
        if (!signature || this.seenSignatures.has(signature)) return;
        this.seenSignatures.add(signature);
        if (this.seenSignatures.size > 5_000) this.seenSignatures.clear();
        const pool = this.subscriptionToPool.get(message.params.subscription);
        this.ctx.waitUntil(this.parseAndBroadcast(signature, pool).catch((error) => this.handleFailure(error, false)));
    }

    async parseAndBroadcast(signature, pool) {
        const transaction = await this.rpc('getTransaction', [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
        if (!transaction?.meta || transaction.meta.err) return;
        const trade = parseTransaction(transaction, signature, pool, this.tokenMint, this.market);
        if (trade) this.broadcast({ type: 'trade', data: trade });
    }

    async rpc(method, params) {
        const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(this.env.HELIUS_API_KEY)}`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
            signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) throw new Error(`Helius RPC ${response.status}`);
        return (await response.json()).result;
    }

    broadcast(message) {
        const payload = JSON.stringify(message);
        this.ctx.getWebSockets().forEach((socket) => {
            try { socket.send(payload); } catch { socket.close(1011, 'Send failed'); }
        });
    }

    closeUpstream(reason = 'No clients') {
        const socket = this.upstream;
        this.upstream = null;
        this.requestToPool.clear();
        this.subscriptionToPool.clear();
        socket?.close(1000, reason);
    }

    scheduleReconnect() {
        this.upstream = null;
        this.broadcast({ type: 'status', status: 'reconnecting' });
        this.ctx.storage.setAlarm(Date.now() + 2_000);
    }

    handleFailure(error, reconnect = true) {
        console.error('[stream-worker]', error);
        this.broadcast({ type: 'status', status: 'degraded' });
        if (reconnect && this.ctx.getWebSockets().length) this.ctx.storage.setAlarm(Date.now() + 5_000);
    }
}

function invalidMintResponse(result, origin, allowedOrigin) {
    return Response.json({ status: 'invalid-mint', error: result.error }, {
        status: result.status || 400,
        headers: corsHeaders(origin, allowedOrigin),
    });
}
