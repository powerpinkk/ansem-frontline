# M8 User Champion architecture

M8 adds a temporary, token-scoped user representation without connecting a wallet or treating local state as proof of an economic action.

```text
TokenContext ───────────────→ market runtime / verified trades
      │
      └── canonical mint ───→ ChampionController ───→ ChampionPolicy
                                      │
ThemeDefinition ─── presentation ─────┼──→ scene User Champion adapter
                                      ├──→ accessible HUD
                                      └──→ Pixel / PiP sanitized snapshot
```

`TokenContext`, market runtime, theme state and `ChampionState` are independent dimensions. The controller never receives a market runtime, trade callback, socket factory, pool, price, market cap, balance or wallet address. An activation cannot create a trade or change buy/sell pressure.

## State and policy

The canonical state has `status`, canonical `mint`, opaque `activationId`, `source`, `activatedAt`, `expiresAt`, `durationMs`, `presentationRole`, optional bounded `displayLabel`, transition `reason`, monotonic `sequence` and `updatedAt`. Sources are deliberately limited to `simulation` and `test`.

The default policy is a 30-minute duration. The existing Pixel “30S” value is only a rolling companion visualization window, not a canonical product timeframe, so M8 does not couple Champion duration to it. Tests inject a short policy and fake clock. Reactivation uses **refresh** semantics: it replaces the prior activation for that mint, assigns a new activation ID and sets `expiresAt = reactivatedAt + duration`. At most one Champion exists per mint.

The session store is an in-memory `Map` bounded to 12 mints. Expired/inactive records are evicted first; if every record is active, the oldest mint other than the currently viewed mint is evicted. The controller schedules one timeout for the earliest expiry across all tracked mints. Token switches do not restart the clock. Destroy clears the timeout, subscribers and in-memory records.

Expired state is retained only as a bounded lifecycle diagnostic; every presentation adapter treats it as absent. Returning to a mint before expiry restores its Champion. Returning after expiry cannot respawn it.

## Battlefield and theme boundary

The historical detailed foreground “champions” remain verified swap entities and retain combat behavior. The Bull King remains the persistent ANSEM commander with his existing tactics, support, ward and reclamation behavior. The M8 User Champion is a separate, stable scene identity (`entityKind: user-champion`) with a direct runtime reference. It is not inserted into the combat `entities` array, target selection, crowd forces, collision resolution or market calculations.

The scene creates both bounded presentations once and toggles them in place:

- ANSEM: a compact Black Bull-inspired User Champion, visually related to the historical theme but separate from the commander and verified swaps.
- Generic: a neutral sentinel with no ANSEM character branding.

`ThemeDefinition.scene.champion` and `ThemeDefinition.pixel.champion` control style and colors. They are validated, immutable presentation fields. M8 intentionally leaves them outside the Theme Studio allowlist, so Studio can preview other theme values without editing Champion policy or lifecycle.

## Pixel and companion synchronization

The main-window `ChampionController` is the sole M8 authority. `companion.js` sends only the sanitized state fields needed for presentation alongside the existing token-scoped market snapshot. It includes the canonical mint and monotonic sequence. The standalone Pixel consumer rejects cross-token and stale Champion payloads; it never rebroadcasts. Embedded video PiP and Document PiP consume the same snapshot object and use `expiresAt` to stop rendering even if a throttled timer arrives late.

No Champion object owns a BroadcastChannel or creates an additional channel. Token switching continues to rotate the single existing Pixel channel namespace.

## Controlled activation and trust boundary

The only browser activation hook is `window.__ansemActivateSimulatedChampion`, compiled into Vite development/test builds through `import.meta.env.DEV`. Production builds contain no public activation button, query parameter, hash flag, cookie or local-storage entitlement. M8 has no local or remote persistence for Champion authority.

### Current trusted input

Only internal, controlled `simulation` or `test` calls may reach the M8 controller. Request objects use an exact allowlist (`mint`, optional safe display label); wallet-shaped or transaction-shaped fields are rejected.

### Not implemented and untrusted future input

Wallet events, addresses, balances, signatures, RPC responses, quotes, purchase amounts, backend eligibility and user accounts are outside M8. **Champion activation != wallet event until cryptographically/authoritatively verified.** No M8 state, local hook, activation ID or snapshot is proof of a purchase.

Wallet integration is intentionally deferred to **M9 — WALLET / QUOTE / SECURITY + LEGAL GATE**. M9 must define an authoritative verification boundary before extending accepted sources; verified activation must still pass through the same policy and canonical state transition rather than bypassing the controller.
