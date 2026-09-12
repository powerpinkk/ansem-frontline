# Market data integrity — M10.1

**Status: BLOCKED — VERIFICATION COVERAGE.** The four original integrity defects have regression coverage and safe replacements. M10.2 is not authorized by this result. In the bounded public-chain sample, positive end-user verification is demonstrated for PumpSwap direct and CPI sales; the sampled DLMM and Whirlpool routes are either non-swap mentions or cannot be normalized by the supported economic-owner model. Their exclusion is intentional, but is not proof of adequate market coverage.

## A. Baseline
Started at `bf8ff6a6dc1a4bf664df96862e361bb3d0e62777`, equal to local main and origin/main. The original terrain branch was empty, clean, and had no upstream. Renamed locally to `feat/m10-market-data-integrity` before implementation. No terrain implementation existed. The earlier M10 audit stopped on data integrity.

## B–C. Reproduced failures and causes
Nine regression cases were run and failed before the fixes in `tests/integrity-regression.test.js`.

| Defect | Cause | Required boundary now |
| --- | --- | --- |
| Reordering pairs changes 1M to 20M at the same relevant price | Display valuation came from an array-first provider entry, separate from pool/price choice | A deterministic primary pair supplies both price and typed valuation |
| FDV shown as MC | Provider fields and total-supply multiplication shared legacy mcap | MARKET_CAP, FDV, UNKNOWN; mcap is populated only for provider MARKET_CAP |
| Same transaction changes USD with browser price | Balance-derived amount multiplied by client price in the server parser | No client market arguments enter verification; quote transfers precede any USD estimate |
| Transfer/airdrop/LP-like delta becomes buy/sell | Sign of balance movement treated as swap proof | Successful supported swap invocation plus scoped SPL transfers and explained tracked-token net |

The original unproved delta fixture is rejected at all three client prices (.001, .020, 999). A separate positive, raw-protocol swap fixture proves that an actual accepted event also remains identical at those prices.

## D. Architecture
Browser discovery uses public DEX Screener data for indicative market display. Gecko supplies an indicative chart only. Helius DAS is a fallback for metadata and price, with total-supply FDV explicitly distinguished from MC.

The browser sends only the requested Solana mint to the Worker. Both `/recent` and `/stream` resolve the same mint-scoped Durable Object. The server independently discovers candidate pools, checks their account owners through RPC, and subscribes to logs. Logs and signature history supply candidates, never trade proof. The same raw transaction verifier and settlement journal process both paths. This replaces the independent legacy history parser and client-trusting stream configuration.

## E–F. Selection, hysteresis and epochs
Input pairs are treated as an unordered set. Eligibility requires Solana, tracked base mint, valid pair address, supported exact quote mint, positive finite price and liquidity. Supported quotes are wrapped SOL, USDC and USDT by mint, never by symbol. Reverse pairs where the tracked token is only the quote are unsupported.

Rank by liquidity, then hourly volume, then address. Conflicting duplicate pair identities are rejected. More than 500 input pairs is rejected; at most five pools are tracked. Retain a valid incumbent unless a challenger has at least 25% greater liquidity; invalidate a missing/ineligible incumbent immediately. Twenty-four permutations of four pairs and threshold oscillation tests establish order independence and stability.

Selection preserves token/pair/dex/base/quote, liquidity, reason, selection time, source and epoch. Server owner verification is a separate compatibility check; provider liquidity is not an on-chain fact.

Valuation has its own token-local epoch. Pool/provider/kind/supply-basis changes rebase it. A greater-than-1% change in implied value/price supply basis also rebases; this is a documented conservative discontinuity heuristic, not a claim to know circulating supply. Coherent 20x changes in price and value do not rebase merely for being large. No rebase creates a trade or a market shock.

## G–H. Typed valuation and MC/FDV proof
`CanonicalValuation` carries token, market identity, kind, value USD, price, supply basis, source, raw provider fields, observation/receipt times, epoch, freshness and provenance.

Valid provider marketCap wins as MARKET_CAP; otherwise valid fdv becomes FDV; neither becomes UNKNOWN with a null value. Total supply times indicative price produces FDV only. Unsafe numeric raw supply is not silently accepted as exact supply. The compatibility mcap field stays null for FDV and UNKNOWN. The main and Pixel displays label the actual kind and show an em dash for unavailable values.

All current provider valuations remain PROVIDER_INDICATIVE and authorityEligible=false. A provider-reported MC is not an independently audited circulating MC. DEX Screener exposes no current snapshot timestamp, so observedAt remains null; pairCreatedAt is never reused as observation time. Receipt older than 30 seconds becomes stale. Timestamp regression, invalid numeric values, mismatching token and selection identity are rejected. Cache is display-only and stale; it never hydrates trade authority.

