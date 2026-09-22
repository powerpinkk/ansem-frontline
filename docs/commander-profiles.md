# Commander profiles and token identity

M12 separates a token-configured Commander from normal troops, MarketImpact actors, and the User Champion. Commander identity is presentation data. It is never market authority.

## Role model

| Role | Authority | Lifetime | Current runtime identity |
| --- | --- | --- | --- |
| Normal troop | A verified trade or bounded battlefield force | Trade/unit lifecycle | `normal-troop` |
| MarketImpact actor | A temporary presentation of a verified terrain impact | Impact request and recovery | `market-impact-actor` |
| User Champion | A per-mint, time-limited presentation entitlement | inactive/active/expired | `user-champion` |
| Commander | A published token-to-profile mapping | Active TokenContext | `commander` |

These roles may reuse a mesh family, rig adapter, locomotion code, or combat code. They never share runtime identity, lifecycle, market authority, or ownership semantics. Removing a Commander does not remove generic bull/bear forces or MarketImpact presentation. Activating a Champion does not create a Commander.

## Pre-refactor Black Bull audit

The audit was performed before changing the scene. Historical references were classified as follows.

| Classification | Existing responsibility | M12 owner |
| --- | --- | --- |
| Identity/presentation | Flying Black Bull mount/rider, materials, animation and recognizable silhouette | ANSEM Commander profile and renderer adapter |
| Generic battlefield mechanics | Buy-swarm reinforcement waves and supported bull highlighting | Generic bullish presentation; it works with no Commander |
| Combat logic | Ward/reclamation response near the persistent leader | Commander presentation policy; ordinary melee, charge, impulse and knockback remain M11.2 combat |
| MarketImpact actor logic | EXTREME/SHOCK charge selection from bull/bear entities | Existing MarketImpact presentation controller and temporary `market-impact-actor` role |
| User Champion logic | Separate black-bull/sentinel presentation rig | Existing Champion controller; unchanged and never promoted to Commander |
| Test/diagnostics | `bullKing`, defense hooks, retreat test and camera traces | Compatibility diagnostics plus explicit `commander` diagnostics |
| Theme/asset binding | `hero*` palette and hero visibility | Profile material policy `theme-hero`; themes style but cannot publish identity |

The old “Bull King retreats” test is Commander-specific. It verifies the `guard` directive when sellers control the market, not a generic MarketImpact retreat. M12 keeps that deterministic pressure fixture and treats the assertion as ANSEM Commander behavior. The generic SHOCK/EXTREME path remains covered independently by M11.2 impact tests.

## Pipeline

```text
TokenContext.identity.mint
        ↓
Bundled CommanderProfileRegistry
        ↓
CommanderProfile | null
        ↓
token-scoped CommanderController
        ↓
scene Commander presentation adapter
```

`js/commander-profile.js` is the only publication registry. Lookup is synchronous, exact, case-sensitive, and mint-only. Symbols, names, tickers, theme ids, imported Theme Studio documents, market data, and wallet state are not inputs.

ANSEM is currently the only mapping:

```text
9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump
→ ansem-black-bull@1
```

USDC, JUP, and every other valid but unconfigured mint resolve to `null`. There is no default, generic, placeholder, or inferred Commander.

## Profile schema

The renderer-independent profile contains:

- `id` and positive integer `version`, combined as the immutable identity `id@version`;
- exact `tokenMint`;
- bounded display name/title;
- approved `assetId`;
- approved semantic `rigType` and `animationSetId`;
- bounded positive `scale`;
- approved `materialPolicy` and `presentationBehavior`;
- approved `combatArchetype` reference, not combat implementation;
- a small validated capability list;
- bounded provenance metadata.

ANSEM uses `black-bull-v1`, `QUADRUPED_BULL_RIDER`, `bull-commander-v1`, `theme-hero`, `battlefield-leader-v1`, and `heavy-bull`. Version is configuration identity rather than a timestamp. A future revision can publish `ansem-black-bull@2` without changing the meaning of historical `@1` configuration.

Resolved profiles are copied into a normalized, frozen object. Runtime theme application changes materials but never mutates profile identity.

## Validation and safe assets

Validation fails closed for malformed ids, non-positive versions, invalid Solana mints, unknown assets, unsupported rig or animation ids, non-finite/out-of-range scale, unsupported presentation/material/combat values, and malformed or duplicate capabilities. Registry creation also rejects duplicate token mappings and duplicate versioned profile identities.

