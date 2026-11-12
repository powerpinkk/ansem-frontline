# Frontline 3.0.0-rc.1 — release and rollback

The user accepted candidate 1a08536 and authorized publication after the giant-orientation correction. PR #25 is merged at 7fb0006; CI, CodeQL, Vercel production, Pages and actually served root/Pages/Pixel checks pass. See [publication verification](PUBLICATION.md) for exact source/deployment IDs, served-artifact comparison and current data limitations. The implementer's review is not independent. Frontline-specific selected-art distribution is recorded in ART.md; the private pilot and historical Git objects are preserved without blanket licensing claims.

## Published identity

| Resource | Current state |
| --- | --- |
| Repository | https://github.com/powerpinkk/frontline ; stable repository ID 1297720878 |
| Homepage / canonical / OG | https://powerpinkk.github.io/frontline/ ; static base /frontline/ |
| Vercel | https://frontline-solana.vercel.app/ ; existing project prj_WHHiXHVhYsfEwUmI7LAC5xP7eR96 renamed internally to frontline |
| Frontend relay | https://frontline-solana.vercel.app/relay ; HTTP rewrite to existing backend |
| Frontend configuration | VITE_RELAY_ORIGIN=https://frontline-solana.vercel.app/relay ; VITE_STREAM_URL=disabled |
| Backend build | 75a046bf244d54bfdc6d21a2a3fb8c630cf1fb9a ; separately versioned from frontend |

The actual physical script ansem-frontline-stream and its account subdomain deliberately retain historical identifiers. Renaming them could create replacement storage; the current browser bundle uses the neutral facade. STREAM_HUB retained its existing namespace and migration v1. GLOBAL_BUDGET was appended through migration v2-global-budget; original secret-name presence was verified without reading secret values. Exact namespace IDs and previous versions are in private operator evidence. Never recreate Durable Objects for branding or to clear gaps/budget counters.

The old public Vercel alias redirects 308, including path and query. Two historical team-scoped aliases remain protected by Vercel SSO before application redirects; no protection was disabled. GitHub repository redirects preserve history/links. No working redirect is promised for the old Pages path and no extra repository was created for it.

## Candidate status and qualification

This is a prerelease. Default Demo and configured degraded-live paths are verified. Three bounded backend/facade samples preserved all financial/coverage gates; the facade contract passes but promotionEligible remains false and the 60-second execution window remains EVIDENCE_PENDING. The45-second real JUP browser case resolved the token and showed DEGRADED · PARTIAL DATA, then recovered explicitly to Demo. Do not describe this as complete verified live activity. Physical-device, iGPU, Safari and independent review remain unclaimed.

The original accepted private archives remain immutable under .artifacts/frontline-2d. The follow-up source/diff and downloaded public build hashes are recorded separately under .artifacts/giant-orientation. Release static archives are made from actual served bytes; they exclude private diagnostics, source-pilot strategy and credentials. An index.html CR-byte difference between Windows and Linux is explicitly recorded rather than hidden. The source tag includes this release documentation; the implementation source IDs remain in PUBLICATION.md.

## Repeatable release path

1. Use one writer on an appropriate codex branch. Inspect status and retain user changes; no reset/clean, global Git changes, history rewrite or hook bypass.
2. Run npm run check after product changes:lint, unit/contract tests, optimized root and Pages E2E, bundle guards. Keep financial replay expectations independent of visual/contact differences. Preserve transfer hashes and rights notices.
3. Check the real provider audit and dependency PRs without routine major upgrades. PR #15's Vitest 5 proposal, PR #14's now-development-only Three update and PR #1's Actions changes need separate compatibility review; they were not merged here.
4. Use the existing Worker/project and at most two allowlisted mints. Keep HELIUS_API_KEY solely in the provider secret store, public origins/CSP exact and the persistent governor active. A backend publication uses an exact WORKER_BUILD_ID and separately recorded namespace/version metadata.
5. Push only within authorized publication scope:branch pushes trigger Vercel preview/CI/CodeQL; merging to main triggers production Vercel and CI, then successful-CI Pages. Configuration changes create a new artifact and require optimized/served checks. The prior metadata-bundling build failure is fixed by whitelisting only required public build inputs, not weakening the brand guard.
6. Verify actual HTTPS main, Pixel, manifest, favicon, social and battlefield files, served hashes, CSP and CORS. Separate provider-blocked deterministic checks from a bounded authorized real-service sample. Keep pending/stale/degraded activity honest.
7. Publish a prerelease with exact source tag and static archive hashes. Never attach private evidence, credentials, full removed Jupiter payload or a whole private pilot archive.

## Compatible rollback

The previous production frontend was dpl_7EhNGSJh9LyrtrPSaLd9rCRxYHx5. Previous public Git main was 47225a4599096d6a079450857f3ca5d3f7849bd1; local3D work is preserved at 1dcf44bee668f72ccccc98f753ecf624c91f4f6d. Restore known frontend artifacts/config independently of backend state. Its old direct endpoint remains available for compatibility; the new facade and legacy public alias redirect were checked after cutover. A previous frontend reintroduces historical product branding and is an operational rollback, not the current portfolio identity.

Preserve STREAM_HUB, GLOBAL_BUDGET, epochs and migrations during any backend rollback. The previous Worker version is recorded for diagnosis, but do not assume an old version can safely reverse an additive storage migration. Prefer a compatible code fix or explicit live degradation with Demo available. Never bypass the governor or delete/recreate storage for a green smoke. Repository-name rollback, frontend alias changes and endpoint compatibility are separate actions requiring their own served verification.

Maintenance and physical-device procedure: [RUNBOOK.md](RUNBOOK.md). Official references: [Cloudflare SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) and [GitHub repository renaming](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository).
