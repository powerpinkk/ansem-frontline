import { parseTransaction } from './parser.js';

const HISTORY_WINDOW_SECONDS = 5 * 60;
const MAX_POOLS = 2;
const SIGNATURES_PER_POOL = 6;

export async function fetchRecentTrades(env, configuration, fetchImpl = fetch) {
    if (!env.HELIUS_API_KEY) throw new Error('Missing Helius API key');
    const since = Math.floor(Date.now() / 1_000) - HISTORY_WINDOW_SECONDS;
    const pools = configuration.pools.slice(0, MAX_POOLS);
    const signatureResults = await Promise.allSettled(pools.map(async (pool) => {
        const payload = await rpcRequest(env.HELIUS_API_KEY, {
            jsonrpc: '2.0',
            id: pool.address,
            method: 'getSignaturesForAddress',
            params: [pool.address, { limit: SIGNATURES_PER_POOL, commitment: 'confirmed' }],
        }, fetchImpl);
        if (payload.error) throw new Error(`Helius signatures RPC ${payload.error.code}`);
        return (Array.isArray(payload.result) ? payload.result : [])
            .filter((item) => !item.err && Number(item.blockTime) >= since && item.signature)
            .map((item) => ({ signature: item.signature, pool }));
    }));
    const successful = signatureResults.filter((result) => result.status === 'fulfilled');
    if (!successful.length) {
        const firstFailure = signatureResults.find((result) => result.status === 'rejected');
        throw firstFailure?.reason || new Error('Helius history unavailable');
    }

    const signatureRecords = [...new Map(successful
        .flatMap((result) => result.value)
        .map((item) => [item.signature, item]))
        .values()];
    if (!signatureRecords.length) return { trades: [], pools: successful.length, source: 'helius-history' };

    const batch = signatureRecords.map(({ signature }, index) => ({
        jsonrpc: '2.0',
        id: index + 1,
        method: 'getTransaction',
        params: [signature, {
            encoding: 'jsonParsed',
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
        }],
    }));
    const response = await fetchImpl(heliusRpcUrl(env.HELIUS_API_KEY), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(batch),
            signal: AbortSignal.timeout(5_000),
        });
    if (!response.ok) throw new Error(`Helius transactions ${response.status}`);
    const transactionPayloads = await response.json();
    if (!Array.isArray(transactionPayloads)) throw new Error('Invalid Helius transaction batch');
    const transactionsById = new Map(transactionPayloads.map((item) => [Number(item.id), item.result]));

    const trades = [...new Map(signatureRecords
        .map(({ signature, pool }, index) => {
            const transaction = transactionsById.get(index + 1);
            if (!transaction?.meta || transaction.meta.err) return null;
            try {
                return parseTransaction(transaction, signature, pool, env.TOKEN_MINT, configuration.market);
            } catch {
                return null;
            }
        })
        .filter(Boolean)
        .map((trade) => [trade.txHash, trade]))
        .values()]
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(-40);
    return { trades, pools: successful.length, source: 'helius-history' };
}

async function rpcRequest(apiKey, body, fetchImpl) {
    const response = await fetchImpl(heliusRpcUrl(apiKey), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Helius history ${response.status}`);
    return response.json();
}

export function normalizeRecentTransactions(result, pool, tokenMint, market) {
    const entries = Array.isArray(result?.data) ? result.data : [];
    return entries.map((entry) => {
        const transaction = unwrapTransaction(entry);
        const signature = entry?.signature
            || transaction?.transaction?.signatures?.[0]
            || entry?.transaction?.signatures?.[0];
        if (!transaction?.meta || transaction.meta.err || !signature) return null;
        try {
            return parseTransaction(transaction, signature, pool, tokenMint, market);
        } catch {
            return null;
        }
    }).filter(Boolean);
}

function unwrapTransaction(entry) {
    if (entry?.meta && entry?.transaction?.message) return entry;
    if (entry?.transaction?.meta && entry.transaction?.transaction?.message) return entry.transaction;
    return null;
}

function heliusRpcUrl(apiKey) {
    return `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`;
}
