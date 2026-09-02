# Inventory market re-point — plan

**Branch:** `claude/inventory-market-repoint-s5eekb`
**Status:** implemented on this branch, for owner review. No migration applied, no production data
mutated, nothing deployed. The plan below was written first; §3.2, §4 and §8 record where an
independent review pass changed it.
**Skills loaded:** `autolenis-system-architecture`, `autolenis-domain-model`,
`autolenis-inventory-intelligence`, `autolenis-supabase-postgres`, `autolenis-testing-quality-gates`,
`autolenis-debugging`, `autolenis-code-verification`, `autolenis-production-readiness`.

---

## 0. Evidence base

Everything below was verified in this session by reading the code and by **read-only** `SELECT`s
against production project `aieybibvewmvrubcpthm`. No `UPDATE`/`INSERT`/`DDL` was issued.

```
lane    | is_active | n  | null_seen | >48h | >30d | min_last_seen        | max_last_seen
LANE_1  | true      | 95 | 1         | 94   | 94   | 2026-04-27 07:00:11  | 2026-06-18 22:00:21
LANE_3  | false     | 73 | 0         | 73   | 52   | 2026-07-02 07:00:36  | 2026-08-31 06:03:03
LANE_3  | true      | 53 | 0         | 0    | 0    | 2026-09-01 06:03:30  | 2026-09-02 17:00:19
```

* **All 95 immortal rows are `LANE_1`**, and every one has `dealer_id IS NULL`,
  `source_adapter IS NULL`, `added_by_admin_id IS NULL` — i.e. no provenance at all.
* `cron_job_logs` shows `inventory-stale-sweep` running every 30 minutes, `status = COMPLETED`,
  `error = null`, `deactivated = 0`, on build `1d8af96`. **The cron is healthy; its WHERE clause
  structurally cannot match those rows.**
* External dealer names across all 148 active rows collapse to three: `Cadillac Of Manhattan`,
  `Volvo Cars Manhattan`, `Easy Way Auto` — all New York, NY.

---

## 1. Where the MarketCheck query geography lives (Task 1 — report before change)

It is **hardcoded in the adapter**, with no env var and no database column governing it.

| # | Location | What it does |
| - | --- | --- |
| **1 (primary)** | `frontend/lib/services/inventory/adapters/marketcheck.adapter.ts:131` | `zip: params.zip ?? "10001"` — **ZIP 10001 is Manhattan, NY**. This single `??` is why the catalogue is 93 % New York. |
| 1b | `frontend/lib/services/inventory/adapters/marketcheck.adapter.ts:132` | `radius: String(params.radius ?? 100)` — 100-mile default radius around that NYC centre. |
| **2** | `frontend/app/api/cron/inventory-sync-full/route.ts:13` | `runInventorySync({}, "full")` — passes **empty params**, so the NYC fallback always wins. |
| **3** | `frontend/app/api/cron/inventory-sync-priority/route.ts:13` | `runInventorySync({}, "priority")` — same. |
| 4 | `frontend/lib/services/inventory/orchestrator.ts:350-356` | `bootstrapInventory()` hardcodes a five-market array, **New York first**, then LA / Chicago / Houston / Atlanta. Reachable from `POST /api/admin/inventory/bootstrap`. |
| 5 | `frontend/app/api/admin/inventory/search-tool/run/route.ts:70` | Admin search tool forwards an operator-supplied `zip`; when omitted, MarketCheck applies its own default. Not a scheduled path. |

**There is no geography configuration on `inventory_sources` today** — its columns are exactly
`id, type, name, is_active, last_run_at, last_run_status, vehicles_last_count, created_at`
(`prisma/schema.prisma`, `InventorySource`), confirming the report in the task description.

**Reuse-before-create note:** a `MarketCoverage` model *does* exist
(`city, state, zip, status, listing_count, last_sync_at`) with admin routes at
`app/api/admin/inventory/markets/`. It is **write-only in practice**: nothing in the sync path reads
it. It is a *coverage/marketing* record, not a query configuration (no radius, no filters, no adapter
binding). Rather than overload it — which would create two competing sources of truth for
"which geography do we serve" — the plan follows the stated preference and puts the **query**
configuration on `inventory_sources`, and leaves `MarketCoverage` alone.

