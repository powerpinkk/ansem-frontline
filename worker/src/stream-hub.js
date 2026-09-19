import { parseClientConfiguration } from './configuration.js';
import { resolveRequestMint } from './token-routing.js';
import { createEvidenceIngestion } from './evidence-ingestion.js';
import { createRpcTransport, resolveServerMarket } from './server-market.js';
import { fetchRecentCandidates } from './recent-trades.js';
import { canonicalValuation, createCanonicalValuationBoundary } from '../../js/canonical-valuation.js';

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
        this.sourceEpoch = 0;
        this.valuationBoundary = null;
    }

    async fetch(request) {
        const url = new URL(request.url);
        const token = resolveRequestMint(url, this.env.DEFAULT_TOKEN_MINT);
        if (!token.ok || (this.tokenMint && this.tokenMint !== token.mint)) return new Response('Invalid mint', { status: 400 });
        this.tokenMint = token.mint;
        this.lastClientAt = Date.now();
        if (url.pathname === '/recent') {
            if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
            const config = parseClientConfiguration(await request.text(), { expectedMint: this.tokenMint });
            if (!config) return new Response('Invalid request', { status: 400 });
            try {
                await this.ensureMarket();
                await this.catchUp();
                await this.ingestion?.tick();
            } catch { this.coverageIncomplete = true; }
            await this.schedule();
            return Response.json({ version: 4, source: 'verified-pool-executions', tokenMint: this.tokenMint,
                canonicalMarket: this.market?.canonicalMarket || null, sourceEpoch: this.sourceEpoch,
                canonicalValuation:this.valuationBoundary?.snapshot() || null,
                trades: this.ingestion?.snapshot() || [], pools: this.market?.pools.length || 0,
                status: this.isDegraded() ? 'degraded' : 'observed', integrity: this.diagnostics() },
            { headers: { 'cache-control': 'no-store' } });
        }
        if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
        if (this.ctx.getWebSockets().length >= 64) return new Response('Client limit reached', { status: 429 });
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.ctx.acceptWebSocket(server);
        server.send(JSON.stringify({ type: 'status', status: 'connecting', version: 4 }));
        return new Response(null, { status: 101, webSocket: client });
    }

    ensureIngestion() {
        if (this.ingestion || this.market?.canonicalMarket?.compatibility !== 'POOL_STATE_AND_VAULTS_VERIFIED') return;
        this.ingestion = createEvidenceIngestion({ tokenMint: this.tokenMint, canonicalMarket: this.market.canonicalMarket, rpc: this.rpc,
            onChange: (event) => this.broadcast({ ...event, version: 4 }) });
    }

    async webSocketMessage(socket, raw) {
        const config = parseClientConfiguration(typeof raw === 'string' ? raw : new TextDecoder().decode(raw), { expectedMint: this.tokenMint });
        if (!config) { socket.send(JSON.stringify({ type: 'status', status: 'invalid-configuration' })); return; }
        this.lastClientAt = Date.now();
        try {
            await this.ensureMarket();
            await this.ensureUpstream();
            socket.send(JSON.stringify({ type: 'snapshot', version: 4, tokenMint: this.tokenMint,
                canonicalMarket: this.market?.canonicalMarket || null, sourceEpoch: this.sourceEpoch,
                canonicalValuation:this.valuationBoundary?.snapshot() || null,trades: this.ingestion?.snapshot() || [] }));
            await this.catchUp();
        } catch { this.broadcast({ type: 'status', status: 'degraded', version: 4 }); }
        await this.schedule();
    }

    async ensureMarket() {
        if (this.market && Date.now() - this.market.receivedAt < (this.market.refreshIntervalMs || 60_000)) { this.ensureIngestion(); return this.market; }
        if (this.marketPromise) return this.marketPromise;
        this.marketPromise = resolveServerMarket(this.tokenMint, this.rpc, this.market?.selection)
            .then(async (next) => {
                const key = (m) => JSON.stringify(m?.canonicalMarket && [m.canonicalMarket.address, m.canonicalMarket.programId,
                    m.canonicalMarket.mints, m.canonicalMarket.vaults, m.canonicalMarket.tokenPrograms,
                    m.canonicalMarket.compatibility,m.canonicalMarket.mayhem===true]);
                const changed = key(this.market) !== key(next);
                if (changed) {
                    this.closeUpstream(); this.ingestion?.destroy(); this.ingestion = null;
                    this.cursorByPool.clear(); this.lastHistoryAt = 0; this.coverageIncomplete = false;
                    // Persist an increasing epoch so late HTTP/WS responses from
                    // an earlier incarnation cannot revive an obsolete market.
                    const epoch = (await this.ctx.storage.get('marketEpoch') || 0) + 1;
                    await this.ctx.storage.put('marketEpoch', epoch);
                    this.sourceEpoch = epoch;
                    if (next.canonicalMarket) next.canonicalMarket.sourceEpoch = epoch;
                } else if (next.canonicalMarket) next.canonicalMarket.sourceEpoch = this.market.canonicalMarket.sourceEpoch;
                if (!this.valuationBoundary) this.valuationBoundary = createCanonicalValuationBoundary(this.tokenMint);
                if (changed) this.valuationBoundary.clear();
                if (next.nativeValuation && next.canonicalMarket) {
                    next.nativeValuation.sourceEpoch = next.canonicalMarket.sourceEpoch;
                    const value = canonicalValuation(next.nativeValuation,next.quoteUsd,next.canonicalMarket,this.valuationBoundary.snapshot());
                    this.valuationBoundary.accept(value,next.canonicalMarket);
                } else if (next.valuationFailure) this.valuationBoundary.clear();
                this.market = next;
                this.ensureIngestion();
                if (changed) this.broadcast({ type: 'snapshot', version: 4, tokenMint: this.tokenMint,
                    canonicalMarket: next.canonicalMarket, sourceEpoch: this.sourceEpoch,
                    canonicalValuation:this.valuationBoundary?.snapshot() || null,trades: [] });
                const addresses = new Set(next.pools.map((p) => p.address));
                for (const key of this.cursorByPool.keys()) if (!addresses.has(key)) this.cursorByPool.delete(key);
                return next;
            }).finally(() => { this.marketPromise = null; });
        return this.marketPromise;
    }

    async catchUp() {
        if (this.historyPromise) return this.historyPromise;
        if (!this.ingestion) return;
        if (Date.now() - this.lastHistoryAt < 15_000) return;
        this.lastHistoryAt = Date.now();
        this.historyPromise = (async () => {
            const ingestion = this.ingestion, market = this.market;
            // One canonical address, 12 mentions per bounded sweep.
            // A full page means an unproven gap, not a complete replay guarantee.
            const result = await fetchRecentCandidates(this.rpc, market?.pools || [], new Map(this.cursorByPool));
            if (this.ingestion !== ingestion) return;
            for (const [pool, cursor] of result.cursors) this.cursorByPool.set(pool, cursor);
            if (result.coverageIncomplete) this.coverageIncomplete = true;
            for (const s of result.candidates) ingestion.observeSignature(s.signature, s.slot);
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
            this.broadcast({ type: 'status', status: 'reconnecting', version: 4 });
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
                this.broadcast({ type: 'status', status: 'live', version: 4 });
            }
            return;
        }
        const result = message.params?.result;
        if (message.method !== 'logsNotification' || !result?.value || !this.subscriptions.has(message.params.subscription)) return;
        this.ingestion?.observeSignature(result.value.signature, result.context?.slot);
    }

    async alarm() {
        if (!this.ctx.getWebSockets().length && Date.now() - this.lastClientAt > 120_000) {
            this.closeUpstream(); this.ingestion?.destroy(); this.ingestion = null;
            this.market=null;this.valuationBoundary?.clear();this.cursorByPool.clear();return;
        }
        try {
            await this.ensureMarket();
            if (this.upstream && this.upstream.readyState === WebSocket.CONNECTING && Date.now() - this.openedAt > 10_000) this.closeUpstream();
            await this.ensureUpstream();
            await this.catchUp();
            await this.ingestion?.tick();
        } catch { this.coverageIncomplete = true; }
        this.broadcast({ type: 'integrity', version: 4, data: this.diagnostics() });
        await this.schedule();
    }
    isDegraded() {
        const d = this.ingestion?.diagnostics();
        return !this.market?.pools.length || this.coverageIncomplete || this.market?.unsupportedPools > 0
            || d?.overflow > 0 || d?.journal?.overflow > 0 || d?.journal?.rejected > 0 || d?.unverified > 0 || d?.rpcFailures > 0 || d?.coverage?.confidence === 'DEGRADED';
    }
    diagnostics() {
        return { tokenMint: this.tokenMint, primaryMarket: this.market?.selection || null,
            canonicalMarket: this.market?.canonicalMarket || null, sourceEpoch: this.sourceEpoch, identityFailure: this.market?.identityFailure || null,
            canonicalValuation:this.valuationBoundary?.snapshot() || null,valuationFailure:this.market?.valuationFailure || null,
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
