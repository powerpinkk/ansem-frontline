import { parseClientConfiguration } from './configuration.js';
import { resolveRequestMint } from './token-routing.js';
import { createEvidenceIngestion } from './evidence-ingestion.js';
import { createRpcTransport, isTransientAcquisitionFailure, refreshServerMarket, resolveServerMarket } from './server-market.js';
import { fetchRecentCandidates } from './recent-trades.js';
import { canonicalValuation, createCanonicalValuationBoundary } from '../../js/canonical-valuation.js';
import { acquisitionFailure, AcquisitionError, createAcquisitionPolicy } from './acquisition-policy.js';
import { fetchHeliusAsset, normalizeHeliusMarket, SOL_MINT } from './market-fallback.js';

const HEALTH_SCHEMA_VERSION = 1;
const HTTP_LEASE_MS = 30_000;
const HISTORY_INTERVAL_MS = 15_000;
const NATIVE_INTERVAL_MS = 10_000;
const DISCOVERY_INTERVAL_MS = 60_000;
const MAX_GAPS = 32;

const capability = () => ({ status: 'UNKNOWN', reason: null, lastAttemptAt: null, lastSuccessAt: null,
    lastFailureAt: null, nextRetryAt: null, generation: 0 });

export class StreamHub {
    constructor(ctx, env) {
        this.ctx = ctx;
        this.env = env;
        this.random = typeof env.__testRandom === 'function' ? env.__testRandom : Math.random;
        this.rawRpc = createRpcTransport(env);
        this.policy = createAcquisitionPolicy({ storage: ctx.storage });
        this.rpc = (method, params, signal, meta = {}) => this.policy.run('standard', meta.capability || method,
            () => this.rawRpc(method, params, signal));
        this.dasRpc = (method, params, signal, meta = {}) => this.policy.run('das', meta.capability || method,
            () => this.rawRpc(method, params, signal));
        this.tokenMint = null;
        this.market = null;
        this.marketPromise = null;
        this.historyPromise = null;
        this.indicativePromise = null;
        this.indicativeCache = null;
        this.ingestion = null;
        this.upstream = null;
        this.requests = new Map();
        this.subscriptions = new Map();
        this.cursorByPool = new Map();
        this.lastHistoryAt = 0;
        this.lastDiscoveryAt = 0;
        this.lastNativeAt = 0;
        this.lastClientAt = 0;
        this.nextConnectAt = 0;
        this.retryDelay = 1000;
        this.coverageIncomplete = false;
        this.coverageHealthySince = null;
        this.pendingCoverageFailure = null;
        this.coverageGaps = [];
        this.sourceEpoch = 0;
        this.valuationBoundary = null;
        this.streamStatus = 'disconnected';
        this.capabilities = {
            discovery: capability(), marketState: capability(), quoteUsd: capability(),
            valuation: capability(), execution: capability(),
        };
        this.restorePromise = this.restoreRecoveryMetadata();
    }

    async restoreRecoveryMetadata() {
        const saved = await this.ctx.storage.get('recoveryMetadata:v1');
        if (saved?.schemaVersion === 1 && Array.isArray(saved.coverageGaps)) {
            this.coverageGaps = saved.coverageGaps.slice(-MAX_GAPS);
            this.coverageIncomplete = this.coverageGaps.length > 0;
        }
        const epoch = await this.ctx.storage.get('marketEpoch');
        if (Number.isSafeInteger(epoch) && epoch > this.sourceEpoch) this.sourceEpoch = epoch;
    }

    markCapability(name, ok, reason = null, retryAt = null, attemptedAt = Date.now()) {
        const current = this.capabilities[name];
        if (!current || attemptedAt < (current.lastAttemptAt || 0)) return;
        current.generation += 1;
        current.lastAttemptAt = attemptedAt;
        if (ok) {
            current.status = 'HEALTHY'; current.reason = null; current.nextRetryAt = null;
            current.lastSuccessAt = attemptedAt;
        } else {
            current.status = 'RETRY_WAIT'; current.reason = reason || 'ACQUISITION_FAILED';
            current.nextRetryAt = retryAt || null; current.lastFailureAt = attemptedAt;
        }
    }

