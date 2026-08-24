export const CONFIG = {
    TOKEN_MINT: '9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump',
    SOL_MINT: 'So11111111111111111111111111111111111111112',
    WHALE_TRADE_THRESHOLD_SOL: 20,

    FETCH_MIN_DELAY_MS: 5000,
    FETCH_MAX_DELAY_MS: 60000,
    POOL_REFRESH_MS: 5 * 60 * 1000,
    MAX_TRACKED_POOLS: 4,
    TRADES_POLL_MIN_DELAY_MS: 2500,
    TRADES_POLL_MAX_DELAY_MS: 45000,
    CHART_CACHE_MS: 60000,
    PRESSURE_WINDOW_MS: 60_000,

    MINI_CHART_WIDTH: 120,
    MINI_CHART_HEIGHT: 35,

    MAX_TRADES_FEED: 25,
    MAX_KILLFEED: 20,
    TRADES_BOOTSTRAP_COUNT: 3,

    DEXSCREENER_TOKEN_URL: 'https://api.dexscreener.com/latest/dex/tokens',
    DEXSCREENER_PAIR_URL: 'https://api.dexscreener.com/latest/dex/pairs/solana',
    GECKO_BASE: 'https://api.geckoterminal.com/api/v2/networks/solana/pools',
};
