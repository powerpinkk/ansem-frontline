import { DurableObject } from 'cloudflare:workers';
import { parseTransaction } from './parser.js';
import { parseClientConfiguration } from './configuration.js';
import { normalizeHeliusMarket, SOL_MINT } from './market-fallback.js';

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const origin = request.headers.get('Origin');
        if (!isAllowedOrigin(origin, env.ALLOWED_ORIGIN)) return new Response('Origin not allowed', { status: 403 });
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin, env.ALLOWED_ORIGIN) });
        if (url.pathname === '/health') {
            return Response.json({ ok: true, service: 'ansem-frontline-stream' });
        }
        if (url.pathname === '/market') return fetchFallbackMarket(env, origin);
        if (url.pathname !== '/stream') return new Response('Not found', { status: 404 });
        const id = env.STREAM_HUB.idFromName('ansem-mainnet');
        return env.STREAM_HUB.get(id).fetch(request);
    },
};

function isAllowedOrigin(origin, allowedOrigin) {
    return !origin || !allowedOrigin || origin === allowedOrigin || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
}

function corsHeaders(origin, allowedOrigin) {
    return {
        'access-control-allow-origin': origin && isAllowedOrigin(origin, allowedOrigin) ? origin : allowedOrigin,
        'access-control-allow-methods': 'GET, OPTIONS',
        vary: 'Origin',
        'cache-control': 'public, max-age=15',
    };
}

async function fetchFallbackMarket(env, origin) {
    try {
        const [token, sol] = await Promise.all([
            fetchHeliusAsset(env, env.TOKEN_MINT),
            fetchHeliusAsset(env, SOL_MINT),
        ]);
        const market = normalizeHeliusMarket(token, sol);
        if (!market) throw new Error('Helius price data unavailable');
        return Response.json(market, { headers: corsHeaders(origin, env.ALLOWED_ORIGIN) });
    } catch (error) {
        console.error('[market-fallback] request failed', error instanceof Error ? error.name : 'UnknownError');
        return Response.json({ error: 'Market fallback unavailable' }, { status: 503, headers: corsHeaders(origin, env.ALLOWED_ORIGIN) });
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
    }

    async fetch(request) {
        if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.ctx.acceptWebSocket(server);
        server.send(JSON.stringify({ type: 'status', status: this.upstream?.readyState === WebSocket.OPEN ? 'live' : 'connecting' }));
        return new Response(null, { status: 101, webSocket: client });
    }

    async webSocketMessage(_socket, raw) {
        const configuration = parseClientConfiguration(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
        if (!configuration) {
            this.broadcast({ type: 'status', status: 'invalid-configuration' });
            return;
        }
        this.pools = configuration.pools;
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
        socket.addEventListener('close', () => this.scheduleReconnect());
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
        const trade = parseTransaction(transaction, signature, pool, this.env.TOKEN_MINT, this.market);
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

    closeUpstream() {
        this.upstream?.close(1000, 'No clients');
        this.upstream = null;
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
