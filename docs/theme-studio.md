# Theme Studio architecture

M7 turns the M6 Theme Engine into a bounded visual-authoring product. It does not add a second rendering path:

```text
built-in ThemeDefinition
  → isolated ThemeDraft
    → incremental ThemeDefinition validation
      → authoring allowlist validation
        → debounced theme-only preview
          → M6 scene / UI / Pixel + companion adapters

ThemeDraft ── save locally / deterministic JSON export
                  ↑ revalidate every read / import
```

The active token theme and draft are intentionally distinct. `ThemeResolver` still chooses the stable active theme from the canonical mint. Theme Studio clones a built-in definition, edits the clone, and only sends a fully validated immutable `ThemeDefinition` to `theme-presentation.js`. `TokenContext`, runtime state, discovery, requests, WebSockets, Worker routing and URL navigation remain outside the Studio.

## Authoring surface

The UI is a curated view over fields that M6 already consumes. Every visible control has a direct adapter or scene effect.

| Category | Publicly editable | Deliberately locked |
| --- | --- | --- |
| Identity | ID and display name | schema version |
| Environment | background, fog, fog distances, terrain/territory tint, existing light colours and intensities | geometry, camera, terrain generation and renderer settings |
| Factions | commander visibility and selected core buy/sell/commander material colours | anatomy, animation, combat behavior and advanced material channels |
| Effects | existing particles, dust, projectiles, sell highlight and commander beam colours | pools, lifetimes, geometry, shaders and effect scheduling |
| Interface | controlled brand text, selected tactical labels and safe colour tokens | translucent surface/border internals, arbitrary CSS and HTML |
| Pixel Frontline | selected battlefield, trace, faction, text and companion background colours | sprite logic, layout, collision lanes and timing |
| Assets | none | the entire asset manifest; M7 accepts no uploads, remote URLs or arbitrary paths |

Locked values remain copied from the selected ANSEM or Generic base preset. Import rejects a payload that changes one of them; it does not silently accept hidden edits.

## Draft lifecycle

- **Create:** clone the mint-resolved ANSEM or Generic preset. The immutable registry definition is never mutated.
- **Edit:** keep raw draft input separate and run the complete `createThemeDefinition` boundary after every change. An invalid draft exposes an inline error and cannot preview, save or export.
- **Preview:** coalesce changes for 90 ms, then apply the validated definition through the M6 presentation controller. Scene lights/materials, CSS tokens and Pixel/companion palettes update in place.
- **Revert preview:** re-resolve the active token and reapply its built-in theme without discarding the draft.
- **Reset section/theme:** copy values from the selected base definition. Full reset therefore has exact preset parity and contains no duplicated UI defaults.
- **Save:** persist the valid draft locally. Save/autosave never changes the active-theme contract and never publishes anything.
- **Close:** autosave a valid dirty draft, revert any preview and restore focus to the opener.

Undo and redo belong to the draft, not browser History. History is capped at 60 snapshots. Changes on the same control within 350 ms share one pre-edit snapshot, so sliders and colour pickers cannot generate unbounded history. Undo, redo, section reset and full reset are themselves validated and previewed through the same path.

## Local persistence

Small declarative definitions make `localStorage` more appropriate than IndexedDB. Storage uses one namespaced versioned envelope, a 128 KB total read/write limit and at most eight most-recent drafts. Each scope is `<canonical mint>:<base theme ID>`.

Changing USDC to JUP while editing performs a valid local save for the USDC scope, reapplies the resolver-selected JUP theme, and loads only the JUP+Generic scope. Returning to USDC recovers the USDC draft. Drafts never enter `?token=` or any other URL field.

All local data is untrusted on the next load. A malformed JSON envelope, unsupported schema, oversized record, invalid timestamp/scope or invalid nested export is discarded. No persisted definition reaches the model until it passes the same import and ThemeDefinition validation as a file.

## Import and export

The portable UTF-8 JSON envelope is deterministic for an unchanged definition:

```json
{
  "format": "ansem-frontline-theme",
  "schemaVersion": 1,
  "baseThemeId": "generic",
  "definition": {}
}
```

`definition` is a complete declarative ThemeDefinition; the abbreviated object above only illustrates the envelope. Export contains no code, functions, runtime state, token identity, sockets, cache data, HTML, remote CSS or secrets.

Import is capped at 64 KB before parse. It then verifies the exact envelope, known schema/base preset, plain bounded object tree, forbidden prototype keys, exact ThemeDefinition fields, strings, finite bounded numbers, canonical colours, locked-field parity and an empty asset manifest. Unknown fields are rejected. Preview occurs only after the full chain succeeds.

## Trust and security boundaries

Trusted inputs are built-in frozen presets, the internal registry and registered local assets. Imported files, persisted data, text/number/colour controls and token metadata are untrusted.

ThemeDefinition rejects arrays, non-plain objects, excessive depth/node count, unknown fields and the keys `__proto__`, `constructor` and `prototype`. CSS colour input is restricted to validated hex/RGB(A), with RGB channels bounded to 255; Studio-exposed colours use canonical six-digit hex. Text is length bounded and the UI adapter uses `textContent`. Numbers must be finite and stay within schema bounds. Asset declarations are rejected at the Studio boundary even when a local-looking path is supplied.

## Runtime and resource boundaries

Studio closed has no timers, frame callback or observer. Open Studio reacts only to input and does not perform per-frame work. Preview and autosave are separately debounced (90 ms and 700 ms). Theme-only application does not recreate the scene, geometry, textures, materials, render targets, Pixel engines, BroadcastChannels, sockets, runtimes or Workers.

Diagnostics and regression tests compare mint, controller generation, runtime namespace/session identity, request/socket state, Three.js geometry/texture counts and Pixel theme-application counts across editing, preview, undo/redo, reset, preset alternation and 100+ coalesced changes.

## Responsive and accessibility behavior

Desktop uses a centered overlay with persistent categories. Tablet narrows the rail and stacks file actions without hiding the battlefield permanently. Mobile becomes a full-screen sheet with horizontally scrollable category/action strips and places preview actions first.

The dialog is labelled and modal, restores focus on close, traps Tab focus, supports Escape, gives every input a programmatic label, exposes invalid state and linked error text, keeps visible focus styles, and supports Ctrl/Cmd+Z plus Redo without hijacking browser Back/Forward.

## Scope

M7 is local authoring only. There are no accounts, backend, cloud sync, theme marketplace, monetization, asset upload, ZIP bundle, remote code/CSS, wallet, swap/trading action, AI generation or public theme route.