    recordGap(reason, details = {}) {
        const at = Date.now();
        this.coverageIncomplete = true;
        this.coverageHealthySince = null;
        this.coverageGaps.push({ reason, at, sourceEpoch: this.sourceEpoch, ...details });
        this.coverageGaps = this.coverageGaps.slice(-MAX_GAPS);
        void this.ctx.storage.put('recoveryMetadata:v1', { schemaVersion: 1, coverageGaps: this.coverageGaps });
    }

    markCoveragePending(reason, retryAt = null) {
        this.coverageHealthySince = null;
        this.pendingCoverageFailure = { reason, at: Date.now(), retryAt };
    }

    async fetch(request) {
        await this.restorePromise;
        const url = new URL(request.url);
        const token = resolveRequestMint(url, this.env.DEFAULT_TOKEN_MINT);
        if (!token.ok || (this.tokenMint && this.tokenMint !== token.mint)) return new Response('Invalid mint', { status: 400 });
        this.tokenMint = token.mint;
        this.lastClientAt = Date.now();
        if (url.pathname === '/market') return this.fetchIndicativeMarket();
        if (url.pathname === '/recent') {
            if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
            const config = parseClientConfiguration(await request.text(), { expectedMint: this.tokenMint });
            if (!config) return new Response('Invalid request', { status: 400 });
            try {
                await this.ensureMarket();
                await this.catchUp();
                await this.ingestion?.tick();
            } catch (error) {
                if (!(error instanceof AcquisitionError && error.deferred)) this.recordGap(acquisitionFailure(error).reason);
            }
            await this.schedule();
            return Response.json(this.snapshotEnvelope(), { headers: { 'cache-control': 'no-store' } });
        }
        if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
        if (this.ctx.getWebSockets().length >= 64) return new Response('Client limit reached', { status: 429 });
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.ctx.acceptWebSocket(server);
        server.send(JSON.stringify({ type: 'status', status: this.streamStatus === 'live' ? 'live' : 'connecting', version: 4,
            healthSchemaVersion: HEALTH_SCHEMA_VERSION }));
        return new Response(null, { status: 101, webSocket: client });
    }

    snapshotEnvelope() {
        return { version: 4, healthSchemaVersion: HEALTH_SCHEMA_VERSION,
            buildId: this.env.WORKER_BUILD_ID || 'ansem-frontline-worker-recovery-v1',
            source: 'verified-pool-executions', tokenMint: this.tokenMint,
            canonicalMarket: this.market?.canonicalMarket || null, sourceEpoch: this.sourceEpoch,
            canonicalValuation: this.valuationBoundary?.snapshot() || null,
            trades: this.ingestion?.snapshot() || [], pools: this.market?.pools.length || 0,
            status: this.isDegraded() ? 'degraded' : 'observed', integrity: this.diagnostics() };
    }

    async fetchIndicativeMarket() {
        const now = Date.now();
        if (this.indicativeCache && now - this.indicativeCache.cachedAt < 30_000) {
            return Response.json(this.indicativeCache.value, { headers: { 'cache-control': 'public, max-age=15' } });
        }
        if (this.indicativePromise) return this.indicativePromise;
        this.indicativePromise = (async () => {
            try {
                const token = await fetchHeliusAsset(this.dasRpc, this.tokenMint);
                const sol = await fetchHeliusAsset(this.dasRpc, SOL_MINT);
                const market = normalizeHeliusMarket(token, sol, { mint: this.tokenMint });
                if (!market) throw new Error('DAS_PRICE_DATA_UNAVAILABLE');
                if (!market.pools.length) return Response.json({ status: market.status,
                    error: { code: 'NO_SAFE_FALLBACK_POOLS', message: 'No verified fallback pools are configured for this mint' },
                    token: market.token }, { status: 422, headers: { 'cache-control': 'no-store' } });
                this.indicativeCache = { cachedAt: now, value: market };
                return Response.json(market, { headers: { 'cache-control': 'public, max-age=15' } });
            } catch (error) {
                const failure = acquisitionFailure(error);
                const code = failure.kind === 'RATE_LIMIT' ? 'PROVIDER_RATE_LIMITED'
                    : failure.kind === 'UPSTREAM_5XX' ? 'PROVIDER_UPSTREAM_5XX'
                        : failure.kind === 'RPC_ERROR' ? 'PROVIDER_RPC_FAILURE'
                            : failure.kind === 'MALFORMED' ? 'PROVIDER_MALFORMED_RESPONSE'
                                : 'MARKET_FALLBACK_UNAVAILABLE';
                const headers = { 'cache-control': 'no-store' };
                if (failure.retryAt) headers['retry-after'] = String(Math.max(1, Math.ceil((failure.retryAt - Date.now()) / 1000)));
                return Response.json({ status: 'degraded', error: { code, retryable: failure.retryable,
                    retryAt: failure.retryAt || null } }, { status: 503, headers });
            } finally { this.indicativePromise = null; }
        })();
        return this.indicativePromise;
    }