---

## 2. Make the served market configurable (Task 2)

### 2.1 Schema — additive columns on `inventory_sources`

```prisma
model InventorySource {
  // ... existing columns unchanged ...

  // Market configuration — the geography and filters this source is queried with.
  marketLabel         String?   @map("market_label")
  marketZip           String?   @map("market_zip")
  marketLat           Decimal?  @map("market_lat")  @db.Decimal(10, 7)
  marketLng           Decimal?  @map("market_lng")  @db.Decimal(10, 7)
  marketRadiusMiles   Int?      @map("market_radius_miles")
  marketMakes         String[]  @default([]) @map("market_makes")
  marketPriceMaxCents Int?      @map("market_price_max_cents")
  marketYearMin       Int?      @map("market_year_min")
  marketYearMax       Int?      @map("market_year_max")
}
```

Additive, all nullable (or defaulted), no constraint, no data change, no index. **One row = one
(adapter, market) pair**, which the existing `@@unique([type, name])` already supports: the live
production row (`MARKETCHECK` / `MarketCheck`) gets configured for DFW; a second market is a second
row (`MARKETCHECK` / `MarketCheck — Houston`).

Migration `prisma/migrations/20261104000000_inventory_source_market_config/` with
`migration.sql` + `rollback.sql`, `ADD COLUMN IF NOT EXISTS`, written in the house style
(rationale header, apply-order note, RLS note). **Written, not applied.**

### 2.2 Resolution order (deterministic, documented)

1. Explicit `params` passed to `runInventorySync(...)` — manual/admin runs win.
2. The **active `InventorySource` row's** market columns.
3. Env fallback — `INVENTORY_DEFAULT_MARKET_ZIP`, `INVENTORY_DEFAULT_RADIUS_MILES`,
   `INVENTORY_DEFAULT_MARKET_LABEL`.
4. **Nothing.** There is deliberately **no compiled-in default market any more.**

Step 4 is the substantive change. Today an unconfigured deployment silently syncs Manhattan.
After this change an unconfigured deployment reports `NOT_CONFIGURED` for that source and ingests
nothing — the same anti-fake-success primitive the adapter already uses for a missing API key
(`AdapterOutcome`, `IInventoryAdapter.ts:34-39`). **A wrong market is worse than no market**, and
the existing health alerting (`orchestrator.ts:323-331`) already surfaces it.

Because env is step 3, **setting one Vercel env var re-points the market immediately, before the
migration is applied.** That matters: it decouples the fix from the owner-gated DDL.

### 2.3 Orchestrator restructure (ordering defect this fixes)

`ensureInventorySource()` is currently called **after** the adapters run (`orchestrator.ts:277`), so
on a fresh database the source row does not exist while the sync is deciding what to query. Market
config cannot be read from a row that is created later. The fix is to resolve source rows **first**:

```
runInventorySync(params, mode)
  1. resolveMarketPlans(params)      // adapter registry × active InventorySource rows (+ env fallback)
  2. run each plan's adapter in parallel, failure-isolated   [unchanged semantics]
  3. dedup across plans by sourceKey                         [unchanged]
  4. upsert with lane + provenance                           [unchanged]
  5. stale sweep (full mode) via the shared predicate        [see §3]
  6. record one InventorySyncRun per plan, attributed to its sourceId
```

`inventorySourceForAdapter(adapterName)` is inverted into an adapter registry keyed by
`InventorySourceType` (`MARKETCHECK -> MarketCheckAdapter`), so a source row selects its adapter
rather than an adapter inventing a source name. Per-source upsert attribution is keyed by plan
index instead of adapter name, so two markets on the same adapter no longer collapse into one count.

