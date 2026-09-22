# Battlefield combat and physical impact (M11.2)

M11.2 makes melee attacks and large market-impact offensives physically readable without giving combat any authority over market state. The causal boundary is strict:

`verified market data → canonical market state → Market Terrain / MarketImpact → combat intent → presentation`

Damage, animation, displacement, charge completion and casualties cannot write valuation, pressure, execution counts, `sourceEpoch`, ImpactScore or the MarketFrontier target. Worker, wallet, User Champion and Commander identity are outside this milestone.

## Pre-refactor audit and root causes

Verified-swap units are procedural Three.js groups; aggregate forces are instanced ranks. Target selection, range checks and damage lived in `updateEntities`. Normal combat held units at range but drove attack cadence with `Math.sin(animTime)` and applied damage from a cooldown branch. The bear had stable body, head and four limb pivots, but no semantic combat adapter. Hit reactions wrote ad hoc `vx/vz`, so attack code and locomotion both influenced movement. The giant bull charge used wall-clock phases, directly moved and rotated its mesh, derived permission from one whale plus rolling pressure, and maintained separate entity/rank hit sets.

That ownership caused four classes of defect: a visible strike was not coupled to a bounded contact window; overlap could stand in for impact; arbitrary velocity writes bypassed M11.1 resolution; and the bullish-only charge could continue after market meaning changed. Time-wave posing also made anticipation, impact and recovery visually ambiguous.

M11.2 centralizes domain policy in `js/combat.js`, leaves scene adapters in `js/scene.js`, and extends `js/locomotion.js` with one bounded external-velocity input. Final displacement and facing still belong to M11.1.

## Deterministic melee state

Every detailed unit and aggregate rank owns a fresh `CombatState`:

`APPROACH → ATTACK_WINDUP → ATTACK_ACTIVE → IMPACT → RECOVERY → APPROACH`

`CANCELLED` provides bounded reconciliation when the target or lifecycle disappears. Legal transitions are explicit. Elapsed simulation time, not rendered frames, advances each state. Archetype policy centralizes windup, active phase, active hit-window fraction, impact hold and recovery. Large deltas are capped at 250 ms and may traverse multiple completed states without skipping their logical consequences.

An attack starts only when world-space center distance is at or below the actor/target combat spacing. It remains committed until the target exceeds `enter range + 0.9`, creating deterministic hysteresis. Target identity is captured at windup. A retired, replaced or differently identified target cancels the sequence; a target leaving range produces a miss and recovery. A hit is an edge event emitted once per sequence only when the target remains within contact range during the active window.

## Bear rig and pose composition

The bear hierarchy exposes semantic references to root, body, torso, head, front-left/right and hind-left/right limbs; animation no longer assumes a child index outside the construction adapter. Windup lifts and pitches the body while both front limbs load. The active phase shifts weight forward and drives an asymmetric front-paw swipe. Impact briefly holds the contact silhouette, and recovery blends every contribution back to the locomotion baseline.

Pose ownership is layered in this order:

1. resolved locomotion selects and samples the distance-driven quadruped gait;
2. combat adds bounded body/limb/head offsets;
3. hit reaction adds a short bounded recoil;
4. the scene writes the composed pose once per frame.

Pose offsets never enter world position, travelled distance or market coordinates. Charge gait remains distance-driven and uses the M11.1 `CHARGE` locomotion state.

## Impulse, mass and knockback

Contact resolves a stable X/Z normal from actor centers. Exact overlap uses a deterministic seed-based unit vector. Presentation mass is centralized: giants carry substantially more inertia than normal bulls or bears. Impulse magnitude and attacker/defender mass ratio are clamped; accumulated external speed cannot exceed 13 units/s and decays exponentially with simulation time.

