# Theme Engine architecture

M6 separates token identity and live data from presentation without changing battlefield semantics:

```text
TokenContext
  → ThemeResolver
    → ThemeRegistry
      → immutable ThemeDefinition
        → scene / UI / Pixel + companion adapters
```

## Boundaries

`TokenContext` remains the canonical token identity/data envelope. It contains the mint, bounded metadata, supply, pools and discovery provenance. It never contains a theme ID, colors, copy or assets. The per-token runtime continues to own market state, requests, timers, caches and streams. Neither `api.js` nor the Cloudflare Worker imports theme code.

`ThemeResolver` is the only token-to-theme assignment boundary. It uses the canonical validated mint. The ANSEM mint maps to `ansem`; every unassigned compatible mint maps to `generic`. Token symbol, name, logo and metadata URI are ignored for theme resolution.

`ThemeDefinition` contains only presentation values currently consumed by the product: versioned identity, scene environment/lights/material colors, UI colors/copy, Pixel palette, companion background and an explicit local asset manifest. Definitions are normalized, validated and deeply frozen before registration.

`ThemeRegistry` rejects malformed definitions and duplicate IDs. It never evaluates code, imports a module selected by a token or accepts remote configuration. Its registered `generic` definition is the safe fallback for an unknown theme, malformed definition, adapter failure or unavailable declared asset.

## Application lifecycle

The presentation controller resolves and applies a theme only at startup, a committed token switch or an explicit internal theme-only switch. It passes bounded views to three adapters:

- The scene adapter supplies environment, lighting, material and special-entity presentation to `scene.js`.
- The UI adapter replaces a controlled set of CSS custom properties, product copy and stable DOM labels.
- The companion adapter updates the existing Pixel engines and publishes only the trusted theme ID alongside the token-scoped snapshot.

The scene mutates shared materials and lights in place. A theme change creates no geometries, textures, materials, render targets, sockets, requests, timers or BroadcastChannels. Existing entity auras, transient effects and special-entity materials are updated synchronously before the next frame. Switching back to ANSEM restores the exact preset values.

A theme-only change does not recreate `TokenContext`, rediscover pools, remount the API runtime or change the `?token=<mint>` URL. M7's Theme Studio consumes this internal path with validated immutable draft revisions; no public `?theme=` route exists.

## Assets and fallback

Theme assets must use bounded repository-relative paths without schemes, traversal, query strings or fragments. The registry declares them explicitly; token logos remain untrusted Token Data metadata and never become battlefield assets. M6 themes are procedural and declare no external assets, so normal switching performs no asset fetch. The asset resolver is manifest-based and returns a registered fallback or `null` when a declared local asset is absent, keeping the battlefield operational.

## Adding an internal theme

1. Create a complete `ThemeDefinition` in `theme-presets.js` using only values supported by the schema.
2. Register it once in `THEME_REGISTRY`.
3. If it belongs to a specific project, add a canonical mint assignment to `THEME_RESOLVER`.
4. Add deterministic registry, resolver, UI, Pixel, scene-resource and switching tests.
5. Validate responsive surfaces, companion synchronization, WebGL resource counts and the production soak.

Adding a theme must not require changes to market parsing, Worker code, pool discovery, cache keys, combat rules or token lifecycle.

## Scope

M6 remains the infrastructure plus the official ANSEM and neutral Generic Frontline presets. M7 adds only the local authoring layer described in [Theme Studio architecture](theme-studio.md); uploads, a marketplace, monetization, cloud persistence, AI generation, wallet functionality and trading remain out of scope.
