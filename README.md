# $ANSEM FRONTLINE

An open-source 3D market visualization that turns verified `$ANSEM` swaps on Solana into a live bull-versus-bear battlefield.

- Token: `$ANSEM`
- Contract address: `9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump`
- Live application: [ansem-frontline.vercel.app](https://ansem-frontline.vercel.app/)

## What the visualization means

| Market event | Battlefield representation |
| --- | --- |
| Verified buy | One black bull |
| Verified sell | One bear |
| Buy worth at least 20 SOL | Giant black bull with luminous green eyes and aura |
| Sell worth at least 20 SOL | Giant bear with luminous red eyes and aura |
| 60-second net buy/sell volume | Bull/bear dominance and frontline position |
| Reference-pool OHLCV | One-hour mini price chart |

Every spawned unit originates from a trade returned by GeckoTerminal. There are no randomly generated market events. Combat animation and damage are visual metaphors and are intentionally simulated.

## Data methodology

DexScreener is used to discover active Solana pools and calculate a liquidity-weighted token price. The preferred production path uses a Helius standard WebSocket behind a Cloudflare Durable Object: the Worker subscribes to every discovered pool, parses confirmed balance changes and broadcasts normalized trades without exposing the Helius key. If the stream is unavailable, the browser automatically returns to GeckoTerminal polling of the four most active pools. GeckoTerminal also supplies OHLCV candles.

Trade value is normalized to SOL:

- SOL pools use the exact wrapped-SOL amount from the swap.
- Stablecoin pools divide verified USD volume by the derived SOL/USD price.
- Each trade links to its Solscan transaction for independent verification.

The UI displays the number of monitored pools and their share of DexScreener-reported 24-hour volume. This is a near-real-time visualization, not an exchange feed: public API polling introduces several seconds of latency and extremely short-lived trades may be delayed. It is not financial advice.

## Architecture

```text
DexScreener ── pool discovery, price, liquidity, market cap
      │
      ├── pool ranking and coverage calculation
      │
Helius WSS ── confirmed pool transactions
      │
Cloudflare Durable Object ── secure parsing and WebSocket broadcast
      │
      ├── automatic fallback: GeckoTerminal verified swaps
      ├── GeckoTerminal OHLCV
      │
      ├── parsing, SOL normalization, deduplication
      ├── rolling 60-second pressure model
      │
      └── Three.js battlefield
            ├── one entity per verified swap
            ├── trade-sized combat attributes
            ├── terrain, grass, rocks and trees
            └── obstacle steering and stuck recovery
```

The code deliberately separates external data (`api.js`), pure market calculations (`market.js`), UI (`ui.js`) and rendering/simulation (`scene.js`).

## Local development

Requirements: Node.js 20.19 or newer.

```bash
npm ci
npm run dev
```

Production checks:

```bash
npm run lint
npm test
npm run build
```

## Project structure

```text
index.html                 Application shell
css/styles.css             Responsive interface
js/config.js               Public token and polling configuration
js/market.js               Pure pool/trade/pressure calculations
js/api.js                  Resilient multi-pool data ingestion
js/state.js                Runtime state
js/ui.js                   Safe DOM rendering and controls
js/scene.js                Three.js world and combat simulation
js/stream.js               WebSocket client and reconnection
worker/src/index.js        Cloudflare/Helius real-time relay
worker/src/parser.js       Generic Solana balance-change parser
tests/market.test.js       Market semantics and parsing tests
.github/workflows/ci.yml   Automated quality gate
vercel.json                Deployment and security headers
```

## Privacy and security

The application has no backend, accounts, cookies, wallet connection or trading capability. It does not contain private API keys. Wallet addresses visible in the public trade feed originate from public Solana transactions and are not persisted by this project.

The optional Helius credential is stored only as a Cloudflare Worker secret. `VITE_STREAM_URL` is a public relay URL and can safely be configured in Vercel.

## Free real-time relay deployment

1. Create free Helius and Cloudflare accounts.
2. Authenticate Wrangler with `npx wrangler login`.
3. Store the key securely: `npx wrangler secret put HELIUS_API_KEY --config worker/wrangler.jsonc`.
4. Deploy: `npm run worker:deploy`.
5. Add the resulting `/stream` WebSocket URL to Vercel as `VITE_STREAM_URL` and redeploy.

Never add the Helius key to `.env`, Vercel client variables or source control.

## Limitations and roadmap

- Without the optional relay, public polling is near-real-time and the four-pool cap protects GeckoTerminal's rate limit.
- With the relay, all pools discovered by DexScreener are subscribed over Helius standard WebSockets; unsupported or unusual transactions can still fall back to the polling source.
- Free-service quotas are suitable for a portfolio demo, not an SLA-backed trading product.
- Combat outcomes are illustrative and do not predict price movement.

## License

[MIT](LICENSE) © 2026 PowerPixelKK.
