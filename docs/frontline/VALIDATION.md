# Candidate validation — 11 November 2026

The initial Frontline 3.0.0-rc.1 candidate was accepted by the user, with a requested giant-orientation correction before proceeding. See GIANT_ORIENTATION.md for the correction and current 820-unit / 22-E2E verification. Publication is authorized; live hosting cutover is not yet verified. No independent review is claimed. Source branch: codex/frontline-2d-portfolio; baseline 1dcf44bee668f72ccccc98f753ecf624c91f4f6d. The ignored .artifacts/frontline-2d/candidate.json binds the final source commit, binary diff, source archive and both optimized variants to SHA-256 hashes. Evidence is private until the publication gates are met.

## Automated results on this implementation

| Check | Result | Evidence / scope |
| --- | --- | --- |
| Initial unit baseline | 805 passing | baseline-host-unit.json; original checkout, outside sandbox |
| Final lint | Pass | npm run check; historical .codex-context evidence explicitly excluded, preserved |
| Initial accepted unit / contract suite | 817 passing across 49 files | final-verification.json / final npm run check (unit-final.json is the earlier 816-test checkpoint); no financial expectation weakening |
| Optimized E2E | 22 passing, zero skipped/flaky/failing | e2e.json; Chromium desktop + mobile emulation, actual static / and /frontline/; current candidate |
| Build / asset checks | Both variants, 34 files each | bundle-manifest.json; Three absent from production module graph; forbidden simulation hooks absent |
| Pressure replay | 48 comparisons, zero divergences | financial-replay.json; synthetic PumpSwap/DLMM/Orca buy/sell/routed fixtures, four window ages; baseline versus candidate |
| Price / valuation / supply replay | 48 comparisons, zero divergences | financial-expanded.json; six unchanged historical public-chain captures plus explicit mutations/absence; not a current live market |
| Authority boundary / journal | 36 boundary checks + 6 admissions, zero divergences | financial-expanded.json; epochs, slot/time regression, foreign mint, expiry, deduplication and settlement; core code identical after LF normalization |
| Persistent global budget | 30/80 RPC reservations allowed; 120/125 ingress allowed | budget-edge.json; actual local workerd/SQLite Durable Object, two mints concurrently, zero external requests; separate atomic reconstruction unit tests |
| Dependency audit | Production: 0; full tooling: 4 moderate, 0 high/critical | audit-production.json / audit-final.json, dated 11 November; advisory state can change |
| Transfer integrity | 28 selected source entries unchanged | transfer-manifest.json includes original and adapted hashes; selected private media not cleared for distribution |

The Browser plugin was unavailable, so QA used local Playwright. Only Chromium installations are available; Firefox, WebKit, Safari, physical Android/iOS and integrated GPUs are untested. HTTP and WS interception was installed before navigation; service workers were blocked during measurements. Provider fixtures are synthetic HTTP responses, not evidence that the deployed live service works. No service was deployed or activated for QA.

E2E covers explicit Demo, malformed mint and history recovery, representative provider discovery with degraded coverage, reload, absent production mutators even with ?diagnostics, HTML survival and asset retry, Pixel routes, Canvas fallback, resize, repeated disposal and GL1 loss/restoration. Existing affected contracts additionally cover timeout/429, reconnect, stale replies, abort, mint/epoch isolation, journal bounds and valuation expiry. Frozen 3D E2E/soak files remain historical and are not counted as current 2D QA.

The additional private interactions.json records keyboard zoom/pan/Home/Space, mouse and CDP touch drag, synthetic event picking without a verification URL, inspector close, and deterministic visibility suspension/resumption. The document.hidden override is an event-path test; it does not certify an OS background policy.

## Measurements of accepted candidate 1a08536 (before the giant correction)

