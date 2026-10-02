# Market Terrain and Battle Reality — M10.2

## Status and scope

M10.2 maps the M10.1 canonical protocol market-cap observation onto a continuous, bounded battlefield coordinate. It adds a spatial MarketFrontier, readable valuation and status labels, verified-execution impact scoring, and token-scoped presentation state. It does not change Worker behavior, provider authority, wallet boundaries, combat locomotion, commander rules, or the art pipeline.

The terrain accepts only `authorityEligible: true`, `freshness: FRESH`, `kind: PROTOCOL_MARKET_CAP` canonical valuations whose `tokenMint` matches the active controller. DEX/provider observations remain display-only and cannot move the terrain. Canonical executions must pass the existing `activeTrade` M10.1 verifier before they can contribute to impact.

## Architecture

The implementation has three layers:

1. `js/market-terrain.js` is a renderer-independent domain module. It owns scale conversion, band lookup, traversal descriptions, authoritative and presentation coordinates, bounded evidence aggregation, degradation, rebase, and diagnostics.
2. Each token runtime in `js/main.js` owns one terrain controller. Token destruction discards its traversal and impact state; the reusable renderer pools remain global.
3. `js/scene.js` projects the current bounded window onto the existing battlefield. It rewrites four preallocated terrain-conforming ribbon buffers and ten pooled DOM labels at no more than 20 Hz. It never creates geometry, textures, or labels on a market tick.

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

## Scale, display anchor, and frontier

Three coordinates are intentionally separate:

- **MarketScale** is the absolute, product-defined financial transform above. It never depends on a provider fallback or camera state.
- **DisplayWindowAnchor** chooses which bounded part of that scale is visible. A live/frozen authoritative presentation uses its presentation coordinate; a typed provider-indicative valuation may center the window only; cold waiting has no numeric anchor.
- **AuthoritativeFrontier** exists only after an accepted M10.1 canonical valuation. It is never created from a display anchor.

An indicative anchor therefore cannot write canonical valuation, become `authorityEligible`, set the authoritative target, create traversal/impact, contribute pressure, or emit combat. It changes presentation only.

## Terrain presentation states

| State | Numeric bands | Authoritative frontier | Motion | Meaning |
| --- | --- | --- | --- | --- |
| `LIVE` | Yes | Yes | Normal bounded retargeting | Fresh eligible canonical MC |
| `FROZEN` | Retained | Held at the frozen presentation coordinate | Stopped | Authority became stale/degraded; last accepted MC is labelled stale |
| `INDICATIVE` | Yes, labelled as reference | No | None | Typed `PROVIDER_INDICATIVE` MC/FDV centers the window only |
| `UNANCHORED_WAITING` | No numeric claims; structure remains | No | None | No safe valuation reference has ever been observed |

Cold waiting and degraded data never pause the 3D loop. The renderer-interruption overlay remains reserved for WebGL context loss or fatal scene initialization. Pixel/PiP can still pause the main loop intentionally while its companion is active and restores the same terrain controller on return.

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

FX, supply-basis, correction, and reconciliation observations may move the USD-valued frontier when authoritative, but cannot manufacture buy/sell impact. If established authority becomes missing, stale, or degraded, the presentation coordinate and visible window stop immediately. The target collapses to that frozen presentation coordinate, the last accepted valuation remains explicitly labelled stale, and traversal, impact and execution evidence are cleared. Recovery places presentation and target at the newest accepted canonical state as reconciliation, without replaying the missing interval. An older epoch cannot thaw frozen terrain, and an indicative reference cannot relocate its window. Identical live refreshes do not reset the presentation clock.

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

## Battlefield rendering, themes, and accessibility

The visual hierarchy is ground → minor subdivisions → major valuation boundaries → numeric labels → authoritative frontier. Major and minor marks are shallow triangle ribbons sampled in 28 depth segments so every strip follows the procedural battlefield height instead of intersecting one flat `z=0` plane. A 0.045–0.085 world-unit ground offset, depth testing, disabled depth writes, polygon offset, and deterministic render order prevent z-fighting without making the marks float. The frontier is wider and stronger than a major boundary; the presentation-origin marker is separate.

The major, minor, frontier, and presentation ribbons are four pooled meshes. Major width/opacity is `0.34/0.68` in LIVE, minor width/opacity is `0.105/0.24`, and waiting/indicative/frozen modes reduce opacity without removing structure. Ten pooled DOM labels are projected from major boundaries, clipped to the viewport, compactly formatted, and reduced to three candidates on mobile. A compact status plate states typed valuation, movement cause, frozen state, indicative reference, or unanchored waiting.

