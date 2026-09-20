# Battlefield motion foundation (M11.1)

M11.1 makes locomotion, resolved orientation, progress recovery, and quadruped gait one coherent subsystem. It does not add bear rear-up/swipe attacks, bull combat-charge design, knockback/mass reactions, or a combat rewrite; those remain M11.2. Market authority, Worker verification, Commander behavior, wallet boundaries, Theme Studio, Pixel Frontline, and camera policy are unchanged.

## Pre-refactor audit and root causes

The battlefield has two physical representations. Verified swap champions are individual Three.js groups in `js/scene.js`; aggregate market forces are instanced crowd ranks. The audit found the following write sites:

| Concern | Verified champions before M11.1 | Aggregate ranks before M11.1 | M11.1 owner |
| --- | --- | --- | --- |
| intent/target | `updateEntities`, target search, patrol, retreat, charge | `buildCrowdOrders`, `updateCrowdSide` | scene intent adapters |
| desired destination/steering | `tacticalPatrolTarget`, `getSteering` | formations and `getCrowdSteering` | scene navigation adapters |
| velocity/acceleration | direct speed multiplication plus combat impulse `vx/vz` | per-frame damping of `vx/vz` | `js/locomotion.js` |
| integration | several direct `mesh.position +=` writes | direct `x/z += vx/vz` | `integrateMotion` |
| separation/contact | `applySeparation`, detailed pair solver, champion/crowd contact | lane order, opponent contact, spatial-bucket separation | bounded inputs plus final constraint reconciliation |
| orientation | target vector, steering vector, charge vector, combat contact | velocity or opponent heading | `finalizeMotionFrame` from final displacement |
| animation | `animTime` sine waves and branch booleans | global `kingTime` sine waves | distance phase plus quadruped adapter |
| attack range | target-distance branches and frontline hold | paired-vanguard contact | explicit progress-exempt hold |
| lifecycle/reuse | spawn object, retirement, token reset, dev staging | deterministic spawn and array removal | `createMotionState`, `syncMotionPosition`, reset/destruction |
| terrain/rebase | trench height and arena clamps | obstacle steering and arena clamps | final position observation; presentation rebases never enter motion |

The visible defects shared one cause: intent, physical resolution, facing, and pose did not consume the same result. A unit could be labelled moving before collision resolution, face its target while sliding elsewhere, continue a time-driven gait while blocked, or classify a valid combat hold as stuck. The legacy stuck response also mutated lane, position, velocity, and side at once, making recovery frame- and crowd-dependent. Direct writes before and after separation meant there was no single final displacement to validate.

## Pipeline and state contract

Every moving unit now follows this order:

`intent → navigation target → desired velocity → steering → resolved velocity → integration → collision/contact constraints → locomotion state → orientation → animation pose → render`

`createMotionState` owns bounded scalar state: current/previous position, target, desired and resolved velocity, speed, facing, total/frame distance, target identity, `IDLE/WALK/RUN/CHARGE`, `NORMAL/SUSPECTED/RECOVERY`, low-progress time, recovery duration/cooldown/attempts/direction, gait phase, and assertion counters. It has no Three.js dependency.

The engine clamps one locomotion update to 250 ms. Velocity approaches the desired vector under a maximum acceleration and integrates by the trapezoid of old/new velocity. Steering and separation are finite-checked and speed-capped. The scene then applies existing collision/contact constraints. Only after those constraints does `finalizeMotionFrame` observe the real displacement; that final result owns speed, facing, locomotion state, gait, and diagnostics.

## Orientation and backward invariant

Moving facing is derived from resolved displacement, never merely from a target. A 0.12-unit/s dead zone preserves the previous heading and removes zero-speed jitter. Intentional stationary combat contact may explicitly face its current opponent. Turning follows the shortest angular path with a bounded rate: 4.1 rad/s for detailed giants, 5.4 for ordinary champions, and the established 2.35/3.2 crowd rates.

The diagnostic invariant compares final velocity with the rendered forward vector. Opposed motion receives a 500 ms grace window for legitimate reversals; persistence increments `backwardViolations`. Repeated violations are visible in `locomotion.assertions.persistentBackward` rather than being hidden by animation.

## Progress and deterministic recovery

