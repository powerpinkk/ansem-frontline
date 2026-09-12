import { parseClientConfiguration } from './configuration.js';
import { resolveRequestMint } from './token-routing.js';
import { createEvidenceIngestion } from './evidence-ingestion.js';
import { createRpcTransport, resolveServerMarket } from './server-market.js';
import { fetchRecentCandidates } from './recent-trades.js';

export class StreamHub {
    constructor(ctx, env) {
        this.ctx = ctx;
        this.env = env;
        this.rpc = createRpcTransport(env);
        this.tokenMint = null;
        this.market = null;
        this.marketPromise = null;
        this.historyPromise = null;
        this.ingestion = null;
        this.upstream = null;
        this.requests = new Map();
        this.subscriptions = new Map();
        this.cursorByPool = new Map();
        this.lastHistoryAt = 0;
        this.lastClientAt = 0;
        this.nextConnectAt = 0;
        this.retryDelay = 1000;
        this.coverageIncomplete = false;
    }

    async fetch(request) {
        const url = new URL(request.url);
        const token = resolveRequestMint(url, this.env.DEFAULT_TOKEN_MINT);
        if (!token.ok || (this.tokenMint && this.tokenMint !== token.mint)) return new Response('Invalid mint', { status: 400 });
        this.tokenMint = token.mint;
        this.lastClientAt = Date.now();
        this.ensureIngestion();
        if (url.pathname === '/recent') {
            if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
            const config = parseClientConfiguration(await request.text(), { expectedMint: this.tokenMint });
            if (!config) return new Response('Invalid request', { status: 400 });
            try {
                await this.ensureMarket();
                await this.catchUp();
                await this.ingestion.tick();
            } catch { this.coverageIncomplete = true; }
            await this.schedule();
            return Response.json({ version: 3, source: 'verified-rpc-history', tokenMint: this.tokenMint,
                trades: this.ingestion.snapshot(), pools: this.market?.pools.length || 0,
                status: this.isDegraded() ? 'degraded' : 'observed', integrity: this.diagnostics() },
            { headers: { 'cache-control': 'no-store' } });
        }
        if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
        if (this.ctx.getWebSockets().length >= 64) return new Response('Client limit reached', { status: 429 });
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.ctx.acceptWebSocket(server);
        server.send(JSON.stringify({ type: 'status', status: 'connecting', version: 3 }));
        return new Response(null, { status: 101, webSocket: client });
    }

    ensureIngestion() {
        if (this.ingestion) return;
        this.ingestion = createEvidenceIngestion({ tokenMint: this.tokenMint, rpc: this.rpc,
            onChange: (event) => this.broadcast({ ...event, version: 3 }) });
    }

    async webSocketMessage(socket, raw) {
        const config = parseClientConfiguration(typeof raw === 'string' ? raw : new TextDecoder().decode(raw), { expectedMint: this.tokenMint });
        if (!config) { socket.send(JSON.stringify({ type: 'status', status: 'invalid-configuration' })); return; }
        this.lastClientAt = Date.now();
        try {
            await this.ensureMarket();
            await this.ensureUpstream();
            socket.send(JSON.stringify({ type: 'snapshot', version: 3, tokenMint: this.tokenMint, trades: this.ingestion.snapshot() }));
            await this.catchUp();
        } catch { this.broadcast({ type: 'status', status: 'degraded', version: 3 }); }
        await this.schedule();
    }

    async ensureMarket() {
        if (this.market && Date.now() - this.market.receivedAt < 60_000) return this.market;
        if (this.marketPromise) return this.marketPromise;
        this.marketPromise = resolveServerMarket(this.tokenMint, this.rpc, this.market?.selection)
            .then((next) => {
                const key = (m) => m?.pools.map((p) => p.address).sort().join(':');
                if (key(this.market) !== key(next)) this.closeUpstream();
                this.market = next;
                const addresses = new Set(next.pools.map((p) => p.address));
                for (const key of this.cursorByPool.keys()) if (!addresses.has(key)) this.cursorByPool.delete(key);
                return next;
            }).finally(() => { this.marketPromise = null; });
        return this.marketPromise;
    }

    async catchUp() {
        if (this.historyPromise) return this.historyPromise;
        if (Date.now() - this.lastHistoryAt < 15_000) return;
        this.lastHistoryAt = Date.now();
        this.historyPromise = (async () => {
            // At most five signature reads per sweep, in parallel; 12 per pool.
            // A full page means an unproven gap, not a complete replay guarantee.
            const result = await fetchRecentCandidates(this.rpc, this.market?.pools || [], this.cursorByPool);
            if (result.coverageIncomplete) this.coverageIncomplete = true;
            for (const s of result.candidates) this.ingestion.observeSignature(s.signature, s.slot);
        })().finally(() => { this.historyPromise = null; });
        return this.historyPromise;
    }

