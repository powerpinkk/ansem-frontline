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
| Five or more unique buys totaling at least 5 SOL in 12 seconds, with ≥75% buy dominance | The flying Bull King casts three green support waves |
| 60-second net buy/sell volume | Bull/bear dominance and frontline position |
| Reference-pool OHLCV | One-hour mini price chart |

Every spawned unit originates from a verified swap returned by the Helius relay or GeckoTerminal fallback. There are no randomly generated market events. Combat animation and damage are visual metaphors and are intentionally simulated.

Units advance toward real opposing flow when it exists and otherwise hold formation around the rolling pressure frontline. Deterministic lanes, local avoidance, separation, stuck recovery and hard arena bounds keep the visualization readable. Regular units remain for 75 seconds and giant trades for 105 seconds, then retire without being counted as combat defeats; this keeps the battlefield representative of recent activity instead of accumulating historical trades forever.

The Bull King is a persistent visual commander inspired by the project's character artwork. A buy swarm can temporarily illuminate and strengthen existing bulls in the illustrative combat layer, but it never creates synthetic trades or directly changes dominance, price, or frontline position. Swarms have a 25-second cooldown and ignore duplicate transaction signatures.

## Data methodology

DexScreener is used in the browser to discover active Solana pools and calculate a liquidity-weighted token price. If that discovery request is unavailable, the Cloudflare Worker derives a conservative fallback price from Helius DAS metadata and returns two explicitly identified SOL pools; the interface labels this reduced coverage as `FALLBACK` instead of implying full market coverage. The browser sends the selected public pool addresses and current market prices to a Cloudflare Durable Object, which validates them before opening the preferred Helius WebSocket path. The Worker parses confirmed balance changes and broadcasts normalized trades without exposing the Helius key. If Helius does not explicitly confirm `live`, the browser keeps or restores GeckoTerminal polling of the same pools. GeckoTerminal also supplies OHLCV candles, whose failure is isolated from the trade feed.

Trade value is normalized to SOL:

- SOL pools use the exact wrapped-SOL amount from the swap.
- Stablecoin pools divide verified USD volume by the derived SOL/USD price.
- Each trade links to its Solscan transaction for independent verification.

The UI displays the number of monitored pools and their share of DexScreener-reported 24-hour volume. This is a near-real-time visualization, not an exchange feed: public API polling introduces several seconds of latency and extremely short-lived trades may be delayed. It is not financial advice.

## Architecture

```text
DexScreener ── primary pool discovery, price, liquidity, market cap
      │
      ├── pool ranking and coverage calculation
      │
Helius DAS ── fallback price and known SOL pools
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
            └── bounded formations, obstacle steering and stuck recovery
```

The code deliberately separates external data (`api.js`), pure market calculations (`market.js`), navigation rules (`navigation.js`), UI (`ui.js`) and rendering/simulation (`scene.js`).

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
js/navigation.js           Arena bounds, lanes, formations and lifetime rules
js/api.js                  Resilient multi-pool data ingestion
js/state.js                Runtime state
js/ui.js                   Safe DOM rendering and controls
js/scene.js                Three.js world and combat simulation
js/stream.js               WebSocket client and reconnection
worker/src/index.js        Cloudflare/Helius real-time relay
worker/src/configuration.js Validated public pool configuration
worker/src/market-fallback.js Helius market fallback normalization
worker/src/parser.js       Generic Solana balance-change parser
tests/market.test.js       Market semantics and parsing tests
tests/navigation.test.js   Deterministic movement and lifecycle tests
.github/workflows/ci.yml   Automated quality gate
vercel.json                Deployment and security headers
```

## Privacy and security

The application has no accounts, cookies, wallet connection or trading capability. Its optional Cloudflare relay only transforms public on-chain transactions into a browser stream and does not persist user data. The repository contains no private API keys. Wallet addresses visible in the public trade feed originate from public Solana transactions and are not persisted by this project.

The optional Helius credential is stored only as a Cloudflare Worker secret. `VITE_STREAM_URL` is a public relay URL and can safely be configured in Vercel.

## Free real-time relay deployment

1. Create free Helius and Cloudflare accounts.
2. Authenticate Wrangler with `npx wrangler login`.
3. Store the key securely: `npx wrangler secret put HELIUS_API_KEY --config worker/wrangler.jsonc`.
4. Deploy: `npm run worker:deploy`.
5. Configure the resulting `/stream` WebSocket URL as `VITE_STREAM_URL` or update the public fallback in `js/config.js`, then redeploy the frontend.

Never add the Helius key to `.env`, Vercel client variables or source control.

## Limitations and roadmap

- Without the relay, or while its streaming path is unavailable, public polling is near-real-time and the four-pool cap protects GeckoTerminal's rate limit.
- DexScreener outages reduce discovery to two known SOL pools and Helius metadata; the application marks that state as fallback coverage and does not invent an hourly change value.
- With the relay, the four highest-scoring pools discovered by DexScreener are subscribed over Helius standard WebSockets; unsupported or unusual transactions can still fall back to the polling source.
- Free-service quotas are suitable for a portfolio demo, not an SLA-backed trading product.
- Combat outcomes are illustrative and do not predict price movement.

## License

[MIT](LICENSE) © 2026 PowerPixelKK.
