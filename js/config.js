const configuredStreamUrl = import.meta.env.MODE === 'e2e' ? 'disabled' : import.meta.env.VITE_STREAM_URL;

export const CONFIG = {
    TOKEN_MINT: '9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump',
    SOL_MINT: 'So11111111111111111111111111111111111111112',
    STREAM_URL: configuredStreamUrl === 'disabled'
        ? ''
        : configuredStreamUrl || 'wss://ansem-frontline-stream.ansem-frontline.workers.dev/stream',
    RELAY_MARKET_URL: 'https://ansem-frontline-stream.ansem-frontline.workers.dev/market',
    WHALE_TRADE_THRESHOLD_SOL: 20,

    FETCH_MIN_DELAY_MS: 5000,
    FETCH_MAX_DELAY_MS: 60000,
    POOL_REFRESH_MS: 5 * 60 * 1000,
    MAX_TRACKED_POOLS: 5,
    TRADES_POLL_MIN_DELAY_MS: 8000,
    TRADES_POLL_MAX_DELAY_MS: 45000,
    GECKO_RATE_LIMIT_COOLDOWN_MS: 60000,
    CHART_CACHE_MS: 60000,
    PRESSURE_WINDOW_MS: 60_000,
    BUY_SWARM_WINDOW_MS: 12_000,
    BUY_SWARM_MIN_TRADES: 5,
    BUY_SWARM_MIN_SOL: 5,
    BUY_SWARM_MIN_DOMINANCE: 0.75,
    BUY_SWARM_COOLDOWN_MS: 25_000,

    MINI_CHART_WIDTH: 120,
    MINI_CHART_HEIGHT: 35,

    MAX_TRADES_FEED: 25,
    MAX_KILLFEED: 20,
    TRADES_BOOTSTRAP_COUNT: 16,
    MAX_VISIBLE_UNITS_PER_SIDE: 8,

    DEXSCREENER_TOKEN_URL: 'https://api.dexscreener.com/token-pairs/v1/solana',
    DEXSCREENER_PAIR_URL: 'https://api.dexscreener.com/latest/dex/pairs/solana',
    GECKO_BASE: 'https://ansem-frontline-stream.ansem-frontline.workers.dev/gecko/networks/solana/pools',
};
