/* global console, process, setTimeout, clearTimeout, fetch, AbortSignal */
import { randomBytes } from 'node:crypto';
import { connect } from 'node:tls';
import { URL } from 'node:url';

const ORIGIN = (process.env.WORKER_ORIGIN || 'https://ansem-frontline-stream.ansem-frontline.workers.dev').replace(/\/$/, '');
const HOST = new URL(ORIGIN).hostname;
const MINT = '9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump';
const FRONTENDS = [
    'https://ansem-frontline.vercel.app',
    'https://powerpinkk.github.io',
];

async function response(path, init = {}) {
    const result = await fetch(`${ORIGIN}${path}`, { ...init, signal: AbortSignal.timeout(60_000) });
    const text = await result.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { result, body };
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function websocketUpgrade(frontendOrigin) {
    return new Promise((resolve, reject) => {
        const socket = connect({ host: HOST, port: 443, servername: HOST });
        let received = '';
        const timeout = setTimeout(() => {
            socket.destroy();
            reject(new Error(`WebSocket upgrade timed out for ${frontendOrigin}`));
        }, 20_000);
        socket.once('secureConnect', () => {
            const key = randomBytes(16).toString('base64');
            socket.write([
                `GET /stream?mint=${MINT} HTTP/1.1`,
                `Host: ${HOST}`,
                'Connection: Upgrade',
                'Upgrade: websocket',
                'Sec-WebSocket-Version: 13',
                `Sec-WebSocket-Key: ${key}`,
                `Origin: ${frontendOrigin}`,
                '',
                '',
            ].join('\r\n'));
        });
        socket.on('data', (chunk) => {
            received += chunk.toString('latin1');
            if (!received.includes('\r\n\r\n')) return;
            clearTimeout(timeout);
            socket.destroy();
            const statusLine = received.split('\r\n', 1)[0];
            if (!/^HTTP\/1\.1 101\b/.test(statusLine)) reject(new Error(`WebSocket upgrade failed: ${statusLine}`));
            else resolve(statusLine);
        });
        socket.once('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });
    });
}

const report = { origin: ORIGIN, health: {}, websocket: {}, market: null, recent: null };
for (const frontend of FRONTENDS) {
    const { result, body } = await response('/health', { headers: { Origin: frontend } });
    assert(result.status === 200, `/health returned ${result.status} for ${frontend}`);
    assert(body?.ok === true && body?.service === 'ansem-frontline-stream', 'Invalid health payload');
    assert(result.headers.get('access-control-allow-origin') === frontend, `Invalid health CORS for ${frontend}`);
    assert(result.headers.get('cache-control') === 'no-store', 'Health must not be cached');
    report.health[frontend] = result.status;
    report.websocket[frontend] = await websocketUpgrade(frontend);
}

const hostile = await response('/health', { headers: { Origin: 'https://attacker.example' } });
assert(hostile.result.status === 403, 'Untrusted browser origin was not rejected');

const market = await response(`/market?mint=${MINT}`, { headers: { Origin: FRONTENDS[0] } });
assert(market.result.status === 200, `/market returned ${market.result.status}`);
assert(market.body?.token?.identity?.mint === MINT, 'Market response has the wrong mint');
assert(market.body?.valuation?.authorityEligible === false, 'Provider fallback must remain non-authoritative');
report.market = {
    status: market.body.status,
    source: market.body.source,
    valuationKind: market.body.valuation?.kind,
    freshness: market.body.valuation?.freshness,
};

const recent = await response('/recent', {
    method: 'POST',
    headers: { Origin: FRONTENDS[1], 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'configure', token: { mint: MINT, chain: 'solana' } }),
});
assert(recent.result.status === 200, `/recent returned ${recent.result.status}`);
assert(recent.body?.version === 4 && recent.body?.tokenMint === MINT, 'Recent response has the wrong identity/version');
assert(recent.body?.canonicalMarket?.tokenMint === MINT, 'Canonical market did not initialize');
assert(Number.isInteger(recent.body?.sourceEpoch) && recent.body.sourceEpoch > 0, 'Source epoch did not initialize');
assert(recent.body?.integrity && typeof recent.body.integrity === 'object', 'Integrity diagnostics are unavailable');
report.recent = {
    status: recent.body.status,
    sourceEpoch: recent.body.sourceEpoch,
    market: recent.body.canonicalMarket.address,
    protocol: recent.body.canonicalMarket.protocol,
    compatibility: recent.body.canonicalMarket.compatibility,
    authorityEligible: recent.body.canonicalValuation?.authorityEligible ?? false,
    settlement: recent.body.trades?.[0]?.settlement ?? 'NO_NATURAL_ACTIVITY',
    records: recent.body.integrity.records,
    duplicates: recent.body.integrity.duplicates,
    pendingReconciliations: recent.body.integrity.pendingReconciliations,
};

console.log(JSON.stringify(report));
