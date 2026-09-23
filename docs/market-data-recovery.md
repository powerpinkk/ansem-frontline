# Production market-data recovery

This recovery keeps the version-4 public envelope and adds `health.schemaVersion = 1`. It does not change the provider, accept provider prices as execution authority, or persist canonical snapshots as fresh data.

## Acquisition contract

- One token-scoped Durable Object coordinates standard JSON-RPC work. DAS has an independent cooldown and rolling budget.
- Standard RPC starts are limited to two concurrent requests, at least 250 ms apart, and 162 per rolling 60 seconds. DAS starts are limited to one concurrent request, at least one second apart, and four per rolling 60 seconds.
- A 429 opens a shared group cooldown. `Retry-After` seconds and HTTP dates are honored; a longer provider deadline is never shortened. After expiry, exactly one necessary real read may make the half-open provider-group probe.
- Timeout, network, 5xx, JSON-RPC, and malformed-response failures use bounded retries. Authentication/configuration failures do not retry rapidly. Valid empty history and valid `getTransaction: null` responses are not transport failures.
- Cooldown state and bounded historical gap metadata survive a Durable Object restart. Canonical snapshots and the execution journal remain intentionally non-durable.
- Admission uses a bounded per-group queue and makes its final cooldown, half-open, capacity, spacing, and rolling-budget checks atomically. A queued request always rechecks after waiting, so a newly opened cooldown prevents it from starting.
- An expired shared cooldown admits exactly one necessary real read as the provider-group probe even when the originally failing job no longer exists. That success reopens only transport admission; evidence jobs still require their own verified read or an explicit unknown/gap outcome.

Stable PumpSwap identity is fully rediscovered and revalidated at cold start and no more than once per 60 seconds. Its atomic pool, mint, vault, live-supply, variant, and fixed-oracle observation refreshes no more than once per 10 seconds. Pump curves retain their full 10-second lifecycle check. Other supported AMMs retain 60-second discovery and gain no valuation formula.

`/market` is served by the same token object without triggering canonical discovery. Its normalized token/SOL DAS pair is coalesced for 30 seconds and keeps the original observation timestamps. Failures are `no-store`, sanitized, and expose `Retry-After` plus `error.retryAt` when available.

## Health and authority

The schema-v1 capability object reports discovery, market state, USD quote, canonical valuation, execution acquisition, and Terrain authority independently. Each acquisition capability includes current status/reason and attempt, success, failure, and retry times. Lifetime counters and historical gaps remain diagnostic evidence; they do not permanently determine current health.

Protocol unit price and protocol market cap use the same verified atomic inputs. Unit price uses integer/rational arithmetic over effective quote reserve, verified base reserve, live token and quote decimals, and the fixed FULL/confidence-valid Pyth observation. It is not an executable fill price. Provider price/FDV remain separately labelled indicative.

A complete healthy 60-second observation window with fresh canonical state/quote and zero executions is `QUIET`: price and protocol market cap remain authoritative, Terrain remains live, and no directional pressure or combat evidence is generated. Pending work or a current gap is recovering/partial. Old gaps remain in historical diagnostics without poisoning a later complete window.

Unclassified, unsupported, or unproven execution evidence makes only its affected current window incomplete and creates a bounded historical gap. A later independently complete 60-second window can recover without clearing that gap or lifetime counters. Valid `NON_SWAP` and on-chain `FAILED` results complete acquisition without creating executions.

On authority loss, Terrain holds its last presentation coordinate, clears traversal and impact evidence, and produces no movement. The first valid observation after the gap is a silent `STATE_RECONCILIATION` baseline.

## Deterministic request ledger

The focused replay in `tests/recovery-budget.test.js` uses one active token, one stable PumpSwap pool, zero candidates, fake time, and real protocol fixtures:

| Scenario | Standard RPC | DAS | WS |
| --- | ---: | ---: | ---: |
| Cold canonical `/recent` | 5 | 0 | 0 |
| Post-cold first-minute tail | 7 | 0 | 0 |
| Next steady 60-second window | 13 | 0 | 0 |
| 32 simultaneous same-token `/market` viewers | 0 | 2 | 0 |

The steady window is measured through the real governor and contains one four-request full refresh, five due atomic state reads at the paced boundary, and four history reads. A finalized signature with one transient transaction retry measured three `getTransaction` starts and one status batch; the no-fault normal path remains two transaction reads plus status. Transaction and status work is additive and remains bounded by 120 transaction starts and 20 status batches per rolling minute. Counts are per token object; account-wide traffic is the sum across tokens and other provider consumers.

Indicative acquisition coalesces normalized data rather than a Fetch `Response`; each HTTP caller receives a fresh independently consumable body. Success remains cached for 30 seconds with its original timestamps. Errors and no-safe-pool results remain uncached.

## Manual publication checklist (not authorized by this change)

1. Obtain explicit publication authorization and authorized Cloudflare credentials outside the repository: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Confirm the existing Worker-side `HELIUS_API_KEY`; never copy it into source, frontend configuration, logs, or reports.
2. Record the candidate Git SHA, `ansem-frontline-worker-recovery-v1`, the current Cloudflare Worker version/deployment ID, the previous frontend deployment IDs, and checksums of the candidate Worker dry-run and frontend `dist` artifact.
3. Run lint, the full unit suite, production build, controlled desktop/mobile E2E, focused streaming recovery tests, and `npx wrangler deploy --dry-run --config worker/wrangler.jsonc --outdir ../.artifacts/worker-recovery`.
4. Deploy the compatible Worker first. Verify `/health` reports envelope 4, health schema 1, and the expected build ID. Make one bounded `/market` and `/recent` acquisition check and, if needed, one short subscription session. A public 200 alone is not canonical-acquisition proof.
5. Deploy the identified frontend artifact only after Worker verification. Verify new-frontend/new-Worker behavior and preserve the prior frontend deployment for rollback.
6. If verification fails, restore the recorded previous Worker version and previous frontend deployment. Do not change provider, quota, credentials, or acceptance gates during rollback.

No push, merge, Worker deployment, or frontend publication is performed by this recovery implementation.