    async ensureUpstream() {
        if (!this.ctx.getWebSockets().length || !this.market?.pools.length || Date.now() < this.nextConnectAt) return;
        if (this.upstream?.readyState === WebSocket.OPEN || this.upstream?.readyState === WebSocket.CONNECTING) return;
        const socket = new WebSocket(`wss://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(this.env.HELIUS_API_KEY)}`);
        this.upstream = socket;
        this.openedAt = Date.now();
        socket.addEventListener('open', () => {
            if (this.upstream !== socket) return;
            this.market.pools.forEach((pool, i) => {
                this.requests.set(i + 1, pool.address);
                socket.send(JSON.stringify({ jsonrpc: '2.0', id: i + 1, method: 'logsSubscribe',
                    params: [{ mentions: [pool.address] }, { commitment: 'confirmed' }] }));
            });
        });
        socket.addEventListener('message', (event) => { if (this.upstream === socket) this.handleUpstreamMessage(event.data); });
        socket.addEventListener('error', () => socket.close(1011, 'Upstream error'));
        socket.addEventListener('close', () => {
            if (this.upstream !== socket) return;
            this.closeUpstream();
            this.nextConnectAt = Date.now() + this.retryDelay;
            this.retryDelay = Math.min(30_000, this.retryDelay * 2);
            this.lastHistoryAt = 0;
            this.broadcast({ type: 'status', status: 'reconnecting', version: 3 });
            void this.schedule();
        });
    }

    handleUpstreamMessage(raw) {
        let message;
        try { message = JSON.parse(raw); } catch { return; }
        if (message.error) { this.coverageIncomplete = true; this.closeUpstream(); return; }
        if (this.requests.has(message.id) && Number.isInteger(message.result)) {
            this.subscriptions.set(message.result, this.requests.get(message.id));
            this.requests.delete(message.id);
            if (!this.requests.size) {
                this.retryDelay = 1000;
                this.broadcast({ type: 'status', status: 'live', version: 3 });
            }
            return;
        }
        const result = message.params?.result;
        if (message.method !== 'logsNotification' || result?.value?.err || !this.subscriptions.has(message.params.subscription)) return;
        this.ingestion.observeSignature(result.value.signature, result.context?.slot);
    }

    async alarm() {
        if (!this.ctx.getWebSockets().length && Date.now() - this.lastClientAt > 120_000) {
            this.closeUpstream(); this.ingestion?.destroy(); this.ingestion = null; return;
        }
        try {
            await this.ensureMarket();
            if (this.upstream && this.upstream.readyState === WebSocket.CONNECTING && Date.now() - this.openedAt > 10_000) this.closeUpstream();
            await this.ensureUpstream();
            await this.catchUp();
            await this.ingestion?.tick();
        } catch { this.coverageIncomplete = true; }
        this.broadcast({ type: 'integrity', version: 3, data: this.diagnostics() });
        await this.schedule();
    }
    isDegraded() {
        const d = this.ingestion?.diagnostics();
        return !this.market?.pools.length || this.coverageIncomplete || this.market?.unsupportedPools > 0
            || d?.overflow > 0 || d?.unverified > 0 || d?.rpcFailures > 0;
    }
    diagnostics() {
        return { tokenMint: this.tokenMint, primaryMarket: this.market?.selection || null,
            ...this.ingestion?.diagnostics(), coverageIncomplete: this.coverageIncomplete,
            unsupportedPools: this.market?.unsupportedPools || 0, degraded: this.isDegraded() };
    }
    async schedule() { await this.ctx.storage.setAlarm(Date.now() + 3000); }
    webSocketClose() { if (!this.ctx.getWebSockets().length) this.closeUpstream(); }
    webSocketError() { this.webSocketClose(); }
    closeUpstream() {
        const socket = this.upstream; this.upstream = null;
        this.requests.clear(); this.subscriptions.clear();
        try { socket?.close(1000, 'Subscription reset'); } catch { /* already closed */ }
    }
    broadcast(message) {
        const payload = JSON.stringify(message);
        for (const socket of this.ctx.getWebSockets()) {
            try { socket.send(payload); } catch { socket.close(1011, 'Send failed'); }
        }
    }
}
