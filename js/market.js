import { CONFIG } from './config.js';
import { selectMarket } from './market-selection.js';
import { activeTrade } from './market-evidence.js';


function number(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function deriveSolPrice(pairs) {
    const ordered = [...pairs].sort((a, b) => number(b.liquidity?.usd) - number(a.liquidity?.usd)
        || String(a.pairAddress || '').localeCompare(String(b.pairAddress || '')));
    const solBasePair = ordered.find((pair) =>
        isSolToken(pair?.baseToken)
        && number(pair.priceUsd) > 0
    );
    if (solBasePair) return number(solBasePair.priceUsd);
    const solPair = ordered.find((pair) =>
        isSolToken(pair?.quoteToken)
        && number(pair.priceUsd) > 0
        && number(pair.priceNative) > 0
    );
    return solPair ? number(solPair.priceUsd) / number(solPair.priceNative) : 0;
}

function isSolToken(token) {
    return token?.address === CONFIG.SOL_MINT;
}

export function selectTrackedPools(pairs, tokenContext, limit = CONFIG.MAX_TRACKED_POOLS) {
    return selectMarket(pairs, tokenContext?.identity?.mint, null, Date.now(), limit)?.pools || [];
}

export function parseGeckoTrade(entry, pool, solPriceUsd, tokenContext) {
    const attrs = entry?.attributes;
    if (!attrs?.tx_hash || !attrs?.kind) return null;

    const fromAddress = attrs.from_token_address;
    const toAddress = attrs.to_token_address;
    const isBuy = attrs.kind === 'buy';
    const tokenMint = tokenContext?.identity?.mint;
    if (!tokenMint || (fromAddress !== tokenMint && toAddress !== tokenMint)) return null;
    const tokenAmount = fromAddress === tokenMint
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
        evidenceLevel: 'PROVIDER_INDICATIVE',
        authorityEligible: false,
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
        tokenMint,
    };
}

export function calculatePressure(trades, now = Date.now()) {
    const unique = [...new Map(trades.filter(activeTrade).map((t) => [t.id, t])).values()];
    const eligible = unique.filter((trade) => trade.timestamp !== null && now - trade.timestamp >= 0 && now - trade.timestamp <= CONFIG.PRESSURE_WINDOW_MS);
    const recent = eligible.filter((trade) => trade.quoteMint === CONFIG.SOL_MINT && Number.isFinite(trade.solValue) && trade.solValue > 0);
    const buySol = recent.filter((trade) => trade.isBuy).reduce((sum, trade) => sum + trade.solValue, 0);
    const sellSol = recent.filter((trade) => !trade.isBuy).reduce((sum, trade) => sum + trade.solValue, 0);
    const total = buySol + sellSol;
    const bullPercent = total > 0 ? (buySol / total) * 100 : 50;
    return { buySol, sellSol, totalSol: total, bullPercent, bearPercent: 100 - bullPercent,
        coverage: { included: recent.length, excludedNonSol: eligible.length - recent.length, basis: 'VERIFIED_SOL_QUOTE_ONLY' } };
}

export function summarizePoolActivity(pairs, timeframe = 'm5') {
    return pairs.reduce((activity, pair) => {
        activity.buyCount += Math.max(0, Math.round(number(pair?.txns?.[timeframe]?.buys)));
        activity.sellCount += Math.max(0, Math.round(number(pair?.txns?.[timeframe]?.sells)));
        return activity;
    }, { buyCount: 0, sellCount: 0, windowMs: timeframe === 'h1' ? 3_600_000 : 300_000, source: 'dexscreener' });
}

export function deriveBattleTactics({ buySol = 0, sellSol = 0, buyCount = 0, sellCount = 0 } = {}) {
    const safeBuySol = Math.max(0, number(buySol));
    const safeSellSol = Math.max(0, number(sellSol));
    const totalSol = safeBuySol + safeSellSol;
    const totalTrades = Math.max(0, number(buyCount)) + Math.max(0, number(sellCount));
    const balance = totalSol > 0 ? (safeBuySol - safeSellSol) / totalSol : 0;
    const flowIntensity = Math.min(1, Math.log1p(totalSol) / Math.log(41));
    const activityLevel = Math.min(1, Math.log1p(totalTrades) / Math.log(221));

    if (totalSol < 0.01) {
        return { state: 'holding', balance: 0, flowIntensity: 0, activityLevel };
    }
    if (Math.abs(balance) < 0.12) {
        return { state: 'contested', balance, flowIntensity, activityLevel };
    }
    if (balance > 0) {
        return { state: 'bull', balance, flowIntensity, activityLevel };
    }
    return { state: 'bear', balance, flowIntensity, activityLevel };
}

export function evaluateBuySwarm(trades, now = Date.now(), lastTriggeredAt = 0) {
    const recent = trades.filter((trade) => activeTrade(trade) && trade.quoteMint === CONFIG.SOL_MINT
        && Number.isFinite(trade.solValue) && trade.timestamp !== null && now - trade.timestamp >= 0
        && now - trade.timestamp <= CONFIG.BUY_SWARM_WINDOW_MS);
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
