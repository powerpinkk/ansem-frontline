# Market Terrain and Battle Reality — M10.2

## Status and scope

M10.2 maps the M10.1 canonical protocol market-cap observation onto a continuous, bounded battlefield coordinate. It adds a spatial MarketFrontier, readable valuation and status labels, verified-execution impact scoring, and token-scoped presentation state. It does not change Worker behavior, provider authority, wallet boundaries, combat locomotion, commander rules, or the art pipeline.

The terrain accepts only `authorityEligible: true`, `freshness: FRESH`, `kind: PROTOCOL_MARKET_CAP` canonical valuations whose `tokenMint` matches the active controller. DEX/provider observations remain display-only and cannot move the terrain. Canonical executions must pass the existing `activeTrade` M10.1 verifier before they can contribute to impact.

## Architecture

The implementation has three layers:

1. `js/market-terrain.js` is a renderer-independent domain module. It owns scale conversion, band lookup, traversal descriptions, authoritative and presentation coordinates, bounded evidence aggregation, degradation, rebase, and diagnostics.
2. Each token runtime in `js/main.js` owns one terrain controller. Token destruction discards its traversal and impact state; the reusable renderer pools remain global.
3. `js/scene.js` projects the current bounded window onto the existing battlefield. It mutates preallocated Three.js instances and ten pooled DOM labels at no more than 20 Hz. It never creates geometry, textures, or labels on a market tick.

`state.marketTerrain` exposes the lightweight token-scoped snapshot to existing presentation consumers. Pixel/PiP does not duplicate the 3D terrain and remains unchanged.

## Band policy and boundary semantics

Major bands are lower-inclusive. An exact policy boundary belongs to the new regime and starts its first band.

| Valuation range | Major interval | Minor interval | Subdivisions |
| --- | ---: | ---: | ---: |
| $0–$10K | $1K | $200 | 5 |
| $10K–$100K | $10K | $2K | 5 |
| $100K–$1M | $50K | $10K | 5 |
| $1M–$100M | $500K | $100K | 5 |
| $100M–$1B | $1M | $200K | 5 |
| $1B–$100B | $500M | $100M | 5 |
| $100B and above | $5B | $1B | 5 |

Five subdivisions mean four visible minor marks inside every major interval. Formatting is centralized and compact (`$999`, `$1K`, `$1.2M`, `$1.5B`, `$105B`) without misleading `1000K`/`1000M` output.

## Cumulative piecewise transform

The scale is piecewise linear but cumulative and continuous. For a valuation `v` in regime `r`:

```text
coordinate(v) = base[r] + (v - minimum[r]) / majorInterval[r]
```

The regime bases are `0, 10, 19, 37, 235, 1135, 1333`. They are the exact sums of all complete bands in prior regimes, so neither the coordinate nor the visible terrain jumps at $10K, $100K, $1M, $100M, $1B, or $100B. For example, $1.2M maps 40% through the $1M–$1.5M band.

Decimal strings are parsed into BigInt numerator/denominator form. Regime selection, completed-band calculation, and fractional progress happen before conversion to the floating coordinate Three.js needs. This avoids raw financial arithmetic in imprecise floats while retaining a bounded render coordinate.

## Floating origin and bounded window

The presentation coordinate is the local floating origin. World X is derived as:

```text
localX = (boundaryCoordinate - presentationCoordinate) * 10 world units
```

The renderer never materializes the path from zero or every crossed band. It only displays the current local window:

| Viewport | Behind/ahead | Major capacity | Minor capacity | Label capacity |
| --- | --- | ---: | ---: | ---: |
| Desktop (≥1100 px) | 4 / 4 | 10 | 36 | 10 |
| Tablet (≥700 px) | 3 / 3 | 8 | 28 | 8 |
| Mobile | 2 / 2 | 6 | 20 | 3 |

The one-band look-ahead boundary closes the final visible interval. The window slides continuously around a fractional presentation coordinate, so marks move rather than popping only at integer boundaries. Large 10x/50x changes use the same fixed pools and final window.

## MarketFrontier and presentation motion

The canonical valuation immediately replaces the authoritative target and label. Presentation motion is deliberately separate: it approaches the latest target using elapsed-time interpolation, a maximum speed of 18 bands/second, and a three-second maximum visual-debt report. Financial state therefore never depends on frame count.

Rapid reversal retargets from the current visual coordinate and increments a superseded-traversal diagnostic. It does not finish a stale animation first. A tab resume after four seconds snaps to the newest target instead of replaying missed market motion. Camera coordinates do not jump with absolute valuation because the floating origin keeps the active window around the battlefield.

The first valid observation establishes both target and presentation at once. Repeated identical canonical observations are idempotent. Historical executions can establish context but are not passed into live impact presentation. There is no zero-to-market pump animation on initialization.

## Traversal representation

An ordinary `BandTraversal` records start/target valuations and coordinates, direction, movement cause, source epoch, total crossing count, and explicitly crossed major boundaries. The mandatory $100K→$600K traversal is exactly:

```text
$150K, $200K, $250K, $300K, $350K,
$400K, $450K, $500K, $550K, $600K
```

