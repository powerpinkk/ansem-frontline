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

## GitHub Pages (one-time setup)

1. Open **Settings → Pages**:  
   https://github.com/powerpinkk/ansem-frontline/settings/pages

2. Under **Build and deployment → Source**, choose **Deploy from a branch**.

3. Set **Branch** to `main` and folder to **`/ (root)`**, then click **Save**.

4. Wait 1–2 minutes. Your site will be live at:  
   **https://powerpinkk.github.io/ansem-frontline/**

> Do **not** use "GitHub Actions" as the source — this project is static HTML and deploys directly from the branch.

## Configuration

Edit `js/config.js`:

| Key | Description |
|-----|-------------|
| `TOKEN_MINT` | Solana token address |
| `WHALE_TRADE_THRESHOLD` | USD minimum for whale spawn (default 3000) |
| `BIRDEYE_API_KEY` | Optional — enables HOLDERS counter |

## Credits

Built by [PowerPixelKK](https://x.com/PowerPixelKK)
