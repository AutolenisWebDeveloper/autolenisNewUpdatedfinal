---
name: autolenis-inventory-intelligence
description: >-
  Owns AutoLenis vehicle inventory — the adapter-based ingestion pipeline, VIN
  identity and deduplication, the LANE_1/2/3 provenance model, quality and
  freshness scoring, stale sweeps, buyer matching, and the rule that
  low-confidence external listing data is never presented to a buyer as verified
  fact. Use this skill when touching frontend/lib/services/inventory/ (adapters,
  orchestrator, dedup, match, quality), app/api/cron/inventory-*, or the
  InventoryItem / InventorySource / InventorySyncRun / InventoryQualityScore /
  InventoryFeedLog / VehicleMatchScore models; or when a task mentions inventory
  sync, VIN, listing feed, MarketCheck, dealer feed, stale listing, inventory
  lane, vehicle match, or listing data quality.
---

## Purpose & Authority

AutoLenis shows buyers vehicles it does not own, sourced from aggregators and
dealer feeds it does not control. That makes inventory a **data-integrity
problem before it is a product problem**: a stale listing becomes a buyer
chasing a sold car, a bad VIN becomes a mis-priced auction, and an
over-confident lane assignment becomes an implied dealer relationship that does
not exist.

This skill owns `frontend/lib/services/inventory/**` and the inventory data
model. It previously had no owner — `autolenis-integrations` covered the
MarketCheck *adapter* as a vendor concern, but nothing governed ingestion
semantics, provenance, or freshness.

## When this skill activates

- `frontend/lib/services/inventory/` — `orchestrator.ts`,
  `inventory-dedup.service.ts`, `inventory-match.service.ts`,
  `inventory-quality.service.ts`, `adapters/**`.
- Crons: `app/api/cron/inventory-sync-full`, `inventory-sync-priority`,
  `inventory-stale-sweep`.
- Models: `InventoryItem`, `InventorySource`, `InventorySyncRun`,
  `InventoryQualityScore`, `InventoryFeedLog`, `InventoryUploadBatch`,
  `InventoryPriceAlert`, `VehicleMatchScore`, `VehicleComparisonSaved`,
  `VehicleRequestMatchResult`.
- Enums: `InventoryLane`, `InventorySourceType`, `SyncRunStatus`, `FeedFormat`.
- Keywords: VIN, listing, feed, aggregator, MarketCheck, sourceKey, lane,
  stale, dedup, freshness, quality score, vehicle match, price history.

## Architecture & key files

**Adapter contract** — `adapters/IInventoryAdapter.ts`:
`IInventoryAdapter`, `NormalizedVehicle`, `AdapterRunResult`, `SearchParams`,
and `buildSourceKey(v)`. Every source normalizes into `NormalizedVehicle` before
touching the database. **Adapters never write.**

**Active adapters.** Only `MarketCheckAdapter` (gated on `MARKETCHECK_API_KEY`)
and `CustomAdapter` (per dealer-feed row) are live. The AutoTrader / Cars.com /
CarGurus / TrueCar / Edmunds files are **retained stubs, deliberately dropped
from the active set in the 2026-04 audit** because they returned `[]` and
inflated `healthScore`. Do not re-enable a stub without real parsing — a stub in
the active list corrupts the health metric.

**Orchestrator** — `orchestrator.ts`:
- `runInventorySync(params, mode: "full" | "priority")` → `OrchestratorRunResult`.
  Each adapter is **failure-isolated**: one adapter throwing never blocks others.
- `assignLane(vehicle, activeDealerIds)` → `InventoryLane`.
- `bootstrapInventory()`.

**Lane model (provenance, not quality):**

| Lane | Meaning |
| --- | --- |
| `LANE_1` | Active AutoLenis dealer **and** the vehicle is explicitly linked. |
| `LANE_2` | External listing whose dealer name matches an `ACTIVE` dealer — partner-*adjacent*, not verified. |
| `LANE_3` | Open-market listing; no dealer relationship. **Default.** |

**Identity & dedup** — `inventory-dedup.service.ts`:
`deduplicateVehicleList(vehicles)` and
`buildCompositeKey(make, model, year, mileage?, priceCents?)`. Primary key is
**VIN** when present; the composite key is the documented fallback.
`InventoryItem.vin` is `@unique`.

**Quality & freshness** — `inventory-quality.service.ts`
`computeQualityScore(inventoryItemId)` → `InventoryQualityScore`
(`photoScore`, `dataScore`, `priceScore`, `vinVerified`). Freshness lives on
`InventoryItem.lastSeenAt` + `isActive`, swept by `inventory-stale-sweep`.
Ingestion health lives on `InventorySyncRun` (`vehiclesFetched`,
`vehiclesUpserted`, `vehiclesDeactivated`, `healthScore`) and, for dealer feeds,
`InventoryFeedLog`.