    ensureIngestion() {
        if (this.ingestion || this.market?.canonicalMarket?.compatibility !== 'POOL_STATE_AND_VAULTS_VERIFIED') return;
        this.ingestion = createEvidenceIngestion({ tokenMint: this.tokenMint, canonicalMarket: this.market.canonicalMarket, rpc: this.rpc,
            onChange: (event) => this.broadcast({ ...event, version: 4 }),
            onGap: (gap) => this.recordGap(gap.reason, { signature: gap.signature }) });
    }

    async webSocketMessage(socket, raw) {
        const config = parseClientConfiguration(typeof raw === 'string' ? raw : new TextDecoder().decode(raw), { expectedMint: this.tokenMint });
        if (!config) { socket.send(JSON.stringify({ type: 'status', status: 'invalid-configuration' })); return; }
        this.lastClientAt = Date.now();
        try {
            await this.ensureMarket();
            await this.ensureUpstream();
            socket.send(JSON.stringify({ type: 'snapshot', ...this.snapshotEnvelope() }));
            await this.catchUp();
            if (this.streamStatus === 'live') socket.send(JSON.stringify({ type: 'status', status: 'live', version: 4,
                healthSchemaVersion: HEALTH_SCHEMA_VERSION }));
        } catch { socket.send(JSON.stringify({ type: 'status', status: 'degraded', version: 4 })); }
        await this.schedule();
    }

    async ensureMarket() {
        const now = Date.now();
        const stablePump = this.market?.canonicalMarket?.protocol === 'pumpswap'
            && this.market.canonicalMarket.compatibility === 'POOL_STATE_AND_VAULTS_VERIFIED';
        if (stablePump && this.market.receivedAt > 0 && now - this.market.receivedAt < DISCOVERY_INTERVAL_MS) {
            if (!this.lastNativeAt || now - this.lastNativeAt < NATIVE_INTERVAL_MS) { this.ensureIngestion(); return this.market; }
            return this.refreshNative();
        }
        const interval = this.market?.refreshIntervalMs || (stablePump ? DISCOVERY_INTERVAL_MS : 10_000);
        if (this.market && this.market.receivedAt > 0 && now - this.market.receivedAt < interval) {
            this.ensureIngestion(); return this.market;
        }
        if (this.marketPromise) return this.marketPromise;
        const attemptedAt = now;
        this.marketPromise = resolveServerMarket(this.tokenMint, this.rpc, this.market?.selection)
            .then((next) => {
                if (next.acquisitionFailure) {
                    this.markCapability('discovery', false, next.identityFailure, next.retryAt, attemptedAt);
                    if (this.market?.canonicalMarket) return this.market;
                } else this.markCapability('discovery', Boolean(next.canonicalMarket), next.identityFailure, next.retryAt, attemptedAt);
                if (next.valuationAcquisitionFailure && this.market?.canonicalMarket?.address === next.canonicalMarket?.address) {
                    next = { ...next, nativeValuation: this.market.nativeValuation, quoteUsd: this.market.quoteUsd };
                }
                return this.applyMarket(next, attemptedAt);
            }).catch((error) => {
                const failure = acquisitionFailure(error);
                this.markCapability('discovery', false, failure.reason, failure.retryAt, attemptedAt);
                if (this.market?.canonicalMarket && isTransientAcquisitionFailure(error)) return this.market;
                if (!this.market) this.market = { pools: [], canonicalMarket: null, selection: null,
                    identityFailure: failure.reason, retryAt: failure.retryAt, receivedAt: attemptedAt, refreshIntervalMs: 30_000 };
                return this.market;
            }).finally(() => { this.marketPromise = null; });
        return this.marketPromise;
    }

