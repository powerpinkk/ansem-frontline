# $ANSEM FRONTLINE

Real-time 3D battle visualization for the $ANSEM token on Solana. Live price data from DexScreener, on-chain DEX swaps from GeckoTerminal, rendered as bull vs bear combat.

## Features

- **Live price & MCAP** — DexScreener API (4s polling with exponential backoff)
- **On-chain swaps** — GeckoTerminal real trades (no simulated feed)
- **Whale detection** — Swaps ≥ $3,000 spawn giant units in the 3D scene
- **Connection status** — CONNECTING / LIVE / DEGRADED / OFFLINE indicators
- **3D auto-battler** — Three.js trench battlefield with projectiles, particles, and sound

## Project structure

```
index.html          Entry point
css/styles.css      UI styles
js/config.js        Token mint, API URLs, thresholds
js/state.js         Shared application state
js/api.js           Data fetching & retry logic
js/ui.js            DOM updates, feeds, mini-chart
js/scene.js         Three.js game engine
js/main.js          Module wiring
```

## Run locally

ES modules require a local server (not `file://`):

```bash
python -m http.server 8080
# Open http://localhost:8080
```

## GitHub Pages

Enable Pages in repo Settings → Source: `main` branch, root folder.

Live at: **https://powerpinkk.github.io/ansem-frontline/**

## Configuration

Edit `js/config.js`:

| Key | Description |
|-----|-------------|
| `TOKEN_MINT` | Solana token address |
| `WHALE_TRADE_THRESHOLD` | USD minimum for whale spawn (default 3000) |
| `BIRDEYE_API_KEY` | Optional — enables HOLDERS counter |

## Credits

Built by [PowerPixelKK](https://x.com/PowerPixelKK)