The reverse list is emitted once in descending order. Explicit boundary storage is capped at 64; extreme moves retain total count, first crossing, target/last summary, and `truncated: true`. `syntheticExecutions` is permanently empty.

## Epochs, causes, and degraded authority

A greater `sourceEpoch` is a rebase. The controller atomically places presentation and target at the new coordinate, clears executions and impact, and records a rebase descriptor. An older epoch is ignored. A rebase is never a pump, dump, traversal, or shock.

M10.1 movement causes map to readable terrain causes:

- token price → `TOKEN_NATIVE_MARKET_MOVE`;
- combined token/quote change → `TOKEN_NATIVE_AND_QUOTE_FX_MOVE`;
- quote FX → `QUOTE_USD_FX_MOVE`;
- supply change, provider correction, source rebase, and reconciliation retain distinct non-trade semantics.

FX, supply-basis, correction, and reconciliation observations may move the USD-valued frontier when authoritative, but cannot manufacture buy/sell impact. If authority is missing, stale, or degraded, the last target is retained, impact is cleared, the UI shows a dashed degraded state, and no velocity extrapolation occurs. Recovery uses the newest accepted canonical state.

## MarketImpact

Valuation movement and verified trade impact are separate concepts. Impact exists only when at least one active M10.1 canonical pool execution is present and the movement cause includes token-native movement.

The bounded score normalizes available evidence components:

- verified execution count;
- temporal concentration within the 2.5-second window;
- verified buy/sell imbalance;
- actual quote magnitude when present;
- explicit/verified liquidity ratio when present;
- canonical valuation percentage delta when present.

Unavailable inputs remain explicitly unavailable and their weights are removed rather than replaced with invented values. Category thresholds are `NORMAL < .35`, `STRONG ≥ .35`, `EXTREME ≥ .60`, and `SHOCK ≥ .82`. Direction comes from verified executions, never merely from valuation direction or color.

At most 64 active executions are retained and at most 16 IDs are exposed as evidence. Presentation coalesces them as `CLUSTERED_BUY_WAVE`, `CLUSTERED_SELL_WAVE`, or `RAPID_EXECUTION_CLUSTER`. It deliberately makes no bundle identity claim. Settlement reconciliation removes or replaces the same evidence identity instead of inventing an opposite trade.

## Battlefield, themes, and accessibility

The MarketFrontier is a terrain-width marker with a separate presentation-origin marker. Instanced major/minor lines make the scale spatially visible without changing combat state or `frontlineX`. A compact label near the battlefield states typed valuation, direction arrow, movement cause, and degraded status. Existing troop locomotion, facing, gait, charge, and knockback remain M11 work.

Terrain materials reuse the active theme's environment and buy/sell accents. ANSEM, generic tokens, and Theme Studio therefore change presentation without changing financial semantics. Bullish/bearish meaning is also carried by arrow direction, relative marker position, and text; color is not the only signal. Mobile reduces marks and labels, maintains readable foreground contrast, and keeps the overlay pointer-transparent.

## Performance and lifecycle invariants

The renderer allocates once:

- two `InstancedMesh` pools (10 major and 36 minor instances);
- two marker meshes;
- four geometries and four materials;
- ten reusable DOM labels.

The domain caps traversal boundaries at 64, impact executions at 64, and exposed impact evidence at 16. The renderer update cadence is 50 ms, and all target motion uses elapsed time. The controller creates no timer, listener, network request, texture, or Three.js object.

Measured against commit `35b59bc31673d68121d81e20eaf862a3744a1705`, the idle baseline reported 32 geometries, 3 textures, and 74 draw calls. The deterministic live M10.2 fixture reported 36 geometries, 3 textures, and 89 total scene draw calls; the exact geometry delta is the four preallocated terrain geometries, the texture delta is zero, and the terrain group itself contributes at most four visible draw calls. A repeated-market-update E2E assertion confirms geometry and texture counts do not grow.

The dedicated 60-second domain soak covers rapid updates, small oscillations, regime crossings, $100K→$600K, reversal, 10x/50x moves, FX, source rebase, stale/recovery, verified impact, responsive windows, and four-token switching. It asserts all budgets every batch and compares first-half with second-half processing time to detect progressive slowdown.

## Development diagnostics

Development mode or `?diagnostics=1` exposes `window.__ansemTerrainDiagnostics()` and the terrain section of `window.__ansemSceneDiagnostics()`. They report authoritative valuation and kind, logical/presentation/target coordinates, lower/upper band and progress, source epoch, movement cause, visual debt, traversal, rebase, impact category/score/evidence counts, and visible/rendered object counts. Diagnostics contain no secret or personal data and are absent from normal production mode.

## Invariants

- Provider fallback, cached display data, unsupported Mayhem state, and non-canonical valuation kinds never move terrain.
- No market tick creates geometry, texture, DOM labels, synthetic trades, or unbounded arrays.
- Authoritative target changes immediately; animation cannot rewrite financial truth.
- Source rebase and quote FX never masquerade as trade shock.
- Token, source epoch, execution identity, and settlement reconciliation remain isolated.
- User Champion cannot move the frontier, change valuation/impact, or create pressure.
- Pixel/PiP, wallet-deferred behavior, commander semantics, combat logic, and rendering style remain outside this milestone.
