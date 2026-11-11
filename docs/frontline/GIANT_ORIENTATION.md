# Giant orientation correction — 11 November 2026

The accepted 1a08536 candidate could rotate a giant away from its opponent while the surrounding bodies pushed it backwards or sideways. The fault affects both families and belongs to numerical facing, rather than the bear model's front/back geometry.

The locomotion finalizer previously preferred resolved travel whenever speed exceeded its dead zone. The battlefield supplied an explicit rival direction, but that direction was only used at rest. Crowd separation can generate displacement while an actor deliberately holds its attack range; using that displacement as a new heading makes the body turn away and can interrupt the attack.

The battlefield now explicitly prefers its current rival's direction. All final body positions are bounded before calculating that direction, so iteration order and pre-separation coordinates do not drive facing. Turning remains rate-limited. Travel direction and stride still use actual resolved displacement, allowing a visible backstep without turning the torso away. Actors without a rival, including retiring swaps, retain travel-facing behavior. The locomotion default is unchanged for callers that do not opt into target-facing priority.

This changes presentation targeting/contact progression where the previous facing gate suppressed attacks. It does not change price, pressure, supply, valuation, admission, mint isolation or the market journal. Neither rig callbacks nor rendered contacts gain authority. Solusser source and its pending pilot acceptance remain untouched.

## Evidence

The original optimized application was captured for 38 seconds with HTTP/WS blocked before navigation. In nearby, non-retiring bear giant observations with a target stable for at least approximately 500 ms, 91 of 427 samples faced more than 90 degrees away from the rival. A separate deterministic peak replay also reproduced the problem in bull giants. Those replay cohorts are not a universal defect-frequency measurement.

The corrected optimized application was captured for 100 seconds on desktop, including the next giant bull in the normal Demo sequence, and for 38 seconds in mobile emulation. The same observation filter found zero away-facing samples among 201 bull and 578 bear desktop observations, and 433 bear mobile observations. All captures had zero page/console errors and zero external requests. Mobile's short sequence did not include a nearby bull giant; the desktop capture and symmetric numerical tests cover that case.

Three regression cases were added: mirrored bull/bear backstep-and-slide checks, and both large-swap families facing a current rival in a crowded field for 2,400 fixed steps. Final npm run check passes lint, 820 unit tests across 49 files, 22 optimized E2E with no skips/flakiness, root/Pages builds and bundle guards. GL1 context restore and Canvas fallback remain covered by E2E. The targeted clips use GL2; this is not new physical-device or cross-browser certification.

Private raw samples, screenshots and before/after webm files are under the existing private visualization directory's frontline/giant-orientation folder. Ignored numerical/browser drivers and result JSON are in .artifacts/giant-orientation. The prior candidate's performance table is retained as dated evidence for 1a08536, not relabelled as a new timing campaign for this correction. Native backward-motion counters are not used as a gait failure gate.

## Acceptance and publication

The user accepted the candidate, requested this correction in both families and instructed publication to proceed after verification. This follow-up is within that accepted scope. The source pilot remains private. Publication authorization does not replace credential access: Cloudflare and Vercel must be accessible before changing their live configuration. Existing Worker/DO identity must be preserved as specified in RELEASE.md.