Progress compares final distance against requested speed. Intentional idle, in-range attack hold, crowd engagement, charge phases, retirement, and explicit recovery are exempt. Low progress moves from `NORMAL` to `SUSPECTED` at 550 ms and to `RECOVERY` at 1.05 s. Recovery combines 42% forward intent with a deterministic lateral direction derived from the unit seed and attempt number. It lasts at most 720 ms, then waits at least 1.35 s before another attempt. Three attempts are allowed; the safe fallback is a bounded hold and doubled cooldown. No random jitter or teleport is used.

Crowd separation remains a bounded spatial-bucket constraint. Detailed separation is converted to a bounded velocity contribution before integration; hard pair/contact corrections are reconciled as actual motion. Non-finite positions reset to the side's safe spawn and synchronize motion state. These rules prevent explosive forces and recovery loops while retaining the existing no-overlap guards.

## Locomotion and quadruped animation

State hysteresis prevents threshold flicker: idle enters walk above 0.28, walk returns to idle below 0.12, walk enters run above 5.25, and run returns to walk below 4.35. `CHARGE` is compatibility for the existing M10.2 giant-bull charge only; M11.1 does not expand its combat semantics.

The detailed Black Bull is a real four-leg hierarchy: each leg mesh is parented at its hip, while the leg geometry is translated below that pivot. The animation adapter consumes only formal locomotion state and distance phase. Walk uses a four-beat sequence; run/charge uses diagonal pairs. Body bob and pitch are subtle and state-specific. Aggregate bulls and bears use the same adapter through their four instanced leg meshes. Phase advances by resolved distance (2.05 rad/unit walking, 2.65 running), so blocked units do not walk in place and 30/60/120 fps cover the same gait distance.

## Lifecycle, terrain, and retargeting

Spawns create fresh motion state. Dev fixture teleports, non-finite fallback, and any future pool reuse must call `syncMotionPosition`; this zeros velocity, gait, progress, and recovery without inventing travel. Token presentation reset destroys detailed and crowd motion state and resets performance counters, so token switching cannot leak orientation or recovery.

Rapid market reversal replaces the navigation target immediately and accelerates from current resolved velocity. There is no stale target queue. Market Terrain's logical/presentation rebase remains renderer-only and never writes troop motion. If a future physical floating-origin shift moves units, it must use `syncMotionPosition`; the rebase test proves that such a shift creates zero frame distance and no gait. Camera movement is downstream of world state and cannot change locomotion.

## Diagnostics and assertions

Development mode or `?diagnostics=1` extends `window.__ansemSceneDiagnostics()` with per-unit desired/resolved velocity, speed, facing, locomotion/progress state, recovery attempts, backward violations, and gait phase. `locomotion` aggregates moving, idle, walk, run, charge, suspected-stuck, recovering, backward, average speed, maximum attempts, and animated quadrupeds. Assertions expose non-finite corrections, recovery-loop fallback, gait while static, and persistent backward motion. Rolling update performance reports samples, mean milliseconds, and maximum milliseconds for projectile + detailed + crowd motion.

## Verification and performance budgets

`tests/locomotion.test.js` covers cardinal/diagonal facing, bounded 180° turn, zero-speed jitter, explicit stationary target facing, backward grace, deterministic stuck/recovery, intentional hold, dense bounded separation, 30/60/120 fps travel, large delta, lifecycle reset, floating-origin rebase, rapid reversal, locomotion hysteresis, idle/walk/run/blocked gait, four-leg phase relationships, and distance-driven gait stability.

`scripts/locomotion-soak.mjs` simulates 260 agents for 600 seconds (9.36 million updates) with dense separation, 39 reversals, background-size delta spikes, 100 rebases, 64 lifecycle/pool resets, intentional holds, and forced zero-progress windows. It fails on non-finite state, recovery-budget overflow, static gait, persistent backward motion, or recovery loops.

The representative pre-refactor 520-rank WebGL test passed in 44.5 s on this workstation with render calls below 230, turn rate at or below 3.21 rad/s, speed below 12, and zero same-side overlap. The final M11.1 run passed in 40.2 s (9.7% faster) under the same isolated command and budgets. Performance acceptance is no draw-call increase, no progressive soak slowdown, bounded motion update time, and no per-unit arrays/vectors allocated in the motion hot path; state, input, output, and gait pose objects are preallocated per unit.

## M11.2 boundary

Still intentionally absent: bear rear-up/swipe, a new bull combat charge, attack selection/range redesign, mass-aware knockback, impact reactions, damage changes, and combat animation state machines. Those features must build on the resolved-motion contract rather than bypass it.