**Matching** — `inventory-match.service.ts`: `findMatchedVehicles(buyerId, limit)`
and `saveVehiclePreferences(...)`; scored via `VehicleMatchScore` /
`VehicleRequestMatchResult`.

## Core rules & invariants

1. **Adapters normalize; the orchestrator persists.** No adapter calls Prisma.
   A new source means a new `IInventoryAdapter` implementation, never a new
   write path.
2. **VIN is the identity key.** Uppercase and trim before comparison. A 17-char
   VIN that fails basic shape validation is *unverified* — set `vinVerified`
   false rather than dropping the record silently.
3. **Never merge on price or mileage alone.** Those change between syncs;
   `buildSourceKey` / `buildCompositeKey` exist so dedup is reproducible.
4. **Lane is provenance, and lanes never inflate.** `LANE_2` requires a matched
   `ACTIVE` dealer; anything unmatched stays `LANE_3`. Do not promote a lane to
   make a listing look better in the UI.
5. **Freshness is explicit.** Every ingest stamps `lastSeenAt`. A vehicle absent
   from its source is **deactivated** (`isActive = false`), not deleted — price
   history and auction references must survive.
6. **Money is integer cents.** `priceCents`, always. `priceHistory` is appended,
   never overwritten.
7. **Failure isolation is a feature.** Keep per-adapter try/catch in the
   orchestrator; report partial success via `InventorySyncRun` rather than
   failing the whole run.
8. **Health scores must stay honest.** Do not count a no-op adapter as a healthy
   source. If a source is unconfigured, it is skipped, not scored.
9. **Low-confidence data is labelled, not laundered.** External listing fields
   (`externalDealerName/Phone/City/State`, `externalListingUrl`) are
   *third-party claims*. They must never be presented to a buyer as an AutoLenis
   verified fact, and never used to imply a dealer partnership.
10. **Buyer-facing matches respect the request.** `findMatchedVehicles` filters
    to the buyer's saved preferences; do not widen the filter to fill a grid.

## Workflows

**Add a new inventory source**
1. Implement `IInventoryAdapter` under `adapters/`; return `NormalizedVehicle[]`
   plus an `AdapterRunResult`. No DB access.
2. Own the no-op case *inside* `search()` — return empty when the API key is
   absent instead of throwing.
3. Register it in `ADAPTERS` (built-in) or as an `InventorySource` row (feed).
4. Confirm `buildSourceKey` produces a stable key for that source.
5. Add a unit test for normalization + dedup; extend the nearest `__tests__`.
6. Vendor-side concerns (timeouts, retries, secrets) →
   `autolenis-integrations`.

**Investigate a bad/duplicate listing**
1. Check `InventoryItem.vin` and `sourceAdapter`.
2. Replay `deduplicateVehicleList` over the colliding records.
3. Check `InventorySyncRun` for the run that introduced it, and
   `InventoryQualityScore` for the confidence signal.
4. Fix in normalization or dedup — never by hand-editing the row.

**Change stale handling**
1. Adjust the sweep in `app/api/cron/inventory-stale-sweep` only.
2. Preserve deactivate-don't-delete; verify no active `AuctionVehicle` points at
   a row you would remove.

## Boundaries — do / never

**Do**
- Normalize in the adapter, persist in the orchestrator.
- Keep VIN-first identity with a documented composite fallback.
- Deactivate stale rows; keep price history append-only.
- Record every run in `InventorySyncRun` / `InventoryFeedLog`.
- Label external claims as external.

**Never**
- Write to `InventoryItem` from an adapter, a route handler, or a component.
- Re-enable a returns-nothing adapter stub in the active list.
- Promote a lane without a matched `ACTIVE` dealer.
- Hard-delete inventory referenced by an auction.
- Present aggregator data to a buyer as verified AutoLenis data.

## Acceptance criteria

- [ ] New sources implement `IInventoryAdapter` and perform no DB writes.
- [ ] VIN normalized and uniqueness respected; dedup reproducible.
- [ ] `lastSeenAt` stamped on ingest; disappearance deactivates, never deletes.
- [ ] Prices are integer cents; `priceHistory` append-only.
- [ ] Per-adapter failure isolation preserved; run recorded with an honest
      `healthScore`.
- [ ] External/unverified fields are not rendered as AutoLenis-verified.
- [ ] Relevant tests pass (`pnpm test`, plus any inventory suite you add).

## Cross-skill links

- `autolenis-integrations` — MarketCheck/feed adapter transport, keys, retries.
- `autolenis-auction-engine` — `AuctionVehicle` consumes `InventoryItem`.
- `autolenis-buyer-journey` — vehicle requests and buyer-facing matching.
- `autolenis-dealer-marketplace` — dealer-supplied feeds and dealer linkage.
- `autolenis-observability-sre` — the inventory crons and their `CronJobLog`s.
- `autolenis-supabase-postgres` — indexes on `[lane, isActive]`, `[sourceAdapter]`.
- `autolenis-domain-model` — model/enum source of truth.
