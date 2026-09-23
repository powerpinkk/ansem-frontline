export const ACQUISITION_POLICY_VERSION = 1;

const LIMITS = Object.freeze({
    standard: Object.freeze({ concurrency: 2, spacingMs: 250, rollingLimit: 162, queueLimit: 256 }),
    das: Object.freeze({ concurrency: 1, spacingMs: 1_000, rollingLimit: 4, queueLimit: 32 }),
});

const RETRYABLE_KINDS = new Set(['RATE_LIMIT', 'TIMEOUT', 'NETWORK', 'UPSTREAM_5XX', 'RPC_ERROR', 'MALFORMED']);

export class AcquisitionError extends Error {
    constructor(reason, options = {}) {
        super(reason);
        this.name = 'AcquisitionError';
        this.reason = reason;
        this.kind = options.kind || 'UNKNOWN';
        this.status = Number.isInteger(options.status) ? options.status : null;
        this.retryAfterMs = Number.isFinite(options.retryAfterMs) ? Math.max(0, options.retryAfterMs) : null;
        this.retryAt = Number.isFinite(options.retryAt) ? options.retryAt : null;
        this.retryable = options.retryable ?? RETRYABLE_KINDS.has(this.kind);
        this.deferred = options.deferred === true;
    }
}

export function retryAfterMs(value, now = Date.now()) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const trimmed = value.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.max(0, Math.ceil(Number(trimmed) * 1_000));
    const at = Date.parse(trimmed);
    return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

export function classifyTransportError(error) {
    if (error instanceof AcquisitionError) return error;
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
        return new AcquisitionError('RPC_TIMEOUT', { kind: 'TIMEOUT' });
    }
    return new AcquisitionError(error?.message || 'SEMANTIC_VERIFICATION_FAILURE', {
        kind: 'SEMANTIC_VERIFICATION', retryable: false,
    });
}

export function acquisitionFailure(error) {
    const failure = classifyTransportError(error);
    return Object.freeze({
        reason: failure.reason,
        kind: failure.kind,
        status: failure.status,
        retryAt: failure.retryAt,
        retryable: failure.retryable,
        deferred: failure.deferred,
    });
}

function envelopeError(status, retryHeader, now) {
    if (status === 429) return new AcquisitionError('RPC_HTTP_429', {
        kind: 'RATE_LIMIT', status, retryAfterMs: retryAfterMs(retryHeader, now),
    });
    if (status === 401 || status === 403) return new AcquisitionError(`RPC_HTTP_${status}`, {
        kind: 'AUTH', status, retryable: false,
    });
    if (status >= 500) return new AcquisitionError(`RPC_HTTP_${status}`, { kind: 'UPSTREAM_5XX', status });
    return new AcquisitionError(`RPC_HTTP_${status}`, { kind: 'CONFIGURATION', status, retryable: false });
}

