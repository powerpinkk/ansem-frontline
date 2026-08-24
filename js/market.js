import { CONFIG } from './config.js';

const SUPPORTED_QUOTES = new Set(['SOL', 'WSOL', 'USDC', 'USDT']);

function number(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function deriveSolPrice(pairs) {
    const solPair = pairs.find((pair) =>
        ['SOL', 'WSOL'].includes(pair?.quoteToken?.symbol?.toUpperCase())
        && number(pair.priceUsd) > 0
        && number(pair.priceNative) > 0
    );
    return solPair ? number(solPair.priceUsd) / number(solPair.priceNative) : 0;
}

export function selectTrackedPools(pairs, limit = CONFIG.MAX_TRACKED_POOLS) {
    return pairs
        .filter((pair) => pair?.chainId === 'solana')
        .filter((pair) => pair?.baseToken?.address === CONFIG.TOKEN_MINT)
        .filter((pair) => SUPPORTED_QUOTES.has(pair?.quoteToken?.symbol?.toUpperCase()))
        .sort((a, b) => poolScore(b) - poolScore(a))
        .slice(0, limit)
        .map((pair) => ({
            address: pair.pairAddress,
            dexId: pair.dexId,
            quoteSymbol: pair.quoteToken.symbol.toUpperCase(),
            liquidityUsd: number(pair.liquidity?.usd),
            volumeH24Usd: number(pair.volume?.h24),
            volumeH1Usd: number(pair.volume?.h1),
            url: pair.url,
        }));
}

function poolScore(pair) {
    return number(pair.volume?.h1) * 8
        + number(pair.volume?.h24)
        + number(pair.liquidity?.usd) * 0.25;
}

export function parseGeckoTrade(entry, pool, solPriceUsd) {
    const attrs = entry?.attributes;
    if (!attrs?.tx_hash || !attrs?.kind) return null;

    const fromAddress = attrs.from_token_address;
    const toAddress = attrs.to_token_address;
    const isBuy = attrs.kind === 'buy';
    const tokenAmount = fromAddress === CONFIG.TOKEN_MINT
        ? number(attrs.from_token_amount)
        : number(attrs.to_token_amount);
    const exactSolAmount = fromAddress === CONFIG.SOL_MINT
        ? number(attrs.from_token_amount)
        : toAddress === CONFIG.SOL_MINT
            ? number(attrs.to_token_amount)
            : 0;
    const usdValue = number(attrs.volume_in_usd);
    const solValue = exactSolAmount || (solPriceUsd > 0 ? usdValue / solPriceUsd : 0);
    const timestamp = Date.parse(attrs.block_timestamp);

    if (!Number.isFinite(timestamp) || tokenAmount <= 0 || solValue <= 0) return null;

    return {
        id: entry.id || `${attrs.tx_hash}:${pool.address}:${attrs.block_number}`,
        txHash: attrs.tx_hash,
        isBuy,
        tokenAmount,
        usdValue,
        solValue,
        isWhale: solValue >= CONFIG.WHALE_TRADE_THRESHOLD_SOL,
        timestamp,
        wallet: attrs.tx_from_address || '',
        poolAddress: pool.address,
        dexId: pool.dexId,
        quoteSymbol: pool.quoteSymbol,
    };
}

export function calculatePressure(trades, now = Date.now()) {
    const recent = trades.filter((trade) => now - trade.timestamp <= CONFIG.PRESSURE_WINDOW_MS);
    const buySol = recent.filter((trade) => trade.isBuy).reduce((sum, trade) => sum + trade.solValue, 0);
    const sellSol = recent.filter((trade) => !trade.isBuy).reduce((sum, trade) => sum + trade.solValue, 0);
    const total = buySol + sellSol;
    const bullPercent = total > 0 ? (buySol / total) * 100 : 50;
    return { buySol, sellSol, totalSol: total, bullPercent, bearPercent: 100 - bullPercent };
}

export function summarizePoolActivity(pairs, timeframe = 'm5') {
    return pairs.reduce((activity, pair) => {
        activity.buyCount += Math.max(0, Math.round(number(pair?.txns?.[timeframe]?.buys)));
        activity.sellCount += Math.max(0, Math.round(number(pair?.txns?.[timeframe]?.sells)));
        return activity;
    }, { buyCount: 0, sellCount: 0, windowMs: timeframe === 'h1' ? 3_600_000 : 300_000, source: 'dexscreener' });
}

export function scaleActivityToReserves(tradeCount, limit = 24) {
    const count = Math.max(0, number(tradeCount));
    if (!count) return 0;
    return Math.min(limit, Math.max(3, Math.round(Math.sqrt(count) * 2.5)));
}

export function evaluateBuySwarm(trades, now = Date.now(), lastTriggeredAt = 0) {
    const recent = trades.filter((trade) => now - trade.timestamp <= CONFIG.BUY_SWARM_WINDOW_MS);
    const unique = [...new Map(recent.map((trade) => [trade.txHash || trade.id, trade])).values()];
    const buys = unique.filter((trade) => trade.isBuy);
    const buySol = buys.reduce((sum, trade) => sum + trade.solValue, 0);
    const sellSol = unique.filter((trade) => !trade.isBuy).reduce((sum, trade) => sum + trade.solValue, 0);
    const totalSol = buySol + sellSol;
    const dominance = totalSol > 0 ? buySol / totalSol : 0;
    const cooledDown = now - lastTriggeredAt >= CONFIG.BUY_SWARM_COOLDOWN_MS;
    return {
        triggered: cooledDown
            && buys.length >= CONFIG.BUY_SWARM_MIN_TRADES
            && buySol >= CONFIG.BUY_SWARM_MIN_SOL
            && dominance >= CONFIG.BUY_SWARM_MIN_DOMINANCE,
        buyCount: buys.length,
        buySol,
        dominance,
        windowMs: CONFIG.BUY_SWARM_WINDOW_MS,
    };
}