The result enters `integrateMotion` as bounded `externalVelocityX/Z`. It is composed after desired movement and separation, then constrained by the existing arena, terrain and detailed-contact stages. `finalizeMotionFrame` observes the actual displacement and remains the sole orientation authority. Visual recoil is separate from this physical displacement. No attack code teleports a unit or directly increments its position.

## MarketImpact charge contract

The presentation controller consumes the existing renderer-independent M10.2 impact object. Eligibility requires:

- `LIVE` context;
- bullish or bearish direction;
- at least one verified execution;
- finite existing ImpactScore;
- cause `TOKEN_NATIVE_MARKET_MOVE` or `TOKEN_NATIVE_AND_QUOTE_FX_MOVE`.

`NORMAL` and `STRONG` add bounded local combat intensity only. `EXTREME` and `SHOCK` may request one large offensive by the matching faction. Existing ImpactScore and category are read, never recomputed. FX-only movement, supply/provider correction, degraded/waiting state, initialization and source rebase cannot request a charge.

A request proceeds through windup, M11.1 charge movement, swept contact, and recovery. The actor follows the precommitted path and M11.1 facing; it never performs an instantaneous full-speed U-turn. One active actor and one latest pending request are allowed. Same-direction pending events coalesce; opposite direction supersedes pending work. An opposite authoritative impact cancels the active charge into recovery and retains only the latest opposite request.

The controller records token mint and source epoch. Context changes clear pending intensity and request cancellation of active presentation. Token reset additionally destroys actors, targets, impulses and registries. The first attached terrain snapshot establishes context only, preventing historical startup impact from becoming a cinematic.

## Contact, budgets and lifecycle

Charge motion uses finite-segment/circle intersection, so a low-FPS step cannot tunnel across an enemy. Contacts are ordered along the segment. A per-charge identity registry permits each target once, is capped by both category budget and a global maximum of 12, and is cleared on completion, cancellation, retirement and reset. `EXTREME` permits up to six contacts; `SHOCK` permits up to ten. Speed, distance, impulse and recovery are independently bounded.

Spawns create fresh combat state. Any future object-pool reuse must call `resetCombatState` and `resetChargeContactRegistry`. Token switches call the full scene reset, which cancels presentation state, destroys old unit references and resets diagnostics. A terrain rebase changes presentation coordinates only and cannot contribute charge distance, attack range, hit or impulse.

User Champion remains outside combat arrays and cannot receive or emit financial or physical force. The existing Black Bull presentation can currently satisfy a large ANSEM bullish response, while generic factions use the closest existing bull/bear actor. M12 may replace actor identity through this adapter; it must not move market or combat semantics into a Commander profile.

## Diagnostics, scaling and verification

Development mode and `?diagnostics=1` expose aggregate approach, windup, active, impact, recovery and charge counts; hits, misses, active impulses, knockbacks, cancellations, queue depth, maximum registry size, non-finite values, invalid states and contact checks. Per-unit diagnostics expose combat sequence/state, pose pivots, impulses, charge phase and resolved locomotion.

Normal detailed melee evaluates only its selected target. Aggregate combat uses its existing paired-rank plan. Charge contact reuses the bounded entity set and crowd ranks only while one charge is active; swept checks stop at the configured contact budget. No unbounded queue, registry, actor list or per-frame DOM work is introduced.

`tests/combat.test.js` verifies legal state order, visible bear pose, miss semantics, one hit per swing, 30/60/120 FPS cadence, reset, mass, clamping, exact-overlap normals, swept fast contact, bounded multiple contacts, impact mapping, exclusions, reversal, flood and context isolation. `tests/locomotion.test.js` verifies that external impulse travels through resolved velocity. Browser tests stage deterministic bear and bidirectional impact fixtures without live market dependence.

`npm run test:combat:soak` executes 600 simulated seconds over 192 combatants, repeated attacks and misses, impact floods, reversals, charge registries, rebases, token switches and object resets. It fails on duplicate hit edges, non-finite values, policy overflow, queue growth or any mutation of a frozen financial-truth snapshot.