Theme tint is blended toward semantic contrast floors for major/minor marks, so Theme Studio cannot make core segmentation identical to the ground or fully transparent. Frontier color still follows the theme's buy/sell accent with a small white floor. ANSEM and generic themes therefore remain stylistically distinct without changing geometry or financial semantics. Direction, position, line weight, spacing, labels, and text carry meaning in addition to color. Existing troop locomotion, facing, gait, charge, and knockback are unchanged.

## Performance and lifecycle invariants

The renderer allocates once:

- two bounded dynamic ribbon buffers (10 major and 36 minor strips);
- two one-strip marker buffers;
- four meshes, four geometries, and four materials;
- ten reusable DOM labels.

At maximum desktop density the terrain contains 2,688 small triangles (1,680 major vertices, 6,048 minor vertices, plus the two 168-vertex markers) and still contributes at most four draw calls. The previous flat-box presentation used 576 terrain triangles; the visibility fix trades 2,112 additional simple triangles for ground conformance while preserving the same geometry/object/draw-call bounds and zero textures. Ribbon updates write existing typed arrays without per-segment allocations.

The domain caps traversal boundaries at 64, impact executions at 64, and exposed impact evidence at 16. The renderer update cadence is 50 ms, and all target motion uses elapsed time. The controller creates no timer, listener, network request, texture, or Three.js object.

Measured against commit `35b59bc31673d68121d81e20eaf862a3744a1705`, the idle baseline reported 32 geometries, 3 textures, and 74 draw calls. The deterministic live M10.2 fixture reported 36 geometries, 3 textures, and 89 total scene draw calls; the exact geometry delta is the four preallocated terrain geometries, the texture delta is zero, and the terrain group itself contributes at most four visible draw calls. A repeated-market-update E2E assertion confirms geometry and texture counts do not grow.

The dedicated 60-second domain soak covers rapid updates, small oscillations, regime crossings, $100K→$600K, reversal, 10x/50x moves, FX, source rebase, stale/recovery, verified impact, responsive windows, and four-token switching. It asserts all budgets every batch and compares first-half with second-half processing time to detect progressive slowdown.

## Development diagnostics

Development mode or `?diagnostics=1` exposes `window.__ansemTerrainDiagnostics()` and the terrain section of `window.__ansemSceneDiagnostics()`. They report presentation state, authoritative valuation and kind, indicative reference, display-anchor source, logical/presentation/target coordinates, lower/upper band and progress, source epoch, movement cause, visual debt, traversal, rebase, impact category/score/evidence counts, renderer activity, group/frontier visibility, ribbon bounds/vertices, material depth policy, and visible/rendered object counts. These terrain reports are read-only and contain no secret or personal data; other existing scene diagnostic controls are outside this change.

The separate `window.__ansemTerrainFixture` mutation helper is compiled only in `e2e` mode and is absent from production bundles.

Visual acceptance uses the real production renderer with deterministic routed M10.1 fixtures. Desktop captures cover $600K LIVE, $1.2M LIVE, frozen $600K, an indicative reference, unanchored cold waiting, and a generic token; mobile covers $600K LIVE. Assertions verify label counts/bounds, renderer activity, frontier presence/absence, responsive object budgets, and the exact local terrain coordinate `0.4` between $1M and $1.5M before camera projection. Degradation tests await the normal application refresh response instead of racing the acquisition poll. Screenshots and accompanying terrain/resource diagnostics are saved locally, inspected as framebuffer evidence, and not committed or used as brittle pixel-perfect snapshots.

## Invariants

- Provider fallback may center only the display window when it remains explicitly typed `PROVIDER_INDICATIVE`; cached/indicative data, unsupported Mayhem state, and non-canonical valuation kinds never create or move an authoritative frontier.
- `INDICATIVE` and `UNANCHORED_WAITING` cannot create traversal, execution evidence, pressure, MarketImpact, combat, or an authoritative frontier.
- No market tick creates geometry, texture, DOM labels, synthetic trades, or unbounded arrays.
- Authoritative target changes immediately; animation cannot rewrite financial truth.
- Source rebase and quote FX never masquerade as trade shock.
- Token, source epoch, execution identity, and settlement reconciliation remain isolated.
- User Champion cannot move the frontier, change valuation/impact, or create pressure.
- Pixel/PiP, wallet-deferred behavior, commander semantics, combat logic, and rendering style remain outside this milestone.
