# Maintenance

Use Node 22.12+; validation used Node 22.18 and npm 10.9.3 on Windows. Install the committed lockfile with npm ci --ignore-scripts --legacy-peer-deps. Local commands: npm run dev, npm run lint, npm test, npm run build, npm run test:e2e. The latter builds optimized root and /frontline/ variants and serves them as static files, without path rewriting.

## Configuration

| Name | Location | Meaning |
| --- | --- | --- |
| VITE_RELAY_ORIGIN | Frontend build, public | HTTPS origin of a verified relay; unset means indicative discovery without verified acquisition |
| VITE_STREAM_URL | Frontend build, public | Optional WS URL; use disabled for the bounded polling deployment |
| HELIUS_API_KEY | Worker secret only | Provider credential, never a VITE variable or committed file |
| LIVE_TOKEN_MINTS | Worker variable | Comma-separated exact allowlist; first two mints only; empty disables live acquisition |
| WORKER_BUILD_ID | Worker variable | Exact deployed revision identifier |
| ALLOWED_ORIGINS | Worker variable | Exact frontend origins, including the assigned Vercel origin and Pages origin |
| STREAM_HUB | Worker DO binding | Existing per-mint state namespace; retain class, namespace and object-name derivation |
| GLOBAL_BUDGET | Worker DO binding | Shared singleton reservation ledger across all mints |

No values of secrets are required for Demo, unit tests or deterministic browser checks. Test configuration must never copy process.env into a serializable reporter object. The inherited E2E configuration did this during an early failed run; the copy was removed. Credential rotation for values exposed in that local output belongs to the operator; no values are retained in this document.

## Live operating scope

The reviewed public scope is a portfolio demo with bounded read-only acquisition, not a 24/7 gap-free exchange feed. Configure at most two mints. The frontend discovers supported Solana base-token pools; server verification independently checks protocol owners, vaults, mint identity and source epoch. Pump curve / PumpSwap have native valuation gates; DLMM, Whirlpool and supported CLMM executions do not imply native valuation authority. Mayhem and unknown wrappers stay unsupported. Stablecoin execution quantities keep their own units and do not weight SOL pressure.

Every actual RPC send reserves one persistent global ticket: 30 per fixed UTC minute and 3,000 per UTC day. Reservations survive DO eviction and denial happens before provider fetch. Client ingress separately admits 120 requests per fixed minute; rejected requests still consume Cloudflare ingress resources. This is not a dollar cap and CORS is not an abuse or billing governor. The global deployment disables upstream provider WebSockets and the optional Gecko proxy, so acquisition uses the existing verified polling path. HTTP clients still receive explicit coverage/retry information. Arbitrary mints outside the allowlist receive 422; missing global configuration receives 503. Provider errors and budget exhaustion must remain degraded, never Demo disguised as LIVE.

A day-long quota exhaustion is an expected operating limit of this bounded scope. The default Demo remains available. A larger/unrestricted market service requires a separate operating budget and review, not simply increasing the token selector's promise.

## Renderer and recovery

Pixi is fixed at 8.22.0. Review the per-instance GL1 texture adapter before changing Pixi or adding mipmapped/comparison textures. GL rigs and Canvas atlases intentionally differ. Assets time out after 12 seconds and failure cancels sibling loads. Retry Battlefield retries graphics without remounting acquisition. WebGL context restoration keeps numerical state. Repeated disposal closes owned bitmaps, textures, rig geometry, observers and numerical timers.

Demo profiles are reproducible acquisition fixtures: ?demoLoad=quiet, representative (default), or peak. The option is read only by the Demo source; live sessions ignore it. Peak retains the existing 260-per-side desktop / 120-per-side constrained-device force budgets. Never lower population or financial inputs to improve a measurement.

Pause freezes presentation, not acquisition. Resume and return from visibility suspension rebuild currently recent actors, excluding obsolete events and bounding queues. Large event-loop gaps may slow illustrative presentation time; no financial event is created to catch up.

## Dependencies and tests

Keep exact runtime Pixi and the committed lockfile. Audit before updating; prefer compatible patches/minors. Vitest remains on major 4. An npm 10 peer-resolution crash required --legacy-peer-deps for the reviewed tooling update; verify npm ls and clean installation before release. Do not use audit fix --force. Root lint excludes frozen .codex-context evidence instead of editing it. Frozen 3D E2E and old live/soak scripts are historical tools; use the active 2D suite for this candidate and never invoke an old live script as an implicit release step.

For a provider outage, retain the explicit unavailable/degraded live state and the user's mint. TRY DEMO returns to the standalone fixture path; no provider or secret is needed. Do not deploy to obtain test evidence.

## Rollback and physical checks

The previous 3D candidate is preserved at 1dcf44bee668f72ccccc98f753ecf624c91f4f6d. Keep release artifacts by hash. Roll back frontend artifacts independently of Worker state, and roll back Worker code without deleting/recreating DO namespaces or reversing storage migrations. The release procedure describes the compatible endpoint transition.

Physical checks remain: Safari on iPhone/iPad, modest Android and integrated-GPU laptop. On each, record browser/OS, viewport/DPR, cold load, both bases, zoom/pan/picking, 60-second motion capture, pause/visibility recovery, context/asset failure, native PiP availability, memory before/after 20 token changes and thermal behavior. Emulation does not certify those devices.

## Frontline hosting identity

The neutral Vercel domain is frontline-solana.vercel.app on the existing project ID prj_WHHiXHVhYsfEwUmI7LAC5xP7eR96. /relay proxies HTTP to the existing physical ansem-frontline-stream Worker. Its historical resource name stays in operator configuration to preserve STREAM_HUB storage; the frontend never uses its legacy URL directly. Keep migration v1 and append new migrations. Never create a replacement namespace for a cosmetic rename.

Vercel uses Node22 and npm ci --ignore-scripts --legacy-peer-deps. Pages reads the public VITE_RELAY_ORIGIN repository variable; both builds use VITE_STREAM_URL=disabled. The two allowlisted verified-polling mints are the previously served token mint 9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump and JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN. This is an operational admission list, not a default-token preset or investment recommendation. All other compatible mints retain indicative discovery with explicit degraded verified coverage. Demo remains the neutral default.

GitHub Pages applies the HTML meta CSP for supported directives; frame-ancestors requires HTTP headers and is enforced on Vercel, not claimed for Pages. The facade and DexScreener are the allowed connection origins. A host change requires rebuilding, updating CSP/allowed origins and repeating served verification.

CI uses the pinned Playwright Chromium with the runtime libraries already supplied by the GitHub-hosted Ubuntu image. The first follow-up run passed lint/unit/build but failed DNS lookups for optional APT font packages during --with-deps. Browser installation now avoids that unrelated APT step; the full 22-test suite still executes and missing runtime libraries would fail CI. No E2E checks were skipped to obtain a green result.
