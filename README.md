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

DexScreener is used to discover active Solana pools and calculate a liquidity-weighted token price. The application ranks supported SOL and stablecoin pools using recent volume and liquidity, then polls the four most active pools in rotation. GeckoTerminal supplies the verified swap records and OHLCV candles.

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
GeckoTerminal ── verified swaps and OHLCV
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
tests/market.test.js       Market semantics and parsing tests
.github/workflows/ci.yml   Automated quality gate
vercel.json                Deployment and security headers
```

## Privacy and security

The application has no backend, accounts, cookies, wallet connection or trading capability. It does not contain private API keys. Wallet addresses visible in the public trade feed originate from public Solana transactions and are not persisted by this project.

## Limitations and roadmap

- Public polling is near-real-time rather than websocket-level real-time.
- The four-pool cap protects GeckoTerminal's public rate limit; market coverage is disclosed in the UI.
- A production-grade all-pool stream would require a dedicated indexed Solana data provider and a server-side credential proxy.
- Combat outcomes are illustrative and do not predict price movement.

## License

[MIT](LICENSE) © 2026 PowerPixelKK.