**Pre-migration safety.** The repo convention (see
`prisma/migrations/20261103000000_apollo_reveal_empty_stage/migration.sql`) is *apply the migration
before or with the code*, because Prisma selects every declared column and a missing one raises
P2022. The migration header will say so. In addition, the market-config read catches **P2022
specifically** (not a bare `catch`), logs a warning naming the unapplied migration, and falls back
to the env defaults — so the deploy-before-migrate window degrades to "env-configured market"
instead of taking inventory sync down.

---

## 3. Why `inventory-stale-sweep` deactivates nothing (Task 3 — root cause)

### 3.1 Root cause

`app/api/cron/inventory-stale-sweep/route.ts:28` and `:43`, and the duplicate sweep in
`orchestrator.ts:263`, all filter:

```ts
{ lastSeenAt: { lt: cutoff }, lane: { not: "LANE_1" }, isActive: true }
```

The `LANE_1` exemption exists to protect **dealer-managed** inventory ("Never auto-deactivate
dealer-verified Lane 1", `:43`). But `lane` is not proof of dealer management — it is a mutable
column that several paths set independently of `dealerId`. In production **all 95 immortal rows are
`LANE_1` with `dealer_id IS NULL`**: they claim the dealer exemption without the dealer link. The
predicate is therefore structurally incapable of matching them, which is exactly what the
`deactivated: 0` cron logs show. **The cron is not broken; its definition of "protected" is.**

Two further defects in the same predicate:

* **`NULL` `lastSeenAt` is unreachable.** `lastSeenAt < cutoff` is `UNKNOWN` for `NULL` in SQL, so a
  row that was never stamped is immortal in *every* lane. Production has exactly one such row.
* **The snapshot and the mutation can drift.** The `staleItems` `findMany` (`:25-38`) and the
  `updateMany` (`:40-47`) repeat the same where-clause by hand, differing only by
  `dealerId: { not: null }`. Two hand-copied predicates for one policy is how they silently diverge.

### 3.2 Fix at the cause

A single shared predicate in `lib/services/inventory/inventory-eligibility.ts` — the module that
already owns freshness policy — consumed by **both** sweeps:

```ts
export function staleSweepWhere(now = new Date()): Prisma.InventoryItemWhereInput
export function isStaleForSweep(item, now?): boolean   // pure mirror, tested against both
```

**The exemption does not look at `lane` at all.** The plan originally proposed
`lane = LANE_1 AND dealerId IS NOT NULL`; review showed that is still wrong in the other direction.
`assignLane()` can only return `LANE_2`/`LANE_3`, and the aggregator upsert restamped `lane` on
every row it touched — so a dealer's own LANE_1 listing whose VIN appeared in the MarketCheck feed
was demoted and would have lost its protection. Admin `bulk-lane` moves rows the same way. The
exemption is therefore keyed on stewardship alone:

* **Dealer-managed** — `dealerId IS NOT NULL`. Exempt. Neither a feed nor an admin lane move can
  strip it, because neither writes `dealerId`.
* **Admin-curated** — `addedByAdminId IS NOT NULL`. Exempt, preserving the admin "Lane 1 — Featured
  (homepage carousel)" workflow, which is a *second, independent* meaning `LANE_1` carries in this
  codebase. Flagged as a pre-existing semantic conflation; **not** untangled here.
* **Everything else** ages out, aggregator rows and provenance-less orphans included.
* Staleness is measured from `lastSeenAt ?? createdAt`, closing the NULL hole without sweeping a
  just-created row.

**Verified against production** by the review pass, read-only:

| Predicate | Rows matched |
| --- | --- |
| the old cron predicate | **0** |
| drop the lane filter only | 94 |
| drop the lane filter + handle NULL `lastSeenAt` | 95 |
| shipped `staleSweepWhere()` | **95** |

Both defects are independently necessary; neither fix alone reaches the whole cohort.

**Provenance of the cohort, established by the review pass:** `admin_audit_logs` holds 123
`INVENTORY_ITEM_LANE_CHANGED` events, all stamped `2026-06-23 01:36:53`, all `LANE_3 → LANE_1` —
one `PATCH /api/admin/inventory/bulk-lane` batch, which wrote `{ lane }` and nothing else. 95 of
those rows are still active. **The immortality was manufactured by a single admin bulk action that
granted a dealer exemption to aggregator rows with no dealer.** So the write paths are corrected
too:

* `bulk-lane` and `admin/inventory/[id]` PATCH now stamp `addedByAdminId` and `lastSeenAt` on a lane
  change — a deliberate curation is recorded and protected; an un-attributed one is not.
* `admin/inventory/search-tool/add` stamps `addedByAdminId` and `lastSeenAt` (it set neither).
* `dealer/inventory/[id]` and `admin/inventory/[id]` PATCH stamp `lastSeenAt` on **edit**. Without
  this a dealer with no feed, updating a price weekly, would have watched every listing fall out of
  shortlist eligibility 30 days after creation — the 30-day cutoff firing precisely on the rows a
  human tends most actively.
* The aggregator upsert no longer restamps `lane` or `sourceAdapter` on a row with a `dealerId`.

**Cascading-wipe guard (added after review).** The orchestrator's full-sync sweep ran whenever
`mode === "full"`, regardless of whether any adapter succeeded. With the old lane exemption that was
masked; with the exemption correctly narrowed it becomes live and destructive — eight consecutive
6-hourly MarketCheck outages span the 48-hour window and would deactivate the entire external
catalogue for a reason unrelated to the listings. The sweep is now skipped when any source returned
`FAILED`/`DEFERRED` or any per-vehicle write failed, and the reason is reported on the run. The
standalone 30-minute cron still runs, so genuinely stale rows are not spared.

### 3.3 Blast radius — the owner must know this before deploy

Once this ships, the next `inventory-stale-sweep` run will deactivate **~95 rows**, taking the
public catalogue from **148 active to ~53**. That is the intended correction — those rows are
3–5-month-old New York listings currently badged **"Verified"** to buyers
(`app/(public)/inventory/page.tsx:38`, `app/buyer/inventory/[vehicleId]/page.tsx:32`
"Directly from a verified AutoLenis dealer partner") despite having no dealer link at all. But it is
a visible, one-shot catalogue reduction and it is the owner's call when it lands.

Mitigation: the cron gains `?dryRun=1`, which reports exactly what it *would* deactivate and writes
nothing. The owner can run it once before letting the scheduled sweep proceed.

---

## 4. Freshness gating for shortlist eligibility (Task 4)

Added to `lib/services/inventory/inventory-eligibility.ts` so all freshness policy stays in one file
and the sweep and the gates cannot drift apart:

```ts
export const STALE_FLAG_WINDOW_MS = 7  * 24 * 3600_000;   // flagged stale
export const SHORTLIST_MAX_AGE_MS = 30 * 24 * 3600_000;   // not shortlist-eligible
export function listingFreshness(item, now): { lastSeenAt, referenceAt, ageMs, isStale, shortlistEligible };
export function isShortlistEligible(item, now): boolean;
export function shortlistEligibleWhere(now): Prisma.InventoryItemWhereInput;
```

Reference timestamp is `lastSeenAt ?? createdAt`, uniform across every lane — no exemption, matching
the requirement as stated.

**Three windows, three jobs — deliberately different, documented together:**

| Window | Constant | Gates |
| --- | --- | --- |
| 48 h | `FRESHNESS_WINDOW_MS` (existing) | executable supply for **matching/sourcing**, and the sweep cutoff |
| 7 d | `STALE_FLAG_WINDOW_MS` (new) | a **display flag** only — never filters anything |
| 30 d | `SHORTLIST_MAX_AGE_MS` (new) | **shortlist eligibility** |

**Where 7/30 d actually bite — stated plainly, because it is not obvious.** Once the sweep works,
an aggregator row is deactivated at 48 h, so it can never reach 7 days while active. The 7-day flag
and the 30-day cutoff are therefore a **backstop for the sweep-exempt populations**: dealer-managed
and admin-curated rows, which are never swept and would otherwise stay shortlist-eligible forever.
That is what makes all three numbers load-bearing rather than one shadowing the next.

**The dealer exemption is capped at the shortlist window (added after review).** `executableSupplyWhere`
exempts dealer-managed rows from the 48-hour window entirely. Uncapped, a dealer row last seen 45
days ago is *matchable* but *not shortlistable*: the buyer is shown the vehicle and gets a 409 when
they try to save it. Capping the exemption at 30 days makes executable supply a strict subset of
shortlist-eligible supply, so that dead end cannot occur. A test asserts the invariant across a
matrix of `{lane × dealerId × age}`, and a second asserts `isSweepExempt` and `isStaleForSweep`
agree over `{dealerId × addedByAdminId}`.

**Enforcement point.** `addToShortlist` in `lib/services/shortlist/shortlist.service.ts` performed no
eligibility check, and `app/api/buyer/shortlist/route.ts` duplicated the service's logic inline
rather than calling it — so the service had no callers at all. The gate goes in the **service**, and
the route is thin and delegates, returning a distinct `LISTING_NOT_SHORTLIST_ELIGIBLE` (409).

**Display is not affected by the gate.** `app/api/public/inventory/route.ts` keeps
`where.isActive = true` with *no* freshness filter and gains a `freshness` field per item; same for
the detail route and the buyer shortlist GET. Every listing remains visible and searchable —
asserted by test.

> Scoping note: "display is unaffected" is true **of the freshness gate**. The *sweep fix* in the
> same change set flips ~95 rows to `isActive = false`, and every public surface filters on
> `isActive`. That is §3.3, and it is the intended correction — but the two claims must not be read
> as one.

**Aggregator rows now carry geography (added after review).** The upsert never wrote
`city`/`state`/`zip`/`latitude`/`longitude`, so every MarketCheck row had NULL coordinates and the
public ZIP+radius filter — a bounding box on lat/lng, then a haversine pass — dropped it. Re-pointing
to Dallas would have left a Dallas buyer filtering by ZIP with zero results, i.e. the market change
would have been invisible to the people it is for. The listing's dealer city/state/zip is now written
and coordinates resolved via `lookupZip`.

## 5. Owner-gated steps (Task 5)

Reported in full in `docs/inventory-market-repoint-owner-steps.md`. Nothing in that file is run by
this branch.

---

## 6. Tests written first (TDD)

| Suite (already wired into `pnpm test:all`) | New coverage |
| --- | --- |
| `test:inventory` → `lib/services/inventory/__tests__/` | market resolution order incl. **no NYC fallback**; env fallback; P2022 degradation and non-P2022 surfacing; multi-market fan-out and per-source attribution; deactivated source is not synced; sweep skipped on provider failure and on partial writes; dealer rows never demoted; geography written; `staleSweepWhere` matching the orphan shape and not dealer/admin rows; NULL-`lastSeenAt` reachability; 7 d/30 d boundaries; the two cross-consistency invariants |
| `test:cron` → `app/api/cron/__tests__/` | stale-sweep predicate at the route boundary; exempts dealer-managed and admin-curated; snapshot and mutation share one predicate; `dryRun` writes nothing and sends no email |
| `test:migrations` → `prisma/__tests__/` | existing `migration-chain.test.ts` guards (idempotent `ADD COLUMN`, no `UUID` type, rollback present) must stay green |

Shortlist-gate tests need a suite that `test:coverage-check` can see — a new
`test:shortlist` script added to `package.json` **and** to the `test:all` chain, since an unreachable
test file fails `pnpm test:coverage-check`.

## 7. Rollback

* Code: revert the branch.
* Schema: `prisma/migrations/20261104000000_inventory_source_market_config/rollback.sql` drops the
  nine additive columns. Nothing references them by FK, index, or constraint.
* Data: the sweep sets `is_active = false`; it never deletes. Reactivating is
  `UPDATE inventory_items SET is_active = true WHERE ...` — the exact statement is in the owner-steps
  doc.
