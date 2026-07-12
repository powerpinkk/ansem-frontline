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

## Live URLs

| Platform | URL | Status |
|----------|-----|--------|
| **Vercel** | https://ansem-frontline.vercel.app | ✅ Working now |
| **GitHub Pages** | https://powerpinkk.github.io/ansem-frontline/ | Requires setup below |

## GitHub Pages setup (if you want the .github.io URL)

GitHub Pages is **not active yet** — waiting won't fix a 404. You must enable it once:

1. Log in as **powerpinkk** on GitHub
2. Open: https://github.com/powerpinkk/ansem-frontline/settings/pages
3. **Build and deployment → Source:** Deploy from a branch
4. **Branch:** try `gh-pages` first (already created), folder **`/ (root)`**
5. Click **Save** — you must see a green banner: *"Your site is live at..."*
6. If `gh-pages` doesn't work, switch branch to `main` and Save again

If nothing happens when you click Save, set Source to **None**, Save, then repeat steps 3–5.

## Configuration

Edit `js/config.js`:

| Key | Description |
|-----|-------------|
| `TOKEN_MINT` | Solana token address |
| `WHALE_TRADE_THRESHOLD` | USD minimum for whale spawn (default 3000) |
| `BIRDEYE_API_KEY` | Optional — enables HOLDERS counter |

## Credits

Built by [PowerPixelKK](https://x.com/PowerPixelKK)