    async refreshNative() {
        if (this.marketPromise) return this.marketPromise;
        const attemptedAt = Date.now(), market = this.market;
        this.marketPromise = refreshServerMarket(market, this.rpc).then((next) => {
            if (this.market !== market) return this.market;
            this.market = next; this.lastNativeAt = attemptedAt;
            this.acceptValuation(next, false);
            return this.market;
        }).catch((error) => {
            const failure = acquisitionFailure(error);
            this.markCapability('marketState', false, failure.reason, failure.retryAt, attemptedAt);
            if (!isTransientAcquisitionFailure(error)) {
                this.markCapability('valuation', false, error.message, null, attemptedAt);
                this.valuationBoundary?.clear(); this.lastDiscoveryAt = 0;
            }
            return this.market;
        }).finally(() => { this.marketPromise = null; });
        return this.marketPromise;
    }

    async applyMarket(next, attemptedAt) {
        const key = (m) => JSON.stringify(m?.canonicalMarket && [m.canonicalMarket.address, m.canonicalMarket.programId,
            m.canonicalMarket.mints, m.canonicalMarket.vaults, m.canonicalMarket.tokenPrograms,
            m.canonicalMarket.compatibility, m.canonicalMarket.mayhem === true]);
        const changed = key(this.market) !== key(next);
        if (changed) {
            this.closeUpstream(); this.ingestion?.destroy(); this.ingestion = null;
            this.cursorByPool.clear(); this.lastHistoryAt = 0; this.coverageHealthySince = null;
            const epoch = (await this.ctx.storage.get('marketEpoch') || 0) + 1;
            await this.ctx.storage.put('marketEpoch', epoch);
            this.sourceEpoch = epoch;
            if (next.canonicalMarket) next.canonicalMarket.sourceEpoch = epoch;
        } else if (next.canonicalMarket) next.canonicalMarket.sourceEpoch = this.market.canonicalMarket.sourceEpoch;
        if (!this.valuationBoundary) this.valuationBoundary = createCanonicalValuationBoundary(this.tokenMint);
        if (changed) this.valuationBoundary.clear();
        this.market = next;
        this.lastDiscoveryAt = attemptedAt;
        this.lastNativeAt = next.valuationAcquisitionFailure ? this.lastNativeAt : next.nativeValuation ? attemptedAt : 0;
        this.acceptValuation(next, changed);
        this.ensureIngestion();
        if (changed) this.broadcast({ type: 'snapshot', version: 4, tokenMint: this.tokenMint,
            canonicalMarket: next.canonicalMarket, sourceEpoch: this.sourceEpoch,
            canonicalValuation: this.valuationBoundary?.snapshot() || null, trades: [] });
        const addresses = new Set(next.pools.map((p) => p.address));
        for (const cursor of this.cursorByPool.keys()) if (!addresses.has(cursor)) this.cursorByPool.delete(cursor);
        return next;
    }

    acceptValuation(next, changed) {
        const attemptedAt = Date.now();
        if (next.valuationAcquisitionFailure) {
            this.markCapability('marketState', false, next.valuationFailure, next.retryAt, attemptedAt);
            this.markCapability('valuation', false, next.valuationFailure, next.retryAt, attemptedAt);
            return;
        }
        if (next.nativeValuation && next.canonicalMarket) {
            next.nativeValuation.sourceEpoch = next.canonicalMarket.sourceEpoch;
            const value = canonicalValuation(next.nativeValuation, next.quoteUsd, next.canonicalMarket,
                changed ? null : this.valuationBoundary?.snapshot(), attemptedAt);
            const accepted = this.valuationBoundary.accept(value, next.canonicalMarket, attemptedAt);
            this.markCapability('marketState', Boolean(value.gates.identity && value.gates.formula && value.gates.supply
                && value.gates.nativeFresh && value.gates.slot && value.gates.lifecycle && value.gates.supportedVariant),
            next.valuationFailure, null, attemptedAt);
            this.markCapability('quoteUsd', Boolean(value.gates.quoteIdentity && value.gates.quoteFresh),
                value.gates.quoteIdentity ? 'QUOTE_STALE' : next.valuationFailure || 'QUOTE_UNAVAILABLE', null, attemptedAt);
            this.markCapability('valuation', Boolean(accepted?.authorityEligible), next.valuationFailure || 'VALUATION_GATES_FAILED', null, attemptedAt);
        } else if (next.valuationFailure) {
            this.markCapability('valuation', false, next.valuationFailure, next.retryAt, attemptedAt);
            if (!next.acquisitionFailure) this.valuationBoundary.clear();
        }
    }