## I. Client trust boundary
Mint is a request identifier. Prices, buy/sell labels, USD size, pools, program allowlists, arbitrary endpoints and settlement supplied by a client are discarded. Configuration is bounded to 8,000 characters and validated against the Durable Object mint. Server transport uses fixed RPC/provider hosts and an environment secret. Browser prices cannot corroborate themselves.

The deployment contract is version 3. Older Worker messages and older history/cache formats are rejected. Frontend and Worker require a coordinated future deployment; this milestone performs none.

## J–L. Evidence and protocol verification
Evidence preserves signature, slot, nullable chain block time, settlement, signers, relevant programs/instruction indexes, actual raw token and quote quantities/decimals, token net delta, ancillary native deltas and verification provenance/version. Worker observedAt/receivedAt and journal receipt time are separate from chain time. Native balance changes can include fees/rent and never substitute for swap quote quantities.

Adapters use documented fixed IDs and swap discriminators:
- PumpSwap: buy, sell and buy_exact_quote_in; pool, mint and vault account layout.
- Meteora DLMM: swap/swap2 and supported exact-out/price-impact variants.
- Orca Whirlpool: swap and swap_v2.

A successful runtime invocation and successful ancestor chain are required. Direct child SPL token transfers must touch the documented vaults, match mint/decimals, succeed, and have opposing base/quote economic directions. Failed or caught failed CPI, unknown programs, missing/truncated evidence, plain transfers, airdrops, mint/burn and LP-like deltas produce no authoritative event.

Raw integers are parsed with BigInt and bounded to u64; display quantities are approximate Number conversions. Token-2022 checked transfers are supported only when observed exact net flows agree and no transfer hook is involved. Transfer fees, hooks or unexplained deltas are rejected. This matters because the captured ANSEM transactions use Token-2022.

The verifier trusts the configured RPC response, rather than independently executing a Solana light client. RPC compromise is outside this trust boundary.

## M–N. Routes and direction
Direct and nested CPI swaps are supported when the tracked-token recipient/spender can be assigned to one transaction signer and all relevant legs have one direction, quote mint and owner. Multiple compatible legs aggregate to one tracked-token net event. Intermediate-token round trips and unrelated token transfers cannot become multiple fictional trades.

Shared router accounts owned by PDAs, unresolved final recipients, mixed directions/quotes and net mismatches are unsupported. In particular, recognizing a Jupiter CPI does not prove end-user economic attribution. The public Whirlpool examples hit this limitation. BUY means the signer receives the tracked token through the proven swap; SELL means spending it. These constraints establish a safe subset, not full Jupiter coverage.

## O. Quote and USD provenance
The authoritative quote quantity is the pool-side gross quote flow. It may include protocol fees and is not a claim about the user's total route expense. SOL quantities remain lamports plus decimals; stablecoin quantities retain their actual mint and units. Stablecoin trades never acquire a fabricated SOL equivalent.

Canonical events currently leave USD unknown. `js/notional.js` provides a separate optional estimate contract: stablecoin parity is explicitly an assumption; an independent SOL/USD spot quote must identify its source and recent receipt. This helper is not wired to acquire a live quote. The UI displays USD — rather than multiplying tracked-token amount by a browser price. Any future estimate is marked approximate and does not affect swap verification or pressure.

The prepared corroboration classifier can distinguish source rebase, unavailable, uncorroborated, disagreement and independently corroborated execution price. It does not certify supply or make MC authoritative, and is not a live corroboration service.

## P–Q. Settlement and reconciliation
Confirmed RPC data can produce a provisional event immediately. Every three seconds, bounded batches inspect signature statuses. Finalized status triggers another transaction read at finalized commitment and the same verifier. Same identity upgrades to FINALIZED; it is never a second trade.

Failed/inconsistent finalized evidence invalidates the prior event. Missing/repeatedly unavailable evidence or an unresolved 90-second reconciliation deadline becomes RECONCILIATION_UNKNOWN. Derived pressure is rebuilt from active journal events. The presentation can remove the corresponding entity/feed row; it never generates an opposite trade. Historic cosmetic animations already shown cannot be undone in time. A finalized record cannot be downgraded by a late confirmed replay.

## R–S. Identity, replay and bootstrap
Identity is tracked mint + signature + net-v1 discriminator. Dedup applies before expensive verification and again at the client journal. Slot orders observations; browser arrival time does not reorder chain events.

The record/journal limit is 1,024 entries per token, with a five-minute maximum age and 128 queued initial candidates. Replays do not refresh the record age. Bootstrap uses bounded getSignaturesForAddress queries with per-pool cursors and the same verification service as live logs. A full 12-item page marks an unproven history gap. Recent responses explicitly use no-store, including after CORS headers are applied.

The Durable Object journal is in memory. Restart may lose replay/reconciliation context; bounded history can recover some events, but durable exactly-once delivery and gap-free replay are not promised.

