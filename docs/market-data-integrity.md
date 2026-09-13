# Market data integrity — M10.1

**Current status: M10.1 BLOCKED — MATERIAL VERIFICATION COVERAGE.** The dedicated M10.1b section below records the router increment and its measured limits. M10.2 is not authorized. The earlier M10.1 audit is retained as history; in particular, its acceptance of unknown-wrapper CPI sales has been superseded by stricter attribution.

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

## M10.1b — Router economic attribution and measured coverage (2026-09-13)

This section supersedes the earlier routing support/readiness statements, while preserving the M10.1 audit as history. The bounded implementation passes its deterministic gates. **The market-data milestone is still blocked by material verification coverage; this is not permission to build or release M10.2.** No live positive shared-route acceptance was demonstrated in the public sample.

### A–B. Baseline and reproduced blocker

Work remains on `feat/m10-market-data-integrity`, starting from the intact `3a16c4aff2741e63139474ee29951137a19d7fb7`. Both main refs remain `bf8ff6a6dc1a4bf664df96862e361bb3d0e62777`. The complete prior audit was read before editing. Running the original verifier from that commit against the new independently encoded shared direct, multihop, split and intermediate fixtures reproduces `ECONOMIC_OWNER_NOT_SIGNER` in all four cases. The new endpoint boundary resolves these deterministic cases without assigning a shared PDA to a user.

The original fixtures' one-byte mock Jupiter instruction was not a documented routing format. It has been replaced with independently encoded actual V2 instructions. The old accepted non-Jupiter CPI sale `4hRRByUJeR5c…` now fails `UNSUPPORTED_ROUTER`: signer balance agreement alone cannot prove an unknown wrapper's intent. The original direct sale remains accepted with the same independently checked raw quantities. No negative assertion was relaxed into acceptance.

### C. Current official research and the pinned on-chain IDL