    async catchUp() {
        if (this.historyPromise) return this.historyPromise;
        if (!this.ingestion || Date.now() - this.lastHistoryAt < HISTORY_INTERVAL_MS) return;
        const attemptedAt = Date.now();
        this.lastHistoryAt = attemptedAt;
        this.historyPromise = (async () => {
            const ingestion = this.ingestion, market = this.market;
            const result = await fetchRecentCandidates(this.rpc, market?.pools || [], new Map(this.cursorByPool));
            if (this.ingestion !== ingestion) return;
            for (const [pool, cursor] of result.cursors) this.cursorByPool.set(pool, cursor);
            if (result.failures?.length) {
                const failure = result.failures[0];
                this.markCapability('execution', false, failure.reason, failure.retryAt, attemptedAt);
                this.markCoveragePending(failure.reason, failure.retryAt);
            } else {
                this.markCapability('execution', true, null, null, attemptedAt);
                if (result.coverageIncomplete) this.recordGap('HISTORY_PAGE_SATURATED');
                else {
                    this.pendingCoverageFailure = null;
                    this.coverageIncomplete = this.coverageGaps.length > 0;
                    this.coverageHealthySince ??= attemptedAt;
                }
            }
            for (const s of result.candidates) ingestion.observeSignature(s.signature, s.slot);
        })().finally(() => { this.historyPromise = null; });
        return this.historyPromise;
    }