## T–U. Pressure and degraded states
Pressure includes unique active CONFIRMED/FINALIZED trades with real timestamps within 60 seconds. Failed, unknown, unverified, future and duplicate events contribute nothing. Existing pressure units remain actual SOL pool flow. Verified USDC/USDT swaps are visible but excluded from SOL-weighted pressure; diagnostics count that exclusion. No synthetic USD/SOL conversion fills it.

Provider activity counts and Gecko chart remain indicative displays. They are not canonical executed trades.

Missing adapters/evidence, RPC failure, queue/budget overflow and history truncation set degraded diagnostics. Coverage degradation is conservative and remains sticky for the active service; recovery does not prove an old gap was filled. Observational freshness can recover with a valid new market response.

## V. Token isolation
Selections, valuations, epochs, journals, subscriptions and reconciliation are scoped to mint. Destroying a browser runtime aborts pending fetches, stops its stream and clears its timers; late results are ignored. Tests cover ANSEM, USDC, JUP and an additional valid mint in the test-only soak. Identity checks prevent foreign-token history from entering the active journal.

## W. Performance and cost
No new dependency, database, paid provider or subscription was introduced. Current per-active-mint limits:
- At most five pool subscriptions, 64 browser sockets, two concurrent transaction reads.
- At most 120 getTransaction reads per minute, including finalization and retries.
- At most one status request every three seconds, carrying up to 50 signatures.
- At most five signature history requests per 15 seconds, 12 signatures per pool.
- Successful market discovery/owner checks cached for 60 seconds; RPC requests time out after eight seconds.
- Initial null/error reads retry at most three times with backoff. Reconnect delay grows from one to 30 seconds. Client watchdog is 30 seconds; idle services stop after 120 seconds without clients.

Thus saturated transaction verification alone is capped at 172,800 reads/day/mint; statuses and signature discovery add up to 28,800 each/day/mint while continuously active. Two successful transaction reads per finalized trade imply a ceiling around 60 newly finalized trades/minute before retries. Actual observed demand and paid-credit pricing were not measured; these are request ceilings, not a free-tier cost guarantee. Browser DAS fallback calls and discovery are additional.

Per-mint bounds are not a global account quota. Many distinct requested mints multiply cost. This is a deployment/operations limitation; no global admission service was added. When load exceeds the budget the system exposes partial coverage instead of inventing a complete feed.

## X. Public-chain validation
Read-only public mainnet RPC capture on 2026-09-12 obtained 23 successful candidate transactions from the current PumpSwap, Meteora DLMM and Whirlpool pools at finalized commitment. Pool account owners were independently requested. [The sample register](market-data-samples.json) records every signature, slot, protocol, mint, settlement, outcome/rejection reason, accepted direction/raw amounts and capture provenance.

Four PumpSwap sales were accepted. Two direct and two CPI sales agree with an independent signer token-balance calculation. Representative exact checks:
- Slot 446437184, signature 4YquguNEKkyksSma6sB7boFkj1gP4cLVXF1CUEgqi1K7Yx5sqdPk9Wr4naeHYaRyi1BbKBxwAcf1PfJfw3D1gGkN: tracked raw -126000000; gross quote 182115486 lamports.
- Slot 446442038, signature 4hRRByUJeR5cyfHc9L5C2PJywyCxv1UJaWHMcA3221wDG1cVa8x647xi1VDUdy7BR43VPqsTiPFnVTG2XXqdLXzu: tracked raw -300000000; gross quote 433333074 lamports, nested CPI.

The checked quote totals come from scoped SPL transfers and independently match the wrapped-SOL vault balance changes (-182115486 and -433333074 raw units) at vault DaXhQ3pfN3J5dQnXxVU8YqW9bwA3RUVxXvq2iBjTDVt4, with nine decimals. They are inspectable in the committed raw public fixtures. Four representative fixtures (positive direct/CPI and negative DLMM/Whirlpool) are preserved for offline replay. Tests assert literal expected quantities and independent balance arithmetic rather than taking expected values from the verifier.

Nineteen candidates were rejected. This is not a measured false-negative rate or volume coverage percentage: mentions include non-swaps and arbitrage. No accepted real buy, DLMM or Whirlpool end-user event was demonstrated in this bounded sample. Deterministic protocol fixtures passing is not a substitute for that missing external coverage.

## Y. Security
Fixed upstream endpoints; validated mint/signature; fixed protocol tables; independently discovered pools; secret stays in Worker environment. No client-provided valuation, signature status or swap conclusion is promoted. Origin checks remain. Candidate limits, timeouts and per-mint budgets bound work. Caches cannot resurrect trusted historic events. A malformed or unsupported observation fails closed.