| Load / viewport | Actors | rAF p50 / p95 / p99 (ms) | Renderer init → first draw (ms) | Long tasks |
| --- | ---: | --- | ---: | ---: |
| quiet-desktop | 31 | 7.0 / 7.1 / 20.9 | 718.9 | 2 |
| representative-desktop | 215 | 13.9 / 28.0 / 48.6 | 854.9 | 5 |
| peak-desktop | 520 | 13.9 / 20.9 / 27.8 | 474.8 | 0 |
| representative-mobile | 215 | 13.8 / 20.8 / 27.8 | 840.3 | 0 |
| canvas-mobile | 213 | 20.7 / 27.8 / 34.8 | 389.7 | 0 |

Final optimized JS/CSS digest: c1645d790f001373a63781b5e1fcca7afde77316a3518cc2f0406bf1fd14dd51. buildStable=true; all five cases have zero console/page errors, zero external requests and no horizontal overflow.

These are rAF interval percentiles in one approximately 12-second sample after 8 seconds of warmup, not guaranteed renderer FPS or a device certification. The startup column measures renderer initialization through its first useful draw in a new browser context against a local static server with a warm host filesystem. It excludes earlier navigation/module setup and is not a full cold-OS startup or mobile-network download. Desktop is 1440×1000/DPR 1; mobile is 390×844/DPR 2, Android Pixel 7 UA/touch emulation on the same host. Chromium 151.0.7922.34 uses ANGLE D3D11 on NVIDIA RTX 5060; explicit GPU flags and raw timestamps are retained. No population or financial facts were reduced to improve measurements. Desktop maximum is 520 actors; mobile retains the existing constrained 120-per-side policy.

Loaded assets total 16,564,848 encoded bytes in GL (16,564,901 in Canvas), excluding the navigation HTML. The local server sends assets without network compression; this is not a mobile-network latency measurement. The six PNGs account for 15,699,705 bytes. After 20 token transitions: listeners 90 → 90, DOM nodes 1618 → 1211, main-thread used JS heap 96543764 → 89192572 bytes, Worker scopes 1 → 1. Six source textures and 264 subtextures remain owned by the same renderer. Earlier diagnostic Canvas samples varied up to 104 ms p95; the final short sample is not a worst-case guarantee.

The renderer owns six source PNG textures and 264 atlas subtextures. Estimated decoded source RGBA is 37,743,168 bytes; continuous GL rig geometry is 2,032,560 bytes. These are estimates, not measured VRAM. Twenty token transitions (ten provider-fixture / Demo round trips) are recorded with CDP counters; no forced-GC heap plateau or long-duration leak-free claim is made. Main-thread and Worker heaps are distinct.

The numerical runtime moved to a dedicated Worker to remove presentation stalls. Only that Worker advances fixed-step combat. The main thread acquires facts and draws/interpolates one copied frame; one outstanding frame prevents an unbounded message queue. The FX draw budget is 24; all numerical contacts remain in frames. Atlas-only aggregate interpolation avoids solving hundreds of unused skeletons. Those are presentation changes; the financial domains remain authoritative. High-load central congestion remains visible and subject to acceptance.

## Findings and remaining gates

