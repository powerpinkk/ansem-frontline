# Frontline 3.0.0-rc.1 — local release procedure

Status: local candidate preparation. No remote branch, PR, push, merge, rename, release, image publication or deployment is authorized by the implementation task. The exact source commit, source/transfer hashes and root/Pages artifact hashes are recorded in the local candidate manifest. Review that exact package; no independent review has been claimed or created automatically.

## Revalidated remote facts — 11 November 2026

Repository ID 1297720878 is still public at powerpinkk/ansem-frontline. Main is 47225a4599096d6a079450857f3ca5d3f7849bd1. The latest push CI is successful (10 October 2026, run 38085973452). No releases were returned. Three dependency PRs remain open: #15 tooling group, #14 Three update, #1 Actions group. The requested powerpinkk/frontline path returned no repository at inspection; it is not reserved and must be rechecked immediately before renaming. Old names here identify actual operator resources and history, not the product's UI.

## Candidate acceptance before publication

Review source/diff, new validation, screenshots and motion clips. Confirm the selected image hashes and applicable distribution rights described in ART.md. The pilot's private-art labels and pending R16 acceptance do not become approvals through this migration. The current Jupiter replacement removes the full snapshot/payload from current source; old Git objects remain. Decide handling of the existing public history through an appropriate rights review; this task authorizes no history rewrite and asserts neither infringement nor blanket clearance.

If independent review is available, review the exact candidate revision. Otherwise explicitly record that the technical/visual review is the implementer's own and obtain the user's acceptance. Physical-device and actual served-live verification remain separately scoped. No deployment may be used to bypass those distinctions.

## Proposed identity and URLs

| Resource | Proposed state | Validation / dependency |
| --- | --- | --- |
| Repository | powerpinkk/frontline | Recheck name, preserve stable repository ID and all Git authors/history |
| About | Solana token activity and price in an illustrated 2D battlefield. Includes an offline synthetic demo. | Set only after accepted candidate |
| Homepage / canonical / OG | https://powerpinkk.github.io/frontline/ | Build base /frontline/ and verify actual Pages files/URLs after deploy |
| Vercel | Keep the existing project; assign an available neutral Frontline alias | No assumption that frontline.vercel.app is available; record the actual assigned HTTPS origin before rebuilding |
| Frontend relay | <assigned-neutral-vercel-origin>/relay | HTTP reverse rewrite to the existing Worker; use VITE_STREAM_URL=disabled in the bounded polling scope |
| Worker physical identity | Keep the existing script and STREAM_HUB namespace | Cosmetic repo/frontend rename must not create a new state namespace |

The target wrangler.jsonc describes classes, the new GlobalBudget migration and public variable names. **Do not deploy it under a new script name as a rename operation.** The prepared ignored .artifacts/frontline-2d/worker-in-place.jsonc targets the existing physical script ansem-frontline-stream, retains migration v1, appends the new budget binding/migration and preserves both original allowed origins during transition. Its live allowlist is empty and build ID is a replacement marker. Before an authorized cutover, verify actual deployment state and namespace IDs, choose the approved mint(s), set the accepted build ID and add the assigned neutral facade origin; record namespace IDs only in private operator evidence. Never delete/recreate Durable Objects to achieve the new brand. The physical resource name may remain historical; the final browser endpoint is the verified neutral HTTP facade.

## Authorized cutover sequence

1. Record exact candidate SHA, artifact hashes, current Vercel deployment ID, Pages deployment, Worker version and DO namespace IDs. Keep immutable rollback artifacts. Confirm art/history review and approval scope first.
2. Recheck repo/alias availability. Disable automatic production promotion during preparation if the approved workflow requires it; do not use a push as backup. Prepare a PR from the accepted local branch only when remote publication is authorized. A push may trigger Vercel; main updates may trigger Pages, CI and CodeQL.
3. Update the existing Worker in place with the compatible v4 contract and persistent global budget. Set HELIUS_API_KEY using the provider's secret store only; set exactly two or fewer LIVE_TOKEN_MINTS, exact ALLOWED_ORIGINS and WORKER_BUILD_ID. Keep mint object names and epochs stable. Verify budget denial before upstream sends and healthy/degraded responses.
4. Assign and verify a neutral Vercel origin and an HTTP /relay rewrite to the existing backend. The bounded portfolio uses polling, avoiding an unverified WS proxy claim. Verify Origin/CORS, 429 Retry-After, no cache of degraded responses and no secret exposure in responses/logs. Keep the previous backend endpoint temporarily compatible for old clients, without exposing it in the new experience.
5. Set the actual VITE_RELAY_ORIGIN to that assigned origin, VITE_STREAM_URL=disabled, and rebuild both root and Pages variants. Review resulting exact hashes before promotion; a configuration change creates a new artifact. Test deterministic optimized variants again. Narrow CSP connect-src from the currently permitted Worker compatibility pattern to the assigned HTTP facade plus DexScreener. No unsafe-eval is needed.
6. Rename the repository to frontline only after availability/approval checks, update origin locally, About/homepage, CI links and Vercel repository association. The prepared Pages workflow uses /frontline/. GitHub project Pages URLs need explicit verification; repository redirects alone do not prove a working site.
7. Publish accepted artifacts through the authorized PR/CI/merge/release/deployment path. Verify CI and reproduce served hashes at the final main, Pixel, favicon/manifest/social image and battlefield resource URLs. Perform a bounded read-only smoke on the actually served relay/mint and report coverage/age without inventing activity. Verify both the new route and rollback route.
8. Retire old user-facing aliases only after the observation period approved at cutover. Do not rename an account subdomain or another service implicitly.

## Rollback

Restore the previous frontend deployment/artifacts and its known configuration. Restore Worker code/version while retaining the existing STREAM_HUB namespace, epoch state and appended budget storage. If a new budget causes an outage, leave live explicitly degraded and Demo available; do not bypass the governor to make a green screenshot. Repository-name rollback, alias changes and redirects are separate operator actions, requiring their own verified URL checks. Do not reverse storage migrations destructively or rewrite commits.

Official references: [Cloudflare storage transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) and [GitHub repository renaming](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository).

## Approval still needed

Acceptance of the exact visual/technical candidate; decision/permission for selected generated media and retained historical material; and explicit authorization for the listed remote writes and endpoint cutover. No external publication has occurred in this implementation pass.
