import { CONFIG } from './config.js';
import { DEMO_MINT } from './token-presets.js';
import { calculatePressure } from './market.js';

export const isDemoTrade = t => t?.synthetic === true && t.evidenceLevel === 'SYNTHETIC_FIXTURE'
    && t.tokenMint === DEMO_MINT && typeof t.id === 'string' && Number.isFinite(t.solValue) && t.solValue > 0;
export function demoTrade(index, start, cadence = 1700, quiet = false) {
    const solValue = quiet ? .1 + index % 4 * .1 : index % 13 === 0 ? 24 : .25 + (index * 17 % 50) / 10;
    return Object.freeze({ id: `demo:${index}`, synthetic: true, evidenceLevel: 'SYNTHETIC_FIXTURE',
        authorityEligible: false, tokenMint: DEMO_MINT, isBuy: index % 7 < 4, solValue,
        quoteMint: CONFIG.SOL_MINT, quoteSymbol: 'SOL', quoteAmount: solValue, quoteDecimals: 9,
        rawQuoteAmount: String(Math.round(solValue * 1e9)), usdValue: null, estimatedUsdNotional: null,
        isWhale: solValue >= CONFIG.WHALE_TRADE_THRESHOLD_SOL, timestamp: start + index * cadence,
        txHash: null, signature: null, dexId: 'synthetic', poolAddress: null, settlement: 'DEMO' });
}
// One reproducible sequence, explicitly synthetic. The timer is acquisition,
// not a second combat clock. No HTTP, WebSocket, keys or live journal writes.
export function initDemoAPI(callbacks, { runtime, now = Date.now, interval = setInterval, clear = clearInterval, demoProfile = 'representative' } = {}) {
    const { state } = runtime;
    state.mode = 'demo';
    const profile = ['quiet', 'representative', 'peak'].includes(demoProfile) ? demoProfile : 'representative';
    const cadence = profile === 'quiet' ? 12000 : profile === 'peak' ? 300 : 1700;
    state.demoProfile = profile;
    const start = now() - (profile === 'quiet' ? 2 : 12) * cadence;
    let index = 0, destroyed = false;
    function pump() {
        if (destroyed) return;
        const time = now();
        const target = Math.floor((time - start) / cadence);
        // Visibility suspension cannot build an unbounded catch-up queue.
        index = Math.max(index, target - Math.ceil(60000 / cadence));
        const fresh = [];
        while (index <= target) fresh.push(demoTrade(index++, start, cadence, profile === 'quiet'));
        state.liveTrades = [...state.liveTrades, ...fresh].filter(t => time - t.timestamp <= 60_000).slice(-1024);
        const p = calculatePressure(state.liveTrades, time, isDemoTrade);
        state.buySol60s = p.buySol; state.sellSol60s = p.sellSol; state.momentum = p.bullPercent;
        state.targetFrontlineX = Math.max(-45, Math.min(45, (p.bullPercent - 50) * .9));
        state.marketTrend = Math.sign(p.buySol - p.sellSol); state.pressureCoverage = p.coverage;
        state.price = .000000013 * (1 + Math.sin((index - 1) * .11) * .08); state.indicativePrice = state.price;
        state.priceHistory.push(state.price); state.priceHistory = state.priceHistory.slice(-60);
        state.priceTicks30s.push({ timestamp: time, price: state.price });
        state.priceTicks30s = state.priceTicks30s.filter(t => time - t.timestamp <= 30_000).slice(-120);
        state.activity5m = { buyCount: profile === 'quiet' ? 1 : profile === 'peak' ? 800 : 8, sellCount: profile === 'quiet' ? 1 : profile === 'peak' ? 750 : 6, windowMs: 300_000, source: 'synthetic-fixture' };
        state.activity1h = { buyCount: profile === 'quiet' ? 4 : profile === 'peak' ? 10000 : 40, sellCount: profile === 'quiet' ? 4 : profile === 'peak' ? 10000 : 35, windowMs: 3_600_000, source: 'synthetic-fixture' };
        state.lastMarketAt = time; state.lastTradeAt = state.liveTrades.at(-1)?.timestamp || 0;
        state.connection = 'demo';
        callbacks.onMarketUpdate?.({ price: state.price, chg: Math.sin(index * .11) * 8, pools: 0, coverage: 0, source: 'synthetic-demo' });
        for (const t of fresh) callbacks.onTrade?.(t, { bootstrap: index <= 14, synthetic: true });
        callbacks.onPressureUpdate?.(p); callbacks.onActivityUpdate?.(state.activity5m);
        callbacks.onConnectionChange?.('demo'); callbacks.onBootstrapComplete?.();
    }
    pump(); const timer = interval(pump, 1000);
    return { refresh: async () => pump(), destroy() { if (!destroyed) { destroyed = true; clear(timer); } },
        getDiagnostics: () => ({ mode: 'synthetic-demo', index, destroyed, requests: 0, sockets: 0, timers: destroyed ? 0 : 1 }) };
}
