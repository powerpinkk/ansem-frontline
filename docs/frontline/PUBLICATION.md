# Publication verification — 12 November 2026 (Europe/Madrid)

Frontline 3.0.0-rc.1 is a published release candidate. The user accepted implementation candidate 1a08536 and authorized publication after the requested giant-orientation correction. The implementer's review is not an independent review. No pilot-wide acceptance or blanket media rights are claimed.

## Source and deployments

| Component | Verified identity |
| --- | --- |
| Public repository | https://github.com/powerpinkk/frontline ; unchanged repository ID 1297720878 |
| Implementation PR | https://github.com/powerpinkk/frontline/pull/25 ; merged with history preserved |
| Validated PR head | ebb3122813c0787dd7bb173d4784cc9fa5f4bdf6 |
| Implementation merge | 7fb0006fdac96dd2ff6233557215378d074f215d |
| Vercel production | https://frontline-solana.vercel.app/ ; deployment dpl_7CF8t7ZCTdf6HeJw8VvT4m5aefgz, READY at implementation merge |
| GitHub Pages | https://powerpinkk.github.io/frontline/ ; deployment workflow 43122840744, successful |
| Neutral HTTP relay | https://frontline-solana.vercel.app/relay ; exact Worker build 75a046bf244d54bfdc6d21a2a3fb8c630cf1fb9a |
| Worker version | a8f37d62-500a-4243-863f-5540460082be ; existing script updated in place |

The backend is a separately pinned component; a frontend/documentation commit does not imply a Worker redeployment. STREAM_HUB retained its original namespace. The additive GLOBAL_BUDGET namespace and HELIUS_API_KEY secret-name presence were checked without reading secret values. Selected Solusser source hashes (28 files) still match the transfer manifest. Source pilot, private history and backup were not modified.

## Served verification

CI 43122563220 and CodeQL 43122563210 succeeded on the implementation merge. The accepted head also passed CI/CodeQL and Vercel preview. Local final verification: lint,820 units/49 files,22 optimized E2E,zero skipped/flaky tests,root and Pages production graph/bundle guards. See VALIDATION.md and GIANT_ORIENTATION.md for scoped evidence.

All 34 public files in each variant were downloaded from its real HTTPS URL. In each variant,33 are byte-identical to the configured local candidate. index.html differs only in carriage-return bytes from the Windows working tree; removing CR produces identical text. Served SHA-256 manifests retain the actual bytes rather than claiming binary identity. Main JavaScript/CSS, numerical Worker, battlefield images, Pixel, favicon, social images, manifest and notices all return HTTP200.

Playwright Chromium tested both public URLs at 1440×1000/DPR1 and 390×844/DPR2 mobile emulation. Before navigation, external providers,relay acquisition and all WebSockets were blocked. All four cases render WebGL2 and explicit DEMO · SYNTHETIC,with no blank page,framework overlay,console/page error,failed asset,external request or horizontal overflow. Pause freezes the numerical tick;detail zoom,center,resume and Pixel canvas work. Screenshots and JSON are private in the publication evidence folder. Browser plugin was unavailable; Firefox/WebKit,physical Android/iOS,Safari and modest iGPU remain untested.

Vercel returns the intended CSP header,including frame-ancestors 'none'. Pages uses supported meta-CSP directives and cannot claim that header-only protection. The old public Vercel hostname redirects308 to the neutral domain,preserving path/query. Two team-scoped historical aliases remain behind Vercel SSO; an anonymous request reaches that access gate before app redirects. No protection was disabled. GitHub repository redirect is preserved; the old Pages path is not promised as a working redirect.

## Actual data coverage

Separate bounded read-only tests contacted the existing backend and the neutral facade,three requests per sample,no retries or WebSocket. The health/build/v4 envelope,CORS,no-store and supported degraded-response contracts pass. A first backend sample accepted canonical pool/valuation authority; later samples were conservative and rejected valuation observations ahead of the local evaluation clock. No clock tolerance or financial gate was weakened.

The facade sample does **not** qualify for complete live-activity promotion:promotionEligible=false,canonical acquisition not proven in that sample,and the current 60-second execution window is EVIDENCE_PENDING with zero verified executions. The indicative fallback returns422 NO_SAFE_FALLBACK_POOLS for that tested mint. Reported backend capabilities alone do not establish activity coverage. Historical acquisition gaps remain recorded; storage/history was not reset for a green result. This release candidate demonstrates the 2D product and explicitly degraded live paths; it does not certify complete current verified swap coverage.

A separate served-browser case loads JUP using the real public providers within a 45-second/25-request ceiling,then explicitly returns to Demo. It resolved JUP, displayed DEGRADED · PARTIAL DATA with an indicative price, exposed no simulation mutators and returned to DEMO · SYNTHETIC with the token query removed . Seven provider/relay requests were observed and no page errors occurred. Three optional token-icon CDN requests were blocked by the test allowlist; no wallet/signing operation was attempted. The private live-browser.json records the observation; it is not a claim of complete 60-second activity coverage. Do not increase provider spending or bypass the shared governor to qualify this version.

## Limits and maintenance

Dense central crowding,Canvas atlas/cadence differences,hardware coverage and the data qualification above remain disclosed. The reporter environment-dump defect is fixed; credentials exposed in an earlier tool-output incident require operator rotation and are never repeated in evidence/docs. No new paid service was added. The runtime governor bounds this Worker's upstream requests across its token hubs,not unrelated applications,provider-key use elsewhere or hosting bills.

Use RUNBOOK.md for configuration and compatible rollback. Keep Demo available during provider failure. Release assets contain the actually downloaded static builds and their hashes,not private diagnostics,Solusser strategy,credentials or the removed full Jupiter payload.