Swap V2 `/build` replaces the legacy two-call integration, uses `taker`, defaults to V2 instructions and supports ExactIn. Its routing weights are basis points. API version does not erase historical on-chain instructions. No legacy API client was added. [Jupiter migration contract](https://developers.jup.ag/docs/swap/migration/metis-to-build).

The Meta-Aggregator can choose execution paths beyond the Jupiter Aggregator AMM program. A passive public observer cannot assume every winning router has Jupiter's account semantics or access someone else's `/execute` result/request ID. This implementation consumes public RPC only. [Jupiter order and execute](https://developers.jup.ag/docs/swap/order-and-execute). Separate payer and taker are supported explicitly by the integration contract and remain separate in attribution. [Jupiter gasless documentation](https://developers.jup.ag/docs/swap/advanced/gasless).

The inspected official `jupiter-cpi`, `instruction-parser`, `jupiter-amm-implementation` and CPI example repository IDLs lacked V2 instruction definitions. They were not silently treated as current. Jupiter's own announcement points to the program IDL and states that V1 on-chain instructions remain valid. [Jupiter program update](https://t.me/s/jup_dev?before=157), [program IDL view](https://solscan.io/account/JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4#programIdl). The explorer's dynamic IDL data could not be retrieved here; its API returned HTTP 403. No explorer decoding is claimed.

Instead, finalized public mainnet RPC returned the IDL account `C88XWfp26heEmDkmfSzeXP7Fd7GQJ2j9dDTUsyiZbUTa`, owned by `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4`, at slot **446570768**. The retained compressed account bytes, owner, slot and SHA-256 are in [jupiter-idl-provenance.json](jupiter-idl-provenance.json). The uncompressed JSON hash is `3f0edbf2d65ec7be16b655348bcf63af70f3e64d19c68d9535048808167cc460`. A second read at slot 446598952 matched. The account uses the existing Anchor IDL seed/account layout; current documentation API branding is unrelated to this binary account format. [Anchor v0.31.1 IDL address and layout](https://github.com/coral-xyz/anchor/blob/v0.31.1/ts/packages/anchor/src/idl.ts).

`worker/src/idl/jupiter-v6.js` retains the eight non-ledger route definitions (V1/V2 × ordinary/shared × ExactIn/ExactOut) and type definitions from that snapshot. A bounded Borsh interpreter follows named fields and enum definitions. Tests compare every instruction definition with the retained RPC payload and independently derive its Anchor discriminator. Unknown enums/types/versions, oversized vectors, malformed/trailing bytes and unsupported ledger instructions fail closed. The snapshot is static; `scripts/check-jupiter-idl.mjs` is a manual read-only drift check, never an automatic trust upgrade.

### D–G. Economic endpoints, authority, account classes and token role

The router boundary adds authority, input/output mint, exact raw executed quantities and decimals, named source/destination, actual destination owner, ExactIn/ExactOut context, quoted context, instruction/version, route plan, account classes and proof provenance. Quote context is explicitly not execution.

The economic authority comes from the router's named `user_transfer_authority`, must be a transaction signer, and must own the source account. Delegated/non-signer authorities are unsupported. It is never chosen as the payer, first signer, largest delta or owner of a shared account. Direct DEX events also require their documented authority account to match the tracked-token owner, with a compatible user quote flow.

Source/destination accounts are USER_ENDPOINT. Accounts with documented router authority and conserved routing flow are SHARED_ROUTER_ACCOUNT; signer-owned intermediates are USER_ROUTING_ACCOUNT. Documented DEX vaults are POOL_ACCOUNT. Successfully initialized/closed ephemeral wSOL accounts are TEMPORARY_ACCOUNT, with lifecycle instructions preserved. Unknown owners remain UNKNOWN and reject the route. Fee-bearing routes currently fail closed rather than guessing FEE_ACCOUNT roles or net amounts.

The tracked token's proven endpoint role is INPUT → SELL or OUTPUT → BUY. A fully verified route using it only between endpoints returns NON_DIRECTIONAL / INTERMEDIATE with route evidence and no canonical event. NOT_INVOLVED is also non-directional. Unknown or partially decoded routes do not acquire a verified intermediate classification merely from a hint. User economic direction and pool price effects are distinct: these exclusions do not suppress the separate indicative valuation pipeline, and no synthetic market effect is created.

### H–K. Direct, multihop, split and intermediate proof

The existing PumpSwap, DLMM and Whirlpool adapters extract documented swap invocations and their direct-child transfers. For Jupiter they can extract all route legs, including those not touching the tracked mint. There is no second set of DEX parsers. Route-plan protocol/order/index/mint/weight checks, full leg count, successful invocation ancestry and connected source-to-destination transfer paths must agree. Non-vault intermediate flow must conserve exactly; residuals and disconnected flows reject.

The deterministic shared direct route spends raw 1,000,000,000 input units and delivers raw 200,000,000 output units. A two-hop route preserves those endpoint amounts rather than using the intermediate quote. A 40/60 split aggregates both legs into the same one event. Identity remains `mint:signature:net-v1`; multiple router invocations/authorities in a transaction are rejected, so the key cannot combine different takers. Transfer ordering that preserves semantics leaves canonical economic evidence unchanged.

The mandatory SOL → tracked → USDC shared fixture produces INTERMEDIATE, no BUY/SELL, no pressure and no future impact eligibility. The public `doqiTDJ9hQ24…` instruction also names SOL as input and another mint as output, with ANSEM in between; its fee-bearing/incompletely supported execution remains unsupported, not a verified intermediate event.

### L–M. SOL/wSOL, custom destination and execution modes

Swap size comes from successful scoped SPL transfers. Signer lamport deltas remain ancillary because they include fees, priority fees, tips and rent. Missing ephemeral wSOL balance identities are recovered only from successful SPL initialization; a successful closure is required. The tests include ATA setup, explicit system funding and syncNative, opening/closing wSOL, separate payer, fees and tips for SOL → token and token → SOL. These costs never enter canonical quote quantities. [SPL Token instruction semantics](https://github.com/solana-program/token/blob/main/interface/src/instruction.rs).

This remains a conservative subset: pre-existing wSOL accounts funded or closed in ways that prevent exact account/owner net reconciliation may be rejected. Raw compiled transfer/transferChecked is decoded, while native-account initialization/closure must be available as parsed RPC instructions. The production transport already requests jsonParsed. Arbitrary native-destination wrappers and unexplained native flows remain unsupported.

A named destination owned by another recipient can be accepted only with complete intent and transfer proof. The event wallet remains the authority; `destinationOwner` retains the other owner and `AUTHORITY_SELECTED_RECIPIENT` states the actual attribution. No ATA ownership assumption is made. All same-owner/mint account deltas are aggregated as a cross-check; unrelated activity that prevents exact reconciliation rejects the route.

ExactIn requires executed endpoint input to equal the encoded input; ExactOut requires the executed output to equal the encoded output. The opposite quoted quantity never supplies executed size. Nonzero platform/positive-slippage fee parameters are currently unsupported. Pool quote amounts on direct DEX events keep M10.1's gross pool-flow meaning; router events use executed endpoint quote units. The event scope/provenance and UI distinguish these meanings. USD remains null.

### N–R. Account indexing, instruction scope, fallback and correctness

Compiled transaction JSON resolves static account keys, loaded writable keys and loaded readonly keys in that order. Required signatures select static signer keys. jsonParsed keys are already expanded and are not appended again; lookup-table keys cannot become signers. Balance accountIndex is checked against that resolved sequence, with duplicate/negative/out-of-range indices rejected. Deterministic tests cover both forms and raw SPL transfers. [Solana JSON structures](https://solana.com/docs/rpc/json-structures).

The verifier retains each outer instruction's inner group and stack height. Only supported immediate DEX children of a single outer Jupiter instruction can form the routed proof. Missing/caught-failed invocations, unknown wrapper programs, nested router composition, unsupported route legs, transfers outside the causal scope and malformed evidence cannot fall back to direct authority. The requested transaction ID must be the first transaction signature, not merely any included signature.

Adversarial tests cover payer substitution, unsigned loaded authority, largest shared delta, custom destination, duplicate owner accounts, unrelated net movement, missing transfers, malformed/unknown versions, unknown child operations, failed transactions, wrong scope/mint, Token-2022 net-fee mismatch, ATA/wSOL/tip changes, splits and allowed instruction reordering. Checked Token-2022 remains limited to exact conserved transfers without hooks/fees. Passing these tests is evidence for these cases, not a claim of a statistically measured zero false-positive rate across all mainnet activity.

### S–V. Measured coverage, pressure confidence and public cross-checks

The complete [sample register](router-mainnet-samples.json) includes every captured signature, slot, capture time, program, decoded router intent when available, authority, mint roles, observed account deltas, execution outcome, raw accepted amounts and payload hash. Unknown executed amounts stay null. Three separate cohorts must not be merged into one market percentage:

| Fixed cohort | Unique candidates | Direct verified | Routed verified | Unsupported router/version/leg | Ambiguous/incomplete | Failed | No positive swap evidence |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Current ANSEM: 20 most recent mentions per each of 3 pools | 60 | 0 | 0 | 11 | 0 | 20 | 29 |
| Auxiliary Jupiter program: latest 20 mentions, mixed output mints | 20 | 0 | 0 | 8 | 2 | 10 | 0 |
| Previous M10.1 ANSEM sample replayed under stricter rules | 23 | 2 | 0 | 12 | 0 | 0 | 9 |

All 80 new RPC transactions were available; there were zero duplicate signatures within either new cohort and zero final capture errors. Current ANSEM spans slots 446570989–446571442 (00:55:14–00:57:37 UTC); the auxiliary Jupiter cohort is all slot 446595530 (03:04:22 UTC). This latter single-slot cohort demonstrates formats and safe rejection, **not representative Jupiter-wide coverage**. Equal per-pool limits and address mentions are not a known true-trade denominator. “No positive swap evidence” does not assert a transaction was definitely a non-swap. No 24-hour market share or false-negative percentage is inferred.

The previous cohort's two accepted direct sales total raw 228,000,000 tracked units. Missing economic amounts and possible intermediate turnover make a raw-amount coverage denominator indefensible; raw coverage and USD coverage remain null. No missing trades are rescaled into estimated volume. Current direct buys, successful fully accepted Jupiter/shared/split routes and custom payer/recipient combinations were not independently demonstrated in this bounded public validation. Shared V2, multileg, SOL/token intent and failed shared formats were naturally encountered, but decoding intent is not verified execution.

The ingestion service reports retained unique candidate outcomes (maximum five minutes / 1,024 records), evaluated/pending counts, direct/routed accepted counts, unsupported, ambiguous, failed, intermediate, not-involved, no-evidence counts and accepted raw tracked totals. Duplicate/reconciled counters remain distinct from candidate counts and do not inflate the denominator. Reconciliation changes the existing record's category and pressure eligibility. Confidence is UNKNOWN before candidates, DEGRADED with missing/unsupported/ambiguous evidence or no accepted events, otherwise PARTIAL for the observed subset. It never asserts complete market coverage. The pressure tooltip shows the bounded sample's confidence and evaluated/accepted counts, separately from its 60-second SOL flow. Existing history gaps, upstream failures and non-SOL pressure exclusions remain visible; no extrapolation was introduced.

Four selected signatures were independently requested again as compiled JSON. A separate script (without the production resolver) resolved the static/ALT account arrays and compared signature, slot, pre/post token balances, logs and failure status with the captured jsonParsed responses. All checks passed; results are retained in [router-crosschecks.json](router-crosschecks.json). The current shared V2 sample has 12 loaded writable and 17 loaded readonly keys; the failed shared sample has 6 and 3. Both raw public fixtures are committed. This is independent decoding/cross-check methodology against public RPC and a program-owned IDL, not independent RPC-provider consensus or a light client.

Manual cross-check of `doqiTDJ9hQ24…`: encoded ExactIn 195,113,023 lamports; scoped input movement 194,917,910 plus a separate 195,113 fee; output transfer 1,443,279,952,110 raw units, distinct from the quoted 1,442,816,193,566. Its SOL system funding is not an additional swap. These values explain why neither a pool quote nor a quoted output may be substituted for user execution. The unsupported Raydium Launchlab leg and fee boundary keep it out of canonical authority.

### W–AB. Performance, security and regression checks

No new production RPC request, dependency, paid service, subscription, queue or persistent per-signature structure was added. The static IDL is bundled in the Worker. Existing 512-instruction / 16-leg bounds remain, with 32-item Borsh vectors and a depth limit. The existing ingestion budget, record lifetime, dedup, finalization and token isolation remain in place. Public capture used fixed endpoints, 3.1-second request spacing and finite cohorts. Request ceilings and global-admission limitations from M10.1 still apply; this is not a paid-provider cost guarantee.

Client prices/pools/status cannot alter evidence. All new router quantities are raw RPC execution facts; no browser valuation is an input. Unknown versions cannot regain authority through the old signer fallback. Existing selection ordering, MC/FDV distinction, source rebases, canonical settlement, dedup and multi-token gates remain tested. No terrain, impact, giant entities, wallet, combat or visual redesign was implemented.

| Validation | Result |
| --- | --- |
| All unit tests | 31 files, 279 tests passed (46 dedicated router tests; 3 new IDL/public-chain tests) |
| Lint | Passed |
| Production browser build | Passed |
| Worker bundle, `wrangler deploy --dry-run` | Passed; 138.47 KiB / gzip 27.82 KiB; no upload/deployment |
| Complete E2E command, one worker | 96 definitions: 62 passed, 34 existing device skips; exit 0, 10.7 minutes |
| Public compiled-vs-parsed cross-check | 4 signatures passed every recorded check |
| IDL drift check | Same hash on second finalized read |
| Shared-route soak, final frozen-code run | 60 seconds; 752 cycles; 60,160 replay deliveries; 9,024 mocked RPC reads; 6,016 publications; max 76 records/token; all finalized; empty teardown |

Two earlier shared-route soaks completed 844 and 591 cycles while additional checks were being developed. The final frozen-code run above covers four token services and 0.8356 virtual hours. Three services use shared direct/split/multihop fixtures and one direct fixture; each cycle asserts that the new signature actually verifies and finalizes. These are test-only transport/clock results, not production uptime or throughput estimates. Unit and lint gates were rerun on the final Worker code; browser code stayed unchanged during the full passing E2E run.

### AC–AG. Artifacts, diff and local Git

Implementation: `transaction-evidence.js`, `transaction-accounts.js`, `router-decoder.js`, `router-evidence.js`, the pinned `idl/jupiter-v6.js`, `verification-coverage.js` and ingestion diagnostics. Browser changes are confined to truthful pressure/trade tooltips. Tests add the router fixture builder, adversarial suite, two public fixtures, IDL snapshot checks and pressure coverage assertions. Capture, offline audit, compiled cross-check and IDL drift scripts plus the sample/provenance JSON files make the evidence reviewable. Prompts are not stored.

The existing M10.1 commit is preserved without amendment. The closing response records the second local commit SHA for this safe bounded increment; its existence does not assert M10.2 readiness. `git diff 3a16c4aff2741e63139474ee29951137a19d7fb7 HEAD --stat` gives the final changed-file inventory. No push, PR, merge, deploy, tag or release is performed.

### AH–AJ. Remaining limits, materiality and exact readiness

Unsupported cases include arbitrary wrappers and non-Jupiter Meta-Aggregator programs; nested/multiple router invocation compositions; ledger variants; unsupported/dynamic DEX variants; nonzero platform/positive-slippage fees; routing residuals or opaque shared ownership; delegated/non-signer authority; unproved custom/native destinations; Token-2022 fees/hooks; and native lifecycle paths that cannot pass the stated checks. An observed instruction name in the IDL is not a claim to support that DEX's execution. No successful public shared-route acceptance is claimed.

Coverage is materially blocking: the current ANSEM candidate stream yielded no authoritative event; even the prior positive sample retains only two direct sales after removing unknown-wrapper assumptions. The sample is too bounded and lacks a true-trade denominator to choose a defensible numeric readiness threshold. It certainly cannot justify treating the missing coverage as immaterial. The safe answer is to expose the observed subset as degraded. Independently authoritative valuation is also not established by this increment: the existing pipeline remains PROVIDER_INDICATIVE / authorityEligible=false. That predicate must not be declared satisfied merely because trade parsing improved.

Downstream code may consume accepted events under their explicit execution scopes and settlement rules. It cannot treat the current pressure stream as an adequate account of the battlefield or use indicative valuation as authoritative terrain. M10.2 remains blocked, with no Market Terrain implementation.

M10.1 BLOCKED — MATERIAL VERIFICATION COVERAGE