`COMMANDER_ASSET_CATALOG` is an allowlist. Its only M12 entry is the bundled procedural Black Bull. A profile cannot contain a URL, script, raw animation function, IPFS reference, remote GLB, or executable callback. The scene repeats the supported asset/rig/animation check at the rendering boundary before constructing anything.

The catalog describes resources, while the scene adapter owns mesh-node knowledge. Profile data never reaches into arbitrary node names. The bundled geometry/material resource can remain cached across navigation; actor id, token/profile references, position, locomotion target, defense state, effects, and presentation state are reset per instance.

## Lifecycle and token isolation

`CommanderController` owns a monotonic generation, a stable namespaced actor id, and `empty → loading → active` lifecycle. It resolves once per token/profile change; no registry scan, JSON parse, asset discovery, or network request occurs per frame.

An identical TokenContext observation is idempotent. Switching away destroys the active instance and publishes an empty snapshot. Switching back produces a fresh actor id and reset state. Async instantiation completion is accepted only when generation, mint, and profile still match; stale completion is disposed and counted diagnostically.

The main token session clears only a Commander owned by the mint being destroyed. Browser Back/Forward and rapid CA selection therefore follow the same TokenController generation boundary. A terrain source-epoch rebase does not change TokenContext and does not recreate the Commander.

Scene reset clears transient units, combat, effects, and Commander pose but does not invent identity. Application teardown destroys the controller. Active Commander count is constrained to zero or one.

## Rendering, theme, and animation

The scene lazily constructs the approved Black Bull rig only for an active ANSEM snapshot. On generic tokens the rig is detached, hidden, absent from Commander diagnostics, and performs no update work. There is no pedestal, label, or empty hero artifact.

The profile selects the semantic rig/animation/material adapters. The current asset preserves the existing flying Black Bull presentation; M12 does not introduce cel shading or new art. `theme-hero` consumes existing Theme Engine hero material slots. A theme may restyle or hide an existing Commander, but applying or importing a theme cannot create one.

Horizontal Commander travel uses the M11.1 motion state/integration/finalization contract. Flight altitude and the existing rig pose adapter remain presentation concerns. No second token-specific motion engine or unbounded position increment was introduced.

## Combat and MarketImpact boundaries

The profile references the approved `heavy-bull` combat archetype and capabilities; it contains no combat code. Existing M11.2 melee/charge/contact/impulse rules remain authoritative. The current flying Commander uses its established bounded leadership ward/reclamation presentation; generic troop attacks and MarketImpact charges use the existing M11.2 combat adapters.

M11.2 impact selection remains independent of the registry. When an impact request activates a troop charge, that entity temporarily reports `market-impact-actor` and returns to `normal-troop` after recovery/reset. SHOCK and EXTREME remain valid when `commanderPresent` is false. Generic bullish support waves originate at the bull front when no Commander exists rather than materializing a Black Bull.

Commander actions cannot write canonical valuation, authoritative MarketFrontier target, source epoch, canonical executions, buy/sell pressure, or ImpactScore. WAITING, DEGRADED, and STALE market state may leave ANSEM identity visible, but without a verified impact there is no fabricated charge.

The M11.2 `persistentBackward` diagnostic still includes some intentional external knockback. M12 does not change that semantic; a later correction should measure resolved locomotion separately from external combat impulse.

## Champion, Pixel/PiP, and accessibility

The M8 User Champion controller, one-per-mint activation policy, expiration, and presentation-only guarantee are unchanged. Its rig and actor id are distinct from Commander state. No wallet is consulted.

Pixel/PiP keeps its existing token/theme/champion state and does not run a second Commander simulation. Financial/token state remains available through text and market UI; Commander recognition is never required to read it.

## Diagnostics

Development/diagnostic builds expose bounded fields for presence, lifecycle, actor id, profile id/version/key, token mint, asset, rig, animation set, combat archetype, capabilities, scene-object count, spawn/destroy counts, and stale completions. The legacy `bullKing` pose remains for M4-M11 visual fixtures and is `null` when no Commander scene object exists.

## Future publication architecture

M12 is source-controlled and local. It adds no Worker, database, wallet, admin UI, upload surface, dynamic asset loader, or network registry.

A later product can preserve the provider boundary:

```text
Authenticated Admin
→ Profile Draft
→ deterministic validation
→ approved asset processing
→ versioned profile
→ signed/published registry
→ public provider
```

That flow needs authentication, authorization, provenance, content processing, signing, rollback, moderation, and cache/version policy. A schema-only example such as `triplet-commander@1` can prove generality in future tests, but it must not be published until a real mint and approved asset exist. Branded troops, custom themes, billing, onboarding, and the comic/cel-shaded redesign remain separate future work.