## Z–AC. Validation
Regression tests were introduced red before the fixes. The final verification record is maintained below. Tests use raw protocol-shaped fixtures separately from UI fixtures representing mocked version-3 Worker responses. Test-only data never enters production.

The first broad browser run overlapped development edits and six WebGL workers, so its failures were not accepted as a final baseline. A subsequent sandbox launch failed with EPERM before browser execution. The final suite is run with frozen browser code, one worker and the required local browser permission; assertions are not weakened to pass.

A 60-second, test-only ingestion soak completed 951 cycles across four tokens (1.0567 virtual hours), 76,080 duplicate/replay deliveries, 11,412 mocked RPC reads and 7,608 event/update publications. Maximum retained records was 76 per token; all queues finalized and teardown emptied every journal. This demonstrates bounded local mechanics, not provider uptime or a production Helius soak. WebSocket reconnect and cancellation are covered separately by lifecycle tests.

M4–M9 scene, theme, studio, Champion, navigation and Pixel/PiP tests remain in the complete E2E suite. No new combat/terrain/theme art was introduced.

Final checks:
| Check | Result |
| --- | --- |
| Lint | Passed |
| Unit suite | 30 files, 230 tests passed |
| Production browser build | Passed |
| Complete E2E run | 61 passed, 34 existing device skips, one obsolete whole-diagnostic equality assertion failed |
| Corrected E2E assertion | Focused last-failed run: 1 passed; comparison still checks runtime and renderer resources |
| Final affected-view smoke | Hidden/resume and MC/FDV/settlement checks passed after reconciliation adjustments |
| Soak and reconnect | 60-second soak above; 100 reconnects and silent-socket timeout tests passed |

Thus all 62 applicable E2E cases have passing evidence across the complete run and focused rerun; this is not a claim that the original complete command exited successfully. The unit suite also fixes a fixture-clock race by supplying the same explicit timestamp to a non-SOL pressure fixture.

## AD. Documentation and official contracts
Primary sources consulted for implementation:
- [DEX Screener API](https://docs.dexscreener.com/api/reference) — separate nullable marketCap/fdv and provider pair fields.
- [DEX Screener token listing](https://docs.dexscreener.com/token-listing) — FDV and circulating/self-reported supply semantics.
- [Helius getAsset](https://www.helius.dev/docs/api-reference/das/getasset) — cached price metadata; documented price cache is 600 seconds, so receipt is not source observation time.
- [Solana commitment](https://solana.com/docs/rpc) and [signature statuses](https://solana.com/docs/rpc/http/getsignaturestatuses) — confirmed and finalized are distinct.
- [Solana logsSubscribe](https://solana.com/docs/rpc/websocket/logssubscribe) — address mentions are candidates.
- [Solana token supply](https://solana.com/docs/rpc/http/gettokensupply) and [Token-2022 transfer fees](https://solana.com/docs/tokens/extensions/transfer-fees).
- [PumpSwap official IDL](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump_amm.json).
- [Meteora DLMM official IDL](https://github.com/MeteoraAg/dlmm-sdk/blob/main/idls/dlmm.json).
- [Orca swap](https://github.com/orca-so/whirlpools/blob/main/programs/whirlpool/src/instructions/swap.rs) and [swap v2](https://github.com/orca-so/whirlpools/blob/main/programs/whirlpool/src/instructions/v2/swap.rs).
- [GeckoTerminal FAQ](https://apiguide.geckoterminal.com/faq) — public rate limits and incomplete MC metadata.

## AE–AG. Files, diff and commit
Browser boundaries live in market-selection, market-valuation, market-evidence, market-api and notional modules. Worker boundaries live in server-market, protocol-verifiers, transaction-evidence, evidence-ingestion and stream-hub. Existing API/parser entry points retain compatibility facades with the new semantics. Existing UI, main and Pixel code changes are limited to truthful data display and reconciliation. Unit/E2E fixtures, public samples and capture/soak scripts support reproducibility.

Use `git diff bf8ff6a6dc1a4bf664df96862e361bb3d0e62777 --stat` for the complete committed file inventory and `git rev-parse HEAD` for the local completion commit. The response accompanying this document records its SHA. No push, PR, merge, deploy, tag or release.

## AH–AI. Remaining limits and exact readiness
Coverage of shared-account router economics is blocking. Before M10.2, implement and externally demonstrate attribution for the routes required by the actual market, with positive public buys and sells for each claimed supported family and measured coverage against the current candidate stream. Preserve all negative tests.

Further limits: current valuation is indicative, circulating supply is not independently certified, independent USD quote/corroboration acquisition is not live, non-SOL trades do not weight SOL pressure, provider timestamps can be unknown, in-memory restart can lose gaps, and per-mint budgets are not global billing guarantees. These facts must remain explicit when choosing future terrain authority. No value-to-world mapping is implemented.

M10.1 BLOCKED — VERIFICATION COVERAGE