    async ensureUpstream() {
        if (!this.ctx.getWebSockets().length || !this.market?.pools.length || Date.now() < this.nextConnectAt) return;
        if (this.upstream?.readyState === WebSocket.OPEN || this.upstream?.readyState === WebSocket.CONNECTING) return;
        if (!this.env.HELIUS_API_KEY) { this.streamStatus = 'disconnected'; return; }
        const socket = new WebSocket(`wss://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(this.env.HELIUS_API_KEY)}`);
        this.upstream = socket; this.openedAt = Date.now(); this.streamStatus = 'connecting';
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
            this.closeUpstream(); this.streamStatus = 'reconnecting';
            const jitter = Math.max(1, Math.floor(this.retryDelay * Math.max(0, Math.min(1, this.random())) * 0.2));
            this.nextConnectAt = Date.now() + this.retryDelay + jitter;
            this.retryDelay = Math.min(30_000, this.retryDelay * 2);
            this.lastHistoryAt = 0;
            this.broadcast({ type: 'status', status: 'reconnecting', version: 4 });
            void this.schedule();
        });
    }

    handleUpstreamMessage(raw) {
        let message;
        try { message = JSON.parse(raw); } catch { return; }
        if (message.error) { this.recordGap('WS_SUBSCRIPTION_ERROR'); this.closeUpstream(); return; }
        if (this.requests.has(message.id) && Number.isInteger(message.result)) {
            this.subscriptions.set(message.result, this.requests.get(message.id));
            this.requests.delete(message.id);
            if (!this.requests.size) {
                this.retryDelay = 1000; this.streamStatus = 'live'; this.lastHistoryAt = 0;
                void this.catchUp().then(() => {
                    if (this.streamStatus === 'live' && this.capabilities.execution.status === 'HEALTHY') {
                        this.broadcast({ type: 'status', status: 'live', version: 4, healthSchemaVersion: HEALTH_SCHEMA_VERSION });
                    }
                });
            }
            return;
        }
        const result = message.params?.result;
        if (message.method !== 'logsNotification' || !result?.value || !this.subscriptions.has(message.params.subscription)) return;
        this.ingestion?.observeSignature(result.value.signature, result.context?.slot);
    }

    async alarm() {
        if (!this.ctx.getWebSockets().length && Date.now() - this.lastClientAt >= HTTP_LEASE_MS) {
            this.closeUpstream(); this.ingestion?.destroy(); this.ingestion = null;
            this.market = null; this.valuationBoundary?.clear(); this.cursorByPool.clear(); return;
        }
        try {
            await this.ensureMarket();
            if (this.upstream && this.upstream.readyState === WebSocket.CONNECTING && Date.now() - this.openedAt > 10_000) {
                this.recordGap('WS_HANDSHAKE_TIMEOUT'); this.closeUpstream();
            }
            await this.ensureUpstream(); await this.catchUp(); await this.ingestion?.tick();
        } catch (error) {
            if (!(error instanceof AcquisitionError && error.deferred)) this.recordGap(acquisitionFailure(error).reason);
        }
        if (this.pendingCoverageFailure && Date.now() - this.pendingCoverageFailure.at >= 90_000) {
            this.recordGap(this.pendingCoverageFailure.reason, { unresolved: true });
            this.pendingCoverageFailure = null;
        }
        this.broadcast({ type: 'integrity', version: 4, data: this.diagnostics() });
        await this.schedule();
    }

    health() {
        const now = Date.now(), valuation = this.valuationBoundary?.snapshot(now);
        const ingestion = this.ingestion?.diagnostics();
        const evidenceOperational = ingestion?.acquisition?.transaction?.status !== 'RETRY_WAIT'
            && ingestion?.acquisition?.status?.status !== 'RETRY_WAIT';
        const currentCoverage = this.coverageHealthySince !== null && now - this.coverageHealthySince >= 60_000
            && now - (this.capabilities.execution.lastSuccessAt || 0) <= 30_000;
        const available = {
            discovery: this.capabilities.discovery.status === 'HEALTHY' && Boolean(this.market?.canonicalMarket),
            marketState: valuation?.gates?.identity === true && valuation?.gates?.formula === true
                && valuation?.gates?.supply === true && valuation?.gates?.nativeFresh === true,
            quoteUsd: valuation?.gates?.quoteIdentity === true && valuation?.quoteFreshness === 'FRESH',
            valuation: valuation?.authorityEligible === true,
            execution: this.capabilities.execution.lastSuccessAt !== null
                && now - this.capabilities.execution.lastSuccessAt <= 30_000 && evidenceOperational,
        };
        const wrap = (name) => ({ available: available[name], ...this.capabilities[name] });
        return { schemaVersion: HEALTH_SCHEMA_VERSION, observedAt: now,
            discoveryAvailable: wrap('discovery'), marketStateAvailable: wrap('marketState'),
            quoteUsdAvailable: wrap('quoteUsd'), valuationAvailable: wrap('valuation'),
            executionStreamAvailable: { ...wrap('execution'), transportMode: this.streamStatus === 'live' ? 'WS' : 'POLLING' },
            terrainAuthorityAvailable: { ...wrap('valuation'), available: available.valuation,
                status: available.valuation ? 'HEALTHY' : 'UNAVAILABLE',
                reason: available.valuation ? null : this.capabilities.valuation.reason },
            currentWindow: { complete: currentCoverage && evidenceOperational && !(ingestion?.pendingEvidence > 0),
                observedSince: this.coverageHealthySince,
                pending: !currentCoverage, reason: currentCoverage ? null : this.pendingCoverageFailure?.reason
                    || this.capabilities.execution.reason || 'OBSERVING_60S_WINDOW' },
            historicalCoverage: { incomplete: this.coverageGaps.length > 0, gaps: this.coverageGaps.slice(-8), totalGaps: this.coverageGaps.length },
            workerConnected: true, executionTransport: this.streamStatus, policy: this.policy.snapshot(),
            evidence: ingestion?.acquisition || null };
    }

    isDegraded() {
        const health = this.health();
        return !health.marketStateAvailable.available || this.market?.unsupportedPools > 0
            || this.capabilities.discovery.status === 'RETRY_WAIT'
            || this.capabilities.execution.status === 'RETRY_WAIT';
    }

    diagnostics() {
        return { tokenMint: this.tokenMint, primaryMarket: this.market?.selection || null,
            canonicalMarket: this.market?.canonicalMarket || null, sourceEpoch: this.sourceEpoch,
            identityFailure: this.capabilities.discovery.reason || this.market?.identityFailure || null,
            canonicalValuation: this.valuationBoundary?.snapshot() || null,
            valuationFailure: this.capabilities.valuation.reason || this.market?.valuationFailure || null,
            ...this.ingestion?.diagnostics(), coverageIncomplete: this.coverageIncomplete,
            unsupportedPools: this.market?.unsupportedPools || 0, health: this.health(), degraded: this.isDegraded() };
    }

    async schedule() { await this.ctx.storage.setAlarm(Date.now() + 3000); }
    webSocketClose() { if (!this.ctx.getWebSockets().length) this.closeUpstream(); }
    webSocketError() { this.webSocketClose(); }
    closeUpstream() {
        const socket = this.upstream; this.upstream = null; this.streamStatus = 'disconnected';
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