export function createJsonRpcTransport(env, fetchImpl = fetch, options = {}) {
    const timeoutMs = options.timeoutMs || 8_000;
    const now = options.now || Date.now;
    return async (method, params, signal) => {
        if (!env.HELIUS_API_KEY) throw new AcquisitionError('RPC_NOT_CONFIGURED', { kind: 'CONFIGURATION', retryable: false });
        let response;
        try {
            response = await fetchImpl(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(env.HELIUS_API_KEY)}`, {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
                signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
            });
        } catch (error) {
            if (error instanceof AcquisitionError) throw error;
            if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
                throw new AcquisitionError('RPC_TIMEOUT', { kind: 'TIMEOUT' });
            }
            throw new AcquisitionError('RPC_NETWORK_FAILURE', { kind: 'NETWORK' });
        }
        if (!response?.ok) throw envelopeError(response?.status || 0, response?.headers?.get?.('retry-after'), now());
        let payload;
        try { payload = await response.json(); }
        catch { throw new AcquisitionError('RPC_MALFORMED_JSON', { kind: 'MALFORMED' }); }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)
            || payload.jsonrpc !== '2.0' && payload.jsonrpc !== undefined
            || !Object.hasOwn(payload, 'result') && !payload.error) {
            throw new AcquisitionError('RPC_MALFORMED_ENVELOPE', { kind: 'MALFORMED' });
        }
        if (payload.error) {
            const code = Number.isInteger(payload.error.code) ? payload.error.code : 'UNKNOWN';
            throw new AcquisitionError(`RPC_ERROR_${code}`, { kind: 'RPC_ERROR' });
        }
        const result = payload.result;
        const valid = method === 'getMultipleAccounts'
            ? result && Number.isSafeInteger(result.context?.slot) && Array.isArray(result.value)
            : method === 'getSignaturesForAddress' ? Array.isArray(result)
                : method === 'getSignatureStatuses' ? result && Array.isArray(result.value)
                    : method === 'getAsset' ? result && typeof result === 'object' && !Array.isArray(result)
                        : method === 'getTransaction' ? result === null || result && typeof result === 'object' && !Array.isArray(result)
                            : Object.hasOwn(payload, 'result');
        if (!valid) throw new AcquisitionError('RPC_MALFORMED_RESULT', { kind: 'MALFORMED' });
        return result;
    };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const blankDomain = () => ({ streak: 0, transientStreak: 0, nextRetryAt: 0, probeKey: null,
    status: 'HEALTHY', reason: null, lastAttemptAt: null, lastSuccessAt: null, lastFailureAt: null, generation: 0 });

export function createAcquisitionPolicy({ storage = null, now = Date.now, random = Math.random, sleep = wait } = {}) {
    const domains = { standard: blankDomain(), das: blankDomain() };
    const active = { standard: 0, das: 0 };
    const lastStart = { standard: 0, das: 0 };
    const starts = { standard: [], das: [] };
    const inflightProbe = { standard: false, das: false };
    const admission = {
        standard: { tail: Promise.resolve(), depth: 0 },
        das: { tail: Promise.resolve(), depth: 0 },
    };
    const capacityWaiters = { standard: new Set(), das: new Set() };
    const methodWaits = { standard: new Map(), das: new Map() };
    const methodStreaks = { standard: new Map(), das: new Map() };
    let loadPromise = null;

    async function load() {
        if (!storage) return;
        const saved = await storage.get('acquisitionPolicy:v1');
        for (const group of Object.keys(domains)) {
            const value = saved?.[group];
            if (!value || typeof value !== 'object') continue;
            domains[group] = { ...blankDomain(), ...value, generation: 0 };
            for (const [key, item] of Object.entries(value.methods || {}).slice(-16)) {
                if (Number.isFinite(item?.nextRetryAt)) methodWaits[group].set(key, item);
                if (Number.isInteger(item?.streak)) methodStreaks[group].set(key, item.streak);
            }
        }
    }
    async function persist() {
        if (!storage) return;
        const bounded = {};
        for (const group of Object.keys(domains)) {
            const d = domains[group];
            bounded[group] = { streak: d.streak, transientStreak: d.transientStreak,
                nextRetryAt: d.nextRetryAt, probeKey: d.probeKey, status: d.status,
                reason: d.reason, lastFailureAt: d.lastFailureAt,
                methods: Object.fromEntries([...methodWaits[group].entries()].slice(-16).map(([key, item]) => [key,
                    { ...item, streak: methodStreaks[group].get(key) || 0 }])) };
        }
        await storage.put('acquisitionPolicy:v1', bounded);
    }
    function ready() { return loadPromise ||= load(); }
    function trim(group, time) {
        starts[group] = starts[group].filter((at) => time - at < 60_000);
    }
    function defer(reason, retryAt) {
        return new AcquisitionError(reason, { kind: 'DEFERRED', retryAt, retryable: true, deferred: true });
    }
    function waitForCapacity(group) {
        return new Promise((resolve) => capacityWaiters[group].add(resolve));
    }
    function releaseCapacity(group) {
        const waiters = [...capacityWaiters[group]];
        capacityWaiters[group].clear();
        for (const resolve of waiters) resolve();
    }
    async function reserveAdmission(group, key) {
        const d = domains[group], limit = LIMITS[group];
        while (true) {
            const time = now();
            trim(group, time);
            const methodWait = methodWaits[group].get(key);
            if (methodWait && time < methodWait.nextRetryAt) throw defer(`${key}_RETRY_WAIT`, methodWait.nextRetryAt);
            if (methodWait) methodWaits[group].delete(key);
            if (time < d.nextRetryAt) throw defer(`${group.toUpperCase()}_COOLDOWN`, d.nextRetryAt);
            const halfOpen = d.status === 'RETRY_WAIT' || d.status === 'HALF_OPEN';
            // D26: after the shared deadline, any necessary real read can prove
            // provider-group reachability. The old key remains diagnostic only.
            if (halfOpen && inflightProbe[group]) throw defer(`${group.toUpperCase()}_PROBE_INFLIGHT`, d.nextRetryAt || time);
            if (starts[group].length >= limit.rollingLimit) {
                throw defer(`${group.toUpperCase()}_ROLLING_BUDGET`, starts[group][0] + 60_000);
            }
            if (active[group] >= limit.concurrency) {
                await waitForCapacity(group);
                continue;
            }
            const spacing = Math.max(0, limit.spacingMs - (time - lastStart[group]));
            if (spacing) {
                await sleep(spacing);
                continue;
            }
            // No await is permitted between this final check and reservation.
            if (halfOpen) { inflightProbe[group] = true; d.status = 'HALF_OPEN'; }
            active[group] += 1;
            const startedAt = now();
            lastStart[group] = startedAt;
            starts[group].push(startedAt);
            d.lastAttemptAt = startedAt;
            d.generation += 1;
            return { generation: d.generation, halfOpen, startedAt };
        }
    }
    async function admit(group, key) {
        await ready();
        const queue = admission[group], limit = LIMITS[group];
        if (queue.depth >= limit.queueLimit) {
            throw defer(`${group.toUpperCase()}_QUEUE_FULL`, now() + limit.spacingMs);
        }
        queue.depth += 1;
        const previous = queue.tail;
        let release;
        queue.tail = new Promise((resolve) => { release = resolve; });
        await previous;
        try { return await reserveAdmission(group, key); }
        finally { queue.depth -= 1; release(); }
    }
    function jitter(base) { return Math.max(1, Math.floor(base * Math.max(0, Math.min(1, random())) * 0.2)); }
    async function failed(group, key, error, ticket) {
        const d = domains[group], failure = classifyTransportError(error), time = now();
        if (ticket.generation < d.generation && d.lastSuccessAt && d.lastSuccessAt >= ticket.startedAt) return failure;
        d.lastFailureAt = time; d.reason = failure.reason; d.probeKey = key;
        if (failure.kind === 'RATE_LIMIT') {
            d.streak += 1; d.transientStreak += 1;
            const exponential = Math.min(300_000, 60_000 * 2 ** Math.min(8, d.streak - 1));
            const delay = Math.max(exponential, failure.retryAfterMs || 0);
            d.nextRetryAt = time + delay + jitter(exponential);
            d.status = 'RETRY_WAIT';
        } else if (failure.kind === 'AUTH' || failure.kind === 'CONFIGURATION') {
            d.streak += 1; d.nextRetryAt = time + 300_000; d.status = 'RETRY_WAIT';
        } else if (failure.retryable) {
            d.streak += 1;
            const transientStreak = (methodStreaks[group].get(key) || 0) + 1;
            methodStreaks[group].set(key, transientStreak); d.transientStreak = transientStreak;
            const base = Math.min(30_000, 1_000 * 2 ** Math.min(5, transientStreak - 1));
            const delay = transientStreak >= 3 ? Math.max(60_000, base) : base;
            const nextRetryAt = time + delay + jitter(base);
            if (transientStreak >= 3) {
                d.nextRetryAt = nextRetryAt; d.status = 'RETRY_WAIT';
            } else {
                methodWaits[group].set(key, { nextRetryAt, reason: failure.reason });
                d.nextRetryAt = 0; d.probeKey = null; d.status = 'HEALTHY';
            }
            failure.retryAt = nextRetryAt;
        }
        failure.retryAt ||= d.nextRetryAt || null;
        await persist();
        return failure;
    }
    async function succeeded(group, key, ticket) {
        const d = domains[group], time = now();
        if (ticket.generation < d.generation && d.lastFailureAt && d.lastFailureAt > ticket.startedAt) return;
        if (['RETRY_WAIT','HALF_OPEN'].includes(d.status) && !ticket.halfOpen) return;
        // A half-open success proves only shared provider reachability. Method
        // and evidence-job failures are retained and need their own proof.
        methodWaits[group].delete(key);
        methodStreaks[group].delete(key);
        d.streak = 0; d.transientStreak = 0; d.nextRetryAt = 0; d.probeKey = null;
        d.status = 'HEALTHY'; d.reason = null; d.lastSuccessAt = time;
        await persist();
    }
    async function run(group, key, operation) {
        if (!LIMITS[group]) throw new TypeError('Unknown acquisition group');
        const ticket = await admit(group, key);
        try {
            const result = await operation();
            await succeeded(group, key, ticket);
            return result;
        } catch (error) {
            if (error instanceof AcquisitionError && error.deferred) throw error;
            throw await failed(group, key, error, ticket);
        } finally {
            active[group] -= 1;
            if (ticket.halfOpen) inflightProbe[group] = false;
            releaseCapacity(group);
        }
    }
    function snapshot() {
        const result = {};
        for (const [group, d] of Object.entries(domains)) result[group] = Object.freeze({ ...d,
            attemptsInRollingMinute: (trim(group, now()), starts[group].length), active: active[group],
            queued: Math.max(0, admission[group].depth - 1), queueLimit: LIMITS[group].queueLimit });
        return Object.freeze(result);
    }
    return Object.freeze({ run, snapshot, ready });
}