| Finding | Closure / limit |
| --- | --- |
| O3 public simulation mutators | DEV-only hooks are eliminated from optimized bundles; public read-only diagnostics return copies. Query parameters do not grant live mutation authority. |
| O5 mint limits mistaken for global budget | Global SQLite governor, exact live allowlist of at most two mints, 30 RPC/minute + 3,000/day and 120 ingress/minute; fail closed. No claim to cap Cloudflare bills or arbitrary internet traffic. Existing provider WS disabled in this bounded deployment scope. |
| O6 / O14 outdated data authority | README, UI, case study and runbook describe verified pool execution, indicative discovery, SOL-only pressure coverage, canonical valuation and freshness. Default is explicitly synthetic. |
| O9 backward movement heuristic | No persistentBackward pass/fail gate. Numerical displacement drives stride; contacts/range/finiteness are checked. Knockback is not labelled defective gait automatically. |
| O13 tiny prices | Shared magnitude-aware formatting retains positive small prices; unknown values remain distinct. |
| Old brand / old preset | Neutral Demo and theme; current product text, image inspection and optimized assets clean. Historical captures, Git history and actual operator resource names remain truthful. |
| Three / duplicate simulation | Production graph excludes Three. Old scene stays in Git; dev-only Three supports frozen geometry contracts. One numerical owner, renderer consumes frames. |
| Jupiter current snapshot / payload | Minimal functional schema passes Frontline consumer tests and parity hash; notices retained. Git history remains and requires appropriate rights review before distribution. |
| Private art / R16 | Local-only transfer inventory prepared. No distribution clearance or acceptance inferred. ART.md offers a bounded replacement scope if clearance cannot be granted. |
| Pause button occluded by social links | Reproduced at 1440×1000; links moved into the header. Optimized E2E checks actual clicks at that viewport. Inspector is closed before resuming in the touch walkthrough. |
| Stale contact after swap eviction | Reproduced in the final Canvas measurement. removeTrade now purges actor references immediately between fixed steps, including admission-cap eviction. A targeted contract regression checks the next frame before another step. Failure evidence is retained privately; final measurements were repeated after the fix. |
| Renderer compatibility | GL2/GL1 use continuous articulated rigs; Canvas uses atlas animation and has poorer measured cadence. No equivalent performance or animation claim. |
| Physical devices / actual endpoint | Pending with RUNBOOK.md procedure; no live smoke against a newly deployed endpoint claimed. |
| Review / publication | Implementer self-review only. Exact visual/technical candidate acceptance, media/history decision and explicit remote-write authorization remain mandatory. |
| Reporter security incident | A previous failing reporter exposed inherited environment values in tool output. The inherited-env reporter configuration was removed; final reports contain no environment dump. Credentials exposed in that earlier output require operator rotation. Values are not reproduced here. |

No known blocker remains in the deterministic primary desktop/Demo or configured-live fixture paths tested above. Canvas cadence, dense central contact, physical support and real served-live coverage have the stated limits. This is not a declaration that the complete public project is finished.

## Dependency decisions

Pixi is exactly 8.22.0. Node >=22.12 is required (tested 22.18.0 / npm 10.9.3). Clean npm ci --ignore-scripts --legacy-peer-deps was successful. The legacy-peer flag avoids the observed optional-peer resolver crash and is also used in CI; it does not hide a claimed normal npm ci success. npm ls exits zero but lists three optional/transitive extraneous development entries in this host installation. Vitest stays on compatible 4.1.12; no routine jump to 5. Vite 8.3.4, Wrangler 4.160.0, ESLint 10.12.0 and globals 17.13.0 were tested. Four remaining moderate findings are in tooling's minimatch/ESLint chain; production audit is zero at the recorded time.

Remote dependency PR #15 requires rebasing/review after this lockfile change, especially its Vitest 5 proposal. #14 changes a now development-only Three dependency and is deferred. #1 Actions updates require their own CI review. None was merged or remotely modified. No audit fix --force was used.

## Private evidence and reproduction

Run npm run check for lint/unit/build/optimized E2E/bundle checks. Root and Pages artifacts are under .artifacts/frontline-2d/build-root and build-pages; node scripts/serve-candidate.mjs serves those exact directories without rewriting their bases. Raw measurements, screenshots, interaction result and desktop/mobile webm clips are in C:/Users/Usuario/.codex/visualizations/2026/11/11/01a1c95c-5863-7e53-a2e8-5e5cc8a4d726/frontline. Local measurement and replay drivers remain ignored in .artifacts/frontline-2d for inspection, not as a new product feature.

README.md, CASE_STUDY.md, RUNBOOK.md, ART.md and RELEASE.md are the maintained explanation. Earlier root docs are dated historical evidence, as indexed in docs/README.md. RELEASE.md defines the exact acceptance/publication/rollback sequence; .artifacts/frontline-2d/worker-in-place.jsonc is an undeployed, empty-allowlist migration candidate targeting the existing physical Worker. Record real namespace IDs, origins, approved mint(s), build ID and the assigned neutral facade before any authorized cutover.
