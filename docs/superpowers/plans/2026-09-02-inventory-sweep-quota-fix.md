# Inventory Sweep — Quota, Market Config, and Stale-Sweep Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut MarketCheck spend from ~850 calls/month (170% of a 500 cap) to ~310 (62%), make the
swept market configurable data instead of a code literal, repoint it to Dallas–Fort Worth, and fix
the stale sweep that has deactivated nothing while 95 rows rotted.

**Architecture:** Extend the existing adapter/orchestrator seams — no new service layer, no new
table. Geography, filters and a monthly call budget become columns on the single existing
`inventory_sources` row, resolved by a new config resolver that degrades to env vars so the code
runs correctly whether or not the migration has been applied. Pagination and the call ledger live
inside `MarketCheckAdapter.search()` so it still returns exactly one `AdapterRunResult` and the
existing per-source `InventorySyncRun` accounting stays 1:1. The stale sweep's predicate moves out
of two duplicated inline `where` clauses into one tested pure function.

**Tech Stack:** Next.js 16 App Router route handlers · Prisma 5 / Supabase Postgres ·
`node:test` + `tsx --test --experimental-test-module-mocks` · Vercel Cron.

**Spec:** this file (the owner's task brief of 2026-09-02, reproduced in §Context).

---

## RETRACTION — 2026-09-03: the P2022 warning was wrong, and both migrations are applied

**Everything below that describes `20261104000000` and `20261105000000` as "written but not
applied", and every P2022 exposure derived from that, is withdrawn.** Both migrations are
physically present in production. There was never any P2022 risk on the admin inventory routes or
the dealer analytics route, and nothing was ever about to 500.

**Basis — the physical schema, queried read-only against production `aieybibvewmvrubcpthm`
(PostgreSQL 17.6) on 2026-09-03.** Not the ledger, and not anyone's recollection:

| Object | Source | Result |
| --- | --- | --- |
| `inventory_items` provenance columns | `information_schema.columns` | **7 of 7 present** — `external_dealer_street`, `external_dealer_zip`, `external_dealer_email`, `external_dealer_type`, `mc_rooftop_id`, `mc_dealer_id`, `rooftop_id` |
| `inventory_sync_runs.api_calls_used` | `information_schema.columns` | **present** — `integer`, `DEFAULT 0`, `NOT NULL` |
| `inventory_sources` market/budget columns | `information_schema.columns` | **12 of 12 present** |
| `inventory_items_rooftop_id_fkey` | `pg_constraint` | **present**, `confdeltype='n'` (`ON DELETE SET NULL`) |
| `inventory_items_rooftop_id_idx` | `pg_indexes` | **present** |
| `SyncRunStatus.BUDGET_EXHAUSTED` | `pg_enum` | **present** |
| `inventory_sources` MARKETCHECK row | table read | `center_zip=76011`, `radius_miles=100`, `monthly_call_budget=400` — the repoint UPDATE ran |
| Ledger rows for either migration | `_prisma_migrations` | **neither recorded**; latest row is `20261103000000_apollo_reveal_empty_stage` |

**`_prisma_migrations` is not authoritative and must never be treated as such.** It records what
`prisma migrate deploy` did, not what the database contains. These migrations were applied out of
band, so the ledger says "pending" while the schema says "applied". `prisma migrate status` reads
the ledger, so it reports them pending too — it is the tool that produced this error, not a check
against it. **Verify against `information_schema.columns`, `pg_constraint`, `pg_indexes` and
`pg_enum` before concluding a migration is unapplied.**

**The drift is larger than these two.** The same read found **six** migrations physically applied
with no ledger row — `20261014000000`, `20261015000000`, both `20261016000000` directories, plus
these two. Every object each creates was confirmed present.

**Do not use `prisma migrate deploy` as the repair.** It would re-execute six migrations' DDL
against production. Use `prisma migrate resolve --applied` for all six, in chronological order —
it writes ledger rows and executes no DDL. See `frontend/scripts/check-ledger-drift.ts`, and
`pnpm db:check-ledger`, which now gates this class of drift.

**What is *not* retracted.** The narrowed `select`s added on the inventory read paths stay. They
were never load-bearing against a risk that turns out not to have existed, but they are correct on
their own terms and removing them would be churn. No further narrowing is warranted or authorised.

---

## Global Constraints

- **Do not apply the migration. Do not merge, deploy, or mutate production data.** The migration
  ships written-but-unapplied alongside the rest of the chain.
- MarketCheck Free tier: **500 calls/month · 5 calls/sec · 100 mile radius max · 500-row pagination
  ceiling · `rows` maxes at 50** · `GET https://api.marketcheck.com/v2/search/car/active`.
- Target: **one full sweep per day, ≤10 calls per sweep** (50 rows × 10 pages = 500 listings),
  ~310 calls/month.
- Money is integer minor units (`filterPriceMaxCents`); convert to dollars only at the adapter
  boundary.
- Business logic in `frontend/lib/services/**`; routes stay thin; no raw SDK calls outside adapters.
- Every new test file must land in a directory already globbed by a `test:*` script chained into
  `test:all`, or `pnpm test:coverage-check` fails. The glob expander is **non-recursive** — no new
  sub-directories.
- No DB `CHECK` constraints (see §Rejected). The 100-mile ceiling is enforced in code in two
  independent places and pinned by test.
- Full gate before any completion language: `pnpm typecheck` → `pnpm lint` →
  `pnpm test:coverage-check` → `pnpm test:all` → `pnpm build` (required: `schema.prisma` changes).
  CI's `migrations` job and `pnpm db:check-drift` are **not** in `test:all` and must be named
  explicitly in the report as not-run-here.

---

## Context — verified ground truth (do not re-derive)

Read from the repo and from read-only queries against Supabase `aieybibvewmvrubcpthm` on
2026-09-02.

**Calls per run = 1.** `runInventorySync()` (`orchestrator.ts:162`) maps over
`ADAPTERS = [new MarketCheckAdapter()]`; `search()` does a single `fetch()`
(`marketcheck.adapter.ts:72`). No pagination, no `start` param. Two crons × (24 + 4) = **28
calls/day ≈ 850/month**.

**Geography is an inline literal.** `marketcheck.adapter.ts:131` — `zip: params.zip ?? "10001"`.
Both crons call `runInventorySync({}, …)` with an empty params object, so the NYC fallback always
wins. A second hardcoded market list lives in `bootstrapInventory()` (`orchestrator.ts:350-356`).

**The cap is already blown.** `inventory_sync_runs`: **191 consecutive runs 2026-08-24 05:00 →
2026-08-31 00:01 with `status=DEFERRED, error="MarketCheck HTTP 429: Too Many Requests"`**. The
catalogue froze for seven days. 78 COMPLETED since. `vehicles_fetched` on COMPLETED runs ranges
**20–43**, not a constant.

**Stale-sweep root cause — a wrong predicate, not a crash.**

```sql
SELECT count(*) FROM inventory_items
 WHERE last_seen_at < now() - interval '48 hours'
   AND lane <> 'LANE_1' AND is_active = true;   -- the sweep's exact clause
-- → 0
```

The 95 stale-active rows are all `lane='LANE_1'` **with `dealer_id IS NULL`** and
`source_adapter IS NULL`, created 2026-04-24…2026-06-10, `external_dealer_state='NY'`. They are
open-market listings mislabeled LANE_1 by an older path. Both sweeps
(`inventory-stale-sweep/route.ts:43` and the duplicate at `orchestrator.ts:263`) use
`lane: { not: "LANE_1" }` as a **proxy for "dealer-verified"**; for these rows the proxy is false.
One of the 95 has `last_seen_at IS NULL`, which Prisma's `{ lt: cutoff }` silently excludes.

**Live mechanisms that keep manufacturing the orphan class** (must be closed or it recurs):
- `app/api/admin/inventory/search-tool/add/route.ts:58-59` writes `sourceAdapter:"manual_admin"`,
  **`lane:"LANE_1"`** with no `dealerId`, no `addedByAdminId`, no `lastSeenAt`.
- `app/api/admin/inventory/bulk-lane/route.ts` lets an operator set `LANE_1` on any id with **no
  dealer check**.

**Second uncounted quota consumer.** `app/api/admin/inventory/search-tool/run/route.ts:74` issues
its own `fetch` to `https://marketcheck-prod.apigee.net/...` on the same key, `rows=24`, outside any
budget. Volume is low (28/Apr, 4/May, 7/Jun, none since) but it is unmetered.

**Other verified facts:**

| Fact | Evidence |
| --- | --- |
| `orchestrator.ts:297` `inventorySource.update` has **no `select`** → returns every column → **P2022** the moment `schema.prisma` declares unmigrated columns | read; `upsert` at `:40` and `inventorySyncRun.create` at `:282` are already narrowed |
| `rollUpOutcome(["PARTIAL"])` returns `"NOT_CONFIGURED"` — `PARTIAL` matches no branch | `orchestrator.ts:143-156` |
| `inventory-eligibility.ts:42` makes **LANE_1 unconditionally freshness-exempt** — but `:40` requires provenance, and all 95 orphans have none, so matching is unaffected | read |
| **Zero `CHECK` constraints** in the 101-migration chain | `grep -rho 'CHECK (' prisma/migrations/ \| wc -l` → 0 |
| No `maxDuration` on any of the four inventory crons | `grep -rn maxDuration app/api/cron/inventory-*` → none |
| `cron-schedule.test.ts:67-81` pins `vercel.json` ↔ `CRON_STALENESS` **bidirectionally** | read |
| `dead-cron-cadence.test.ts:125` `PRE_FIX_BLIND_FLOOR = 34`; registry today 68 entries, slow 35 | read |
| **0** `auction_vehicles` reference any inventory item; **0** `inventory_quality_scores` | SQL |
| **10 of 15 `shortlist_items`** point at the 95; `app/buyer/shortlist/page.tsx:32` does **not** filter `isActive` | SQL + read |
| `MarketCoverage` (`schema.prisma:2350`) exists — `city/state/zip/status/listing_count/last_sync_at` | read |

---

## Rejected alternatives (stated, per the reuse-before-create protocol)

| Considered | Rejected because |
| --- | --- |
| **Reuse `MarketCoverage` instead of extending `inventory_sources`** | Searched `MarketCoverage`, `app/api/admin/inventory/markets/*`, `coverage-map`. It models *coverage reporting* per `(city,state)`; it has no source, no credential, no `type`, and its `listing_count`/`last_sync_at` are written by nothing. What is being configured here is **one provider source's query and spend**, which is 1:1 with the `inventory_sources` row the orchestrator already upserts. A per-API-key call budget does not belong on a per-city table. Mitigation: add a doc comment marking `MarketCoverage` display-only; file reconciliation as follow-up. |
| DB `CHECK` constraints for `radius_miles <= 100` etc. | Zero precedent in 101 migrations; Prisma cannot model them; `scripts/check-migration-drift.ts` fails in **both** directions past the `structuralStatements: 345` baseline. Enforced in code twice instead, pinned by test. |
| `center_latitude`/`center_longitude` columns | Nothing would emit them in `buildApiUrl`; a dead column whose failure mode is a silent wrong market. The brief says "center zip **or** lat/lng"; zip satisfies it and is the parameter already proven to work. |
| New columns on `InventorySyncRun` (`api_calls_used`, `stop_reason`, …) | Per-run evidence goes in `CronJobLog.result` (already JSON, already durable, already build-stamped by `withCronRun`). Keeps the schema change to one table and removes a class of P2022-on-write from the ingestion hot path during the unapplied-migration window. |
| Reserve-then-refund budget accounting | Draw immediately before each fetch instead. Removes the refund cycle-guard bug, double-reservation inflation, and the crash-burn window. A dispatched 429 was billed upstream, so refunding is the unsafe direction. |
| Deleting the `inventory-sync-priority` **route** | It is **de-scheduled**, not deleted — it stays as the cron-secret-gated manual re-run lever, now budget-gated at `maxCalls: 1`. |
| Refactoring `search-tool/run` onto `MarketCheckAdapter` | It carries a `condition` param the adapter hardcodes to `"used"`, surfaces listings `normalize()` drops, and emits `externalId` consumed by `search-tool/add`. Budget-gate it only; refactor is a follow-up. |
| `monthly_call_budget = NULL` as a kill switch | NULL means **unmetered** — that restores the blowout. The kill switch is `inventory_sources.is_active = false`. |
| Making `runInventorySync` throw so `withCronRun` records FAILED | Would change failure semantics of a wrapper shared by ~70 crons. Out of scope; named as follow-up. |

---

## File Structure

**Create**
- `frontend/lib/services/inventory/stale-sweep.service.ts` — the single sweep predicate + runner.
- `frontend/lib/services/inventory/inventory-source-config.service.ts` — market config resolution,
  clamps, constants.
- `frontend/lib/services/inventory/inventory-call-budget.service.ts` — monthly call ledger.
- `frontend/lib/services/inventory/sync-yield.ts` — the materially-short-run classifier.
- `frontend/prisma/migrations/20261104000000_inventory_market_config_and_call_budget/{migration,rollback}.sql`
- Tests (all in existing globbed dirs): `lib/services/inventory/__tests__/{stale-sweep,marketcheck-pagination,marketcheck-market-config,inventory-call-budget,sync-yield}.test.ts`,
  `app/api/cron/__tests__/inventory-stale-sweep-route.test.ts`,
  `prisma/__tests__/inventory-market-config-schema.test.ts`.

**Modify**
- `frontend/lib/services/inventory/adapters/marketcheck.adapter.ts` — pagination, config-driven
  query, delete the `"10001"` literal.
- `frontend/lib/services/inventory/adapters/IInventoryAdapter.ts` — `SearchParams` gains
  `rowsPerCall`/`maxCalls`/`budget`/`deadlineAt`/`priceMaxCents`; `AdapterOutcome` gains
  `BUDGET_EXHAUSTED`; `AdapterRunResult` gains yield evidence.
- `frontend/lib/services/inventory/orchestrator.ts` — resolve config, wire the budget, delete the
  inline duplicate sweep, narrow `inventorySource.update` with `select`, handle new outcomes in
  `outcomeToStatus`/`rollUpOutcome`/`computeHealthScore`, rewrite `bootstrapInventory`.
- `frontend/lib/services/inventory/inventory-eligibility.ts` — align the freshness exemption with
  the sweep.
- `frontend/app/api/cron/inventory-stale-sweep/route.ts` — delegate; keep the email side effects.
- `frontend/app/api/cron/inventory-sync-full/route.ts` — add `export const maxDuration = 300`.
- `frontend/app/api/cron/inventory-sync-priority/route.ts` — header comment: deliberately unscheduled.
- `frontend/vercel.json` + `frontend/lib/services/monitoring/cron-schedule.ts` — schedules (same commit).
- `frontend/app/api/admin/inventory/search-tool/{add,run}/route.ts`, `bulk-lane/route.ts` — close
  the orphan-manufacturing paths and budget-gate the ad-hoc call.
- `frontend/prisma/schema.prisma`, `frontend/env.d.ts`, `frontend/.env.example`.

---

## Task 1 — Stale-sweep predicate (the actual bug)

**Files:**
- Create: `frontend/lib/services/inventory/stale-sweep.service.ts`
- Test: `frontend/lib/services/inventory/__tests__/stale-sweep.test.ts`

**Interfaces:**
- Consumes: `freshnessCutoff`, `FRESHNESS_WINDOW_MS` from `inventory-eligibility.ts`.
- Produces: `staleSweepWhere(now?): Prisma.InventoryItemWhereInput`,
  `isStaleSweepable(item, now?): boolean`, `CURATED_SOURCE_ADAPTERS`,
  `sweepStaleInventory(opts): Promise<SweepResult>`, `sweepMode()`, `sweepAbortThreshold()`.

- [ ] **Step 1: Write the failing test** — `__tests__/stale-sweep.test.ts`

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { isStaleSweepable, staleSweepWhere } from "@/lib/services/inventory/stale-sweep.service";

const NOW = new Date("2026-09-02T18:00:00Z");
const STALE = new Date("2026-06-01T00:00:00Z");   // ~3 months old
const FRESH = new Date("2026-09-02T12:00:00Z");
const base = { isActive: true, lane: "LANE_3", dealerId: null as string | null,
  addedByAdminId: null as string | null, sourceAdapter: "marketcheck" as string | null,
  lastSeenAt: FRESH as Date | null, createdAt: STALE };

test("the 94 prod orphans are sweepable: LANE_1 with NO dealer", () => {
  assert.equal(isStaleSweepable({ ...base, lane: "LANE_1", sourceAdapter: null,
    lastSeenAt: STALE }, NOW), true);
});

test("the 1 prod orphan with lastSeenAt NULL is sweepable via createdAt", () => {
  assert.equal(isStaleSweepable({ ...base, lane: "LANE_1", sourceAdapter: null,
    lastSeenAt: null, createdAt: STALE }, NOW), true);
});

test("a row created minutes ago with no lastSeenAt is NOT swept (grace)", () => {
  assert.equal(isStaleSweepable({ ...base, lastSeenAt: null,
    createdAt: new Date(NOW.getTime() - 10 * 60_000) }, NOW), false);
});

test("dealer-owned LANE_1 is protected — the invariant the proxy stood for", () => {
  assert.equal(isStaleSweepable({ ...base, lane: "LANE_1", dealerId: "d1",
    lastSeenAt: STALE }, NOW), false);
});

test("REGRESSION: dealer-owned LANE_2/LANE_3 stay sweepable (removal email must stay reachable)", () => {
  assert.equal(isStaleSweepable({ ...base, lane: "LANE_2", dealerId: "d1", lastSeenAt: STALE }, NOW), true);
  assert.equal(isStaleSweepable({ ...base, lane: "LANE_3", dealerId: "d1", lastSeenAt: STALE }, NOW), true);
});

test("admin-curated rows are exempt", () => {
  assert.equal(isStaleSweepable({ ...base, addedByAdminId: "a1", lastSeenAt: STALE }, NOW), false);
  assert.equal(isStaleSweepable({ ...base, sourceAdapter: "manual_admin", lastSeenAt: STALE }, NOW), false);
  assert.equal(isStaleSweepable({ ...base, sourceAdapter: "csv_upload_admin", lastSeenAt: STALE }, NOW), false);
});

test("THREE-VALUED-LOGIC GUARD: curated exclusion is an OR on null, never a bare NOT-IN", () => {
  const w = JSON.stringify(staleSweepWhere(NOW));
  assert.ok(w.includes('"sourceAdapter":null'),
    "must OR on sourceAdapter:null — SQL `NULL NOT IN (...)` is NULL and would re-protect all 95 rows");
  assert.ok(!/"NOT":\{"sourceAdapter"/.test(w), "must not use a bare NOT/in form");
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd frontend && pnpm test:inventory
```
Expected: FAIL — `Cannot find module '@/lib/services/inventory/stale-sweep.service'`.

- [ ] **Step 3: Write the predicate**

```ts
// frontend/lib/services/inventory/stale-sweep.service.ts
import type { Prisma } from "@prisma/client";
import { InventoryLane } from "@prisma/client";
import { freshnessCutoff } from "./inventory-eligibility";

/** Provenance written by the HUMAN-CURATED writers. Belt-and-braces beside the
 *  addedByAdminId clause: search-tool/add historically wrote sourceAdapter
 *  "manual_admin" with NO addedByAdminId. That route is corrected in Task 2;
 *  this list still protects the rows it already wrote. */
export const CURATED_SOURCE_ADAPTERS = ["manual_admin", "csv_upload_admin"] as const;

export function staleSweepWhere(now: Date = new Date()): Prisma.InventoryItemWhereInput {
  const cutoff = freshnessCutoff(now);   // reuses FRESHNESS_WINDOW_MS — not a second literal
  return {
    AND: [
      { isActive: true },

      // FRESHNESS. `{ lt }` compiles to `<`, which is NULL for a NULL column and
      // SILENTLY EXCLUDES it — that is why the orphan with last_seen_at IS NULL was
      // invisible. createdAt is the fallback clock so a row created minutes ago is
      // not swept before its first sync.
      { OR: [
        { lastSeenAt: { lt: cutoff } },
        { AND: [{ lastSeenAt: null }, { createdAt: { lt: cutoff } }] },
      ] },

      // DEALER-VERIFIED PROTECTION. `lane != LANE_1` was standing in for
      // NOT (lane = LANE_1 AND dealer_id IS NOT NULL). Written as an explicit OR so it
      // does not depend on NULL semantics. Dealer-owned LANE_2/LANE_3 stay sweepable,
      // which keeps the cron's dealer removal email reachable.
      { OR: [
        { lane: { not: InventoryLane.LANE_1 } },
        { dealerId: null },
      ] },

      // HUMAN-CURATED PROTECTION. An admin-entered vehicle has no feed to vanish from.
      { addedByAdminId: null },

      // Same, for historical rows carrying curated provenance but no admin id.
      // MUST be this OR, never `NOT: { sourceAdapter: { in: [...] } }`: SQL
      // `NULL NOT IN (...)` evaluates to NULL, which would silently re-protect all 95
      // target rows — the fix would ship, typecheck, run green, and change nothing.
      { OR: [
        { sourceAdapter: null },
        { sourceAdapter: { notIn: [...CURATED_SOURCE_ADAPTERS] } },
      ] },
    ],
  };
}

export function isStaleSweepable(
  item: { isActive: boolean; lane: string; dealerId: string | null;
          addedByAdminId: string | null; sourceAdapter: string | null;
          lastSeenAt: Date | null; createdAt: Date },
  now: Date = new Date(),
): boolean {
  if (!item.isActive) return false;
  const cutoff = freshnessCutoff(now);
  const unseen = item.lastSeenAt != null ? item.lastSeenAt < cutoff : item.createdAt < cutoff;
  if (!unseen) return false;
  if (item.lane === "LANE_1" && item.dealerId != null) return false;
  if (item.addedByAdminId != null) return false;
  if (item.sourceAdapter != null &&
      (CURATED_SOURCE_ADAPTERS as readonly string[]).includes(item.sourceAdapter)) return false;
  return true;
}
```

- [ ] **Step 4: Run the tests** — `pnpm test:inventory`. Expected: PASS.

- [ ] **Step 5: Add the runner with dry-run + blast-radius breaker**

Append to the same file:

```ts
export type SweepMode = "dry_run" | "enforce" | "off";
export const DEFAULT_SWEEP_ABORT_THRESHOLD = 150;

export function sweepMode(): SweepMode {
  const raw = (process.env.INVENTORY_STALE_SWEEP_MODE ?? "dry_run").trim();
  return raw === "enforce" || raw === "off" ? raw : "dry_run";   // fail safe
}
export function sweepAbortThreshold(): number {
  const raw = Number(process.env.INVENTORY_SWEEP_MAX_DEACTIVATIONS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_SWEEP_ABORT_THRESHOLD;
}
```

`sweepStaleInventory({ now, mode, prisma })` returns
`{ mode, candidates, deactivated, aborted, deactivatedIds, idsTruncated, breakdown }`:
- `off` → `{ skipped: true }`, runs no query (the **route still writes its CronJobLog**, so a
  disabled sweep never reads as a dead cron).
- SELECT ids via `staleSweepWhere(now)` first — always, in every mode.
- `candidates > sweepAbortThreshold()` → deactivate nothing, `aborted: true`, one `SYSTEM_ALERT`.
  *Why 150:* the legitimate first enforce run is 95; a repeat of the Aug 24–31 429 blackout against
  a ~500-row DFW catalogue would make every row stale and must refuse rather than wipe the
  catalogue. An aborted sweep is **not** a FAILED cron — it did what it was told.
- `dry_run` → return `candidates` + `breakdown` + ≤50 sample ids; `updateMany` is called **zero**
  times.
- `enforce` → `updateMany({ where: { id: { in: ids } }, data: { isActive: false } })`, and record
  the ids (cap 500) so rollback is a literal `UPDATE … WHERE id IN (…)`.

- [ ] **Step 6: Test the modes** — dry-run calls `updateMany` zero times; `off` runs no query;
  over-threshold aborts and creates one `SYSTEM_ALERT`; `enforce` returns `deactivatedIds`.

- [ ] **Step 7: Fixture-parity test** — a set modelling the exact prod composition (94 orphans,
  1 null-`lastSeenAt` orphan, 1 LANE_1+dealer, 1 LANE_2+dealer stale, 1 admin-curated) selects
  exactly **96** via `isStaleSweepable` (95 orphans + the dealer LANE_2).

- [ ] **Step 8: Commit**

```bash
git add frontend/lib/services/inventory/stale-sweep.service.ts \
        frontend/lib/services/inventory/__tests__/stale-sweep.test.ts
git commit -m "fix(inventory): sweep LANE_1 rows that have no dealer, and rows with NULL last_seen_at"
```

---

## Task 2 — Align eligibility, and close the paths that manufacture orphans

**Files:**
- Modify: `frontend/lib/services/inventory/inventory-eligibility.ts`
- Modify: `frontend/app/api/admin/inventory/search-tool/add/route.ts:58-59`
- Modify: `frontend/app/api/admin/inventory/bulk-lane/route.ts`
- Test: extend `frontend/lib/services/inventory/__tests__/inventory-eligibility.test.ts`

**Interfaces:** Produces `isFreshnessExempt(item): boolean` and
`freshnessExemptWhere(): Prisma.InventoryItemWhereInput` in `inventory-eligibility.ts`, exported so
that **Task 1's `staleSweepWhere`/`isStaleSweepable` are refactored in this task to consume them**
— one definition of "exempt from the freshness clock", used by both the sweep and matching, so
"existing" and "executable" cannot diverge. Task 1 ships the predicate inline; this task extracts
it. The cross-check test in Step 2 is what holds them together afterwards.

- [ ] **Step 1: Failing test** — `isExecutableSupply({ lane:"LANE_1", dealerId:null,
  sourceAdapter:"marketcheck", lastSeenAt: STALE })` must be `false`. Today `:42` exempts LANE_1
  unconditionally. Also: `{ addedByAdminId:"a1", lane:"LANE_3", lastSeenAt: STALE }` must be `true`.
- [ ] **Step 2: Cross-check test** — over a fixture matrix, **no row is simultaneously
  `isFreshnessExempt` and `isStaleSweepable`.**
- [ ] **Step 3: Run** — `pnpm test:inventory`. Expected FAIL on both.
- [ ] **Step 4: Implement** — change `:42` from `{ OR: [{ lane: "LANE_1" }, …] }` to
  `{ OR: [{ AND: [{ lane: "LANE_1" }, { dealerId: { not: null } }] }, { addedByAdminId: { not: null } }, { lastSeenAt: { gte: cutoff } }] }`,
  and mirror it in `isExecutableSupply`. The eight existing assertions stay green unmodified.
- [ ] **Step 5: Close `search-tool/add`** — `lane: "LANE_1"` → `lane: "LANE_3"` (it has no dealer;
  LANE_1 asserts a partnership that does not exist and drives a false "Verified — directly from a
  verified AutoLenis dealer partner" badge), plus `addedByAdminId: admin.adminId` and
  `lastSeenAt: new Date()`.
- [ ] **Step 6: Close `bulk-lane`** — reject `lane: LANE_1` for any selected id whose
  `dealerId === null`; 400, naming the offending ids. Add a route test.
- [ ] **Step 7: Run** — `pnpm test:inventory && pnpm test:admin-dealers`. Expected PASS.
- [ ] **Step 8: Commit** — `fix(inventory): stop minting LANE_1 rows with no dealer; align freshness exemption with the sweep`

---

## Task 3 — Market config: schema, migration, resolver

**Files:**
- Create: `frontend/lib/services/inventory/inventory-source-config.service.ts`
- Create: `frontend/prisma/migrations/20261104000000_inventory_market_config_and_call_budget/migration.sql` **and** `rollback.sql`
- Modify: `frontend/prisma/schema.prisma` (model `InventorySource`, enum `SyncRunStatus`)
- Modify: `frontend/env.d.ts`, `frontend/.env.example`
- Test: `frontend/lib/services/inventory/__tests__/marketcheck-market-config.test.ts`,
  `frontend/prisma/__tests__/inventory-market-config-schema.test.ts`

**Interfaces:** Produces `resolveMarketConfig(type, name, deps?) → MarketConfigResult`,
`clampRadius(v) → { miles, clamped }`, `resolveMonthlyBudget(rowValue) → number | null`, and the
constants `MAX_RADIUS_MILES=100`, `MAX_ROWS_PER_CALL=50`, `MAX_CALLS_PER_SWEEP=10`,
`PROVIDER_PAGINATION_LIMIT=500`, `DEFAULT_MONTHLY_CALL_BUDGET=400`, `DEFAULT_RADIUS_MILES=100`.

- [ ] **Step 1: Failing tests**
  - No source row and no env → `runInventorySync` makes **zero** fetches, outcome
    `NOT_CONFIGURED`, and `"10001"` appears in **no** constructed URL.
  - Source-file assertion: `marketcheck.adapter.ts` contains no `10001` literal;
    `orchestrator.ts` contains no hardcoded market array.
  - Row `centerZip:"76011", radiusMiles:250` → URL has `zip=76011` **and `radius=100`**,
    `radiusClamped: true`.
  - `clampRadius(null)` → `{ miles: 100, clamped: false }` — **not 1**. (`Math.max(null, 1)` is 1
    in JS; that bug would silently produce a one-mile market.)
  - `filterPriceMaxCents: 3_500_000` → `price_max=35000`.
  - Simulated P2022 → `configSource:"env"`, DFW zip from `INVENTORY_SWEEP_ZIP`, run still ingests.
  - A **non**-P2021/P2022 config read error → `DEFERRED`, not `NOT_CONFIGURED`.
  - `isActive:false` on the source row → `NOT_CONFIGURED`, error `"source is inactive"`, zero
    fetches, `healthScore` null, no alert.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Add the Prisma fields** — twelve additive columns on `InventorySource`, all
  nullable or defaulted:

```prisma
  // ── Swept market (inventory market config + call budget) ──────────────────
  // Geography is CONFIG, never a code literal. A source with no centerZip and no
  // INVENTORY_SWEEP_ZIP fallback is NOT_CONFIGURED and makes zero calls.
  centerZip           String?  @map("center_zip")
  radiusMiles         Int?     @map("radius_miles")            // clamped to 1..100 in code
  filterMake          String?  @map("filter_make")
  filterModel         String?  @map("filter_model")
  filterYearMin       Int?     @map("filter_year_min")
  filterYearMax       Int?     @map("filter_year_max")
  filterPriceMaxCents Int?     @map("filter_price_max_cents")  // integer cents

  // ── Sweep shape + monthly provider call budget ────────────────────────────
  rowsPerCall        Int     @default(50) @map("rows_per_call")
  maxCallsPerRun     Int     @default(10) @map("max_calls_per_run")
  monthlyCallBudget  Int?    @map("monthly_call_budget")       // NULL = unmetered (CUSTOM feeds)
  callsUsedThisCycle Int     @default(0)  @map("calls_used_this_cycle")
  budgetCycleKey     String? @map("budget_cycle_key")          // "YYYY-MM" UTC, roll-FORWARD only
```

Append `BUDGET_EXHAUSTED` to `enum SyncRunStatus`. `PARTIAL` already exists and is currently
unreachable — it becomes the honest status for "pages 1–3 landed, page 4 returned 429". No enum
change needed for it.

- [ ] **Step 4: Write the migration** (header modelled on `20261103000000_apollo_reveal_empty_stage`)

```sql
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "center_zip" TEXT;
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "radius_miles" INTEGER;
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "filter_make" TEXT;
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "filter_model" TEXT;
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "filter_year_min" INTEGER;
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "filter_year_max" INTEGER;
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "filter_price_max_cents" INTEGER;
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "rows_per_call" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "max_calls_per_run" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "monthly_call_budget" INTEGER;
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "calls_used_this_cycle" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "budget_cycle_key" TEXT;

ALTER TYPE "SyncRunStatus" ADD VALUE IF NOT EXISTS 'BUDGET_EXHAUSTED';

-- Dallas-Fort Worth repoint. This is an UPDATE, not a guarded INSERT: production
-- already holds exactly one inventory_sources row (MARKETCHECK/"MarketCheck",
-- verified read-only 2026-09-02) created by ensureInventorySource(). A
-- `WHERE NOT EXISTS` INSERT would be a no-op and the repoint would silently never
-- happen. On an empty chain-built database this matches zero rows, which is correct.
-- The `center_zip IS NULL` guard means a later owner edit is never overwritten.
UPDATE "inventory_sources"
   SET "center_zip" = '76011', "radius_miles" = 100, "monthly_call_budget" = 400
 WHERE "type" = 'MARKETCHECK' AND "center_zip" IS NULL;
```

Header must record: **WRITTEN BUT NOT APPLIED**; why (the `?? "10001"` literal, 191 × HTTP 429);
scope is additive only; **no CHECK constraints, deliberately** (with the drift-baseline reason);
idempotency; that the `ALTER TYPE` label is not referenced by any later statement in the file (the
in-transaction restriction); RLS untouched — `inventory_sources`/`inventory_items`/
`inventory_sync_runs` are `relrowsecurity=true` with **zero policies** in prod, and adding a policy
to a zero-policy table *opens* access; apply-before-code; and a pointer to `rollback.sql`.

`rollback.sql` drops exactly those 12 columns. `SyncRunStatus.BUDGET_EXHAUSTED` **cannot** be
dropped (Postgres has no `DROP VALUE`); document that it is inert once the code is reverted, and
that the **code must be rolled back first**.

- [ ] **Step 5: Migration correspondence test** — modelled exactly on
  `prisma/__tests__/apollo-reveal-empty-stage-schema.test.ts`: pure `node:fs` + regex, **no
  `mock.module`** (`test:migrations` runs without `--experimental-test-module-mocks`); strip
  comments **before** every safety assertion. Assert: all 12 Prisma fields with exact type,
  nullability and `@map`; all 12 `ADD COLUMN IF NOT EXISTS` lines verbatim; rollback drops exactly
  those 12; the `ALTER TYPE … ADD VALUE IF NOT EXISTS` line is present and unreferenced later; no
  `DROP TABLE|COLUMN`, no `CREATE/ALTER/DROP POLICY`, no `ROW LEVEL SECURITY`, no `\bUUID\b`, and
  **no `CHECK (`** (pinning the deliberate rejection); and the DFW seed is an **`UPDATE`, not an
  `INSERT`**.
- [ ] **Step 6: Implement the resolver** — order is **row → env → NOT_CONFIGURED**. A P2021/P2022
  (migration unapplied) degrades to env and stamps `configSource:"env"`; **any other** read error is
  `config_read_error` → `DEFERRED`, so a deploy-order mistake reads as an incident rather than a
  config gap. `resolveMonthlyBudget` never returns `null` for MARKETCHECK — only a non-MARKETCHECK
  (CUSTOM dealer feed) source is unmetered.
- [ ] **Step 7: Declare env names** in `env.d.ts` and `.env.example` (existing "Search intelligence
  / inventory data" section).
- [ ] **Step 8: Run** — `pnpm test:inventory && pnpm test:migrations && pnpm typecheck`.
- [ ] **Step 9: Commit** — `feat(inventory): make the swept market configurable on inventory_sources (migration unapplied)`

---

## Task 4 — Monthly call budget ledger

**Files:**
- Create: `frontend/lib/services/inventory/inventory-call-budget.service.ts`
- Test: `frontend/lib/services/inventory/__tests__/inventory-call-budget.test.ts`

**Interfaces:** Produces `cycleKeyFor(date)`, `rollCycleForward(sourceId, cycleKey, deps?)`,
`tryConsumeCall(sourceId, cycleKey, budget, deps?)`, `remainingCalls(...)`,
`makeCallBudget(...)`, `makeStaticBudget(n)`, `interface CallBudget { acquire(): Promise<boolean>; spent(): number }`.

Pattern to follow: `lib/services/dealer-recruitment/apollo-credit-ledger.service.ts:66-79` — read the
cap, then a **guarded conditional `updateMany`**. The increment is atomic in Postgres, so a second
concurrent draw at the cap re-evaluates against committed state and matches zero rows.

- [ ] **Step 1: Failing tests**
  - `callsUsedThisCycle === monthlyCallBudget` → zero fetches, `InventorySyncRun.status ===
    "BUDGET_EXHAUSTED"`, excluded from the health denominator, **one** `SYSTEM_ALERT`.
  - Two sequential draws at cap−1: exactly one authorised; the counter never exceeds the budget.
  - **ROLL-FORWARD ONLY** — `budgetCycleKey:"2026-08"` evaluated in September resets to 0 and sets
    `"2026-09"`; a row already on `"2026-09"` evaluated with an August `now` is **NOT** reset. (`lt`
    on `"YYYY-MM"` is lexicographic = chronological. Without this guard a run holding a stale `now`
    across a month boundary rewinds the key and zeroes the new month's recorded spend.)
  - `budgetCycleKey: null` rolls over on first use.
  - `makeStaticBudget(10)` authorises exactly 10 and touches **no** Prisma delegate.
  - A second `SYSTEM_ALERT` in the same cycle is suppressed by the dedup.
- [ ] **Step 2: Run** — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5: Commit** — `feat(inventory): monthly MarketCheck call ledger on the source row`

---

## Task 5 — Pagination + the materially-short-run rule

**Files:**
- Modify: `frontend/lib/services/inventory/adapters/marketcheck.adapter.ts`,
  `adapters/IInventoryAdapter.ts`
- Create: `frontend/lib/services/inventory/sync-yield.ts`
- Test: `__tests__/marketcheck-pagination.test.ts`, `__tests__/sync-yield.test.ts`

**Why the loop lives inside `search()`:** `orchestrator.ts:275-315` writes **one**
`InventorySyncRun` per `AdapterRunResult`, and `computeHealthScore` divides by result count.
Paginating by calling `search()` ten times from the orchestrator would write ten sync-run rows per
sweep and turn "1 bad page in 10" into "90% healthy".

- [ ] **Step 1: Failing pagination tests**
  - `num_found: 5000`, full pages → exactly **10** fetches with `start` = 0,50,…,450, and **no**
    request where `start + rows > 500`. Today: exactly one fetch, no `start`.
  - Feed 50/50/50/20 → 4 fetches, `stopReason:"SHORT_PAGE"`, `apiCallsUsed:4`, `rawListings:170`.
  - `rawListings >= num_found` → `NUM_FOUND_REACHED`; a page contributing zero new `sourceKey`s →
    `NO_NEW_KEYS` (a real failure mode when `start` is ignored — without it a 10-call sweep ingests
    page 0 ten times).
  - `maxCallsPerRun: 25` is still bounded to 10 by `MAX_CALLS_PER_SWEEP`.
  - Same VIN on pages 2 and 5 → **one** upsert; `rawListings` counts both.
  - 429 on **page 0** → `DEFERRED`, `apiCallsUsed:1`, zero vehicles (unchanged behaviour). 429 on
    **page 4** after 3 good pages → `PARTIAL`, `apiCallsUsed:4`, the 150 collected vehicles
    retained, HTTP status in `error`.
  - `budget.acquire()` false at page 3 → 3 fetches, `BUDGET_EXHAUSTED` stop; false at page 0 →
    **zero** fetches, outcome `BUDGET_EXHAUSTED`.
  - **422 handling (documented provider rule).** `num_found: 120` with full 50-row pages → the
    pre-fetch guard stops at `start=100` after **3** fetches, never spending a 4th call to earn a
    422. And a stubbed 422 on page 3 → `stopReason:"NUM_FOUND_REACHED"`, outcome stays `SUCCESS`,
    the already-collected vehicles are retained, `error` is `undefined` — **not** `FAILED`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement the loop**

```ts
const rows0    = Math.min(params.rowsPerCall ?? MAX_ROWS_PER_CALL, MAX_ROWS_PER_CALL);  // 50
const maxCalls = Math.min(params.maxCalls ?? 1, MAX_CALLS_PER_SWEEP);                   // 10, compiled
const budget   = params.budget ?? makeStaticBudget(maxCalls);
const deadline = params.deadlineAt ?? (Date.now() + SWEEP_DEADLINE_MS);                 // 90_000

const seen = new Map<string, NormalizedVehicle>();
let start = 0, pagesFetched = 0, pagesFailed = 0, rawListings = 0;
let numFound: number | null = null, maxDist: number | null = null;
let stopReason: StopReason | null = null;
let outcome: AdapterOutcome = "SUCCESS";
let error: string | undefined;

while (pagesFetched < maxCalls) {
  if (start >= PROVIDER_PAGINATION_LIMIT) { stopReason = "PROVIDER_CEILING"; break; }
  // Documented provider rule: `start` past num_found returns HTTP 422. Overrunning
  // the end of the result set is exhaustion, not an error — never spend a call to
  // discover it, and never let it be recorded as a failure.
  if (numFound !== null && start >= numFound) { stopReason = "NUM_FOUND_REACHED"; break; }
  const rows = Math.min(rows0, PROVIDER_PAGINATION_LIMIT - start);  // start=450 -> 50 (450+50<=500)
  if (Date.now() >= deadline)    { stopReason = "DEADLINE"; break; }
  if (!(await budget.acquire())) { stopReason = "BUDGET_EXHAUSTED"; break; }

  const page = await this.fetchPage(start, rows, apiKey, params);   // timeout 12_000

  // 422 = `start` past the end of the result set (documented). Belt-and-braces
  // behind the pre-fetch guard above: terminate cleanly, keep everything already
  // collected, and do NOT record a failure. Without this branch a 422 falls into
  // the 4xx path below and a complete sweep reports FAILED.
  if (page.status === 422) { stopReason = "NUM_FOUND_REACHED"; break; }

  if (!page.ok) {
    pagesFailed++;
    stopReason = "PROVIDER_ERROR";
    error = `MarketCheck HTTP ${page.status} on page ${pagesFetched} (start=${start})`;
    if (pagesFetched === 0) outcome = page.transient ? "DEFERRED" : "FAILED";  // preserve today
    else                    outcome = "PARTIAL";
    break;
  }

  pagesFetched++;
  rawListings += page.listings.length;
  if (numFound === null) numFound = page.numFound ?? null;   // page 0 ONLY — later values drift
  let newKeys = 0;
  for (const l of page.listings) {
    if (typeof l.dist === "number") maxDist = Math.max(maxDist ?? 0, l.dist);
    const v = this.normalize(l);
    if (!v) continue;
    if (!seen.has(v.sourceKey)) { seen.set(v.sourceKey, v); newKeys++; }
    else if (v.images.length > seen.get(v.sourceKey)!.images.length) seen.set(v.sourceKey, v);
  }

  if (page.listings.length < rows)                    { stopReason = "SHORT_PAGE"; break; }
  if (numFound !== null && rawListings >= numFound)   { stopReason = "NUM_FOUND_REACHED"; break; }
  if (newKeys === 0 && page.listings.length > 0)      { stopReason = "NO_NEW_KEYS"; break; }

  start += rows;
  if (pagesFetched < maxCalls) await sleep(MIN_INTER_CALL_MS);   // 250ms -> 4 req/s, under 5/s
}
if (!stopReason) stopReason = "PAGE_CAP";
```

**Cap enforcement — three independent layers, none load-bearing alone:** (1) `MAX_CALLS_PER_SWEEP`
compiled in and `min()`-ed against the DB value, so a corrupt `max_calls_per_run = 999` cannot
raise it; (2) `budget.acquire()` is the **last statement before every fetch** — no path fetches
without a draw, so there is no drawn-but-not-dispatched state and **no refund surface at all**;
(3) `PROVIDER_PAGINATION_LIMIT` bounds `start` regardless of both.

**Off-by-one:** MarketCheck's constraint is `start + rows <= 500`, so `start=450, rows=50` is legal.
Guard on `start >= 500` with the last page trimmed to `500 - start` — **not** `start + rows >= 500`,
which would cap the sweep at 9 calls / 450 listings.

`buildApiUrl`: `zip`/`radius` from resolved config with **no `?? "10001"` anywhere** (delete the
literal); `radius: String(Math.min(params.radius ?? DEFAULT_RADIUS_MILES, MAX_RADIUS_MILES))` — the
second, independent radius cap; add `start`, `rows`; `price_max: String(Math.floor(priceMaxCents/100))`.

- [ ] **Step 4: Failing yield tests, then implement `sync-yield.ts`**

```ts
export function expectedListings(e: YieldEvidence): number | null {
  if (e.numFound == null) return null;
  return Math.min(e.numFound, e.pagesFetched * e.rowsPerCall, PROVIDER_PAGINATION_LIMIT);
}

export function classifyYield(e: YieldEvidence): { outcome: AdapterOutcome; reason: string | null } {
  // Gate 0 — only ever DOWNGRADE a claimed success.
  if (e.outcome !== "SUCCESS" && e.outcome !== "ZERO_RESULTS") return { outcome: e.outcome, reason: null };

  // Gate 1 — COVERAGE: raw listings received vs what the provider said was there.
  const expected = expectedListings(e);
  if (expected !== null) {
    const shortfall = expected - e.rawListings;
    if (shortfall >= MIN_ABSOLUTE_SHORTFALL &&
        e.rawListings < Math.floor(expected * COVERAGE_MIN_RATIO)) {
      return { outcome: "FAILED", reason:
        `short run: received ${e.rawListings} raw listings of ${expected} expected ` +
        `(num_found ${e.numFound}, ${e.pagesFetched} pages x ${e.rowsPerCall} rows)` };
    }
  }

  // Gate 2 — NORMALIZATION LOSS: invisible today. A provider response-shape change
  // would halve ingestion with every run still reporting COMPLETED.
  if (e.rawListings >= NORMALIZE_MIN_RAW &&
      e.normalized < Math.floor(e.rawListings * NORMALIZE_MIN_RATIO)) {
    return { outcome: "FAILED", reason:
      `normalization dropped ${e.rawListings - e.normalized} of ${e.rawListings} listings` };
  }
  return { outcome: e.outcome, reason: null };
}
```

**Thresholds and the false positive each one closes:**

| Threshold | Value | Why |
| --- | --- | --- |
| Denominator is `num_found`, never a constant | — | A genuinely small market reports a small `num_found`, so the expectation shrinks with the market: **a small market is structurally incapable of a false FAILED.** `num_found 37`, 37 received → ratio 1.0. |
| `min(…, pagesFetched × rowsPerCall)` — pages **fetched**, not `maxCalls` | — | Closes the budget-truncation false positive: 2 of 10 calls granted, 100 raw against `num_found 40000` → expected 100 → SUCCESS. |
| `min(…, 500)` | 500 | Hitting the provider's deep-page ceiling is the design. 500 of a 4,000-listing market → shortfall 0. |
| Failed pages excluded from `pagesFetched` | — | A 429 on page 4 is Gate 0's business (`PARTIAL`); it must not *also* be laundered into a coverage FAILED that hides the cause. |
| `COVERAGE_MIN_RATIO` | **0.8** | A full page returns exactly `rows`, so an unbroken walk is 1.0. 20% absorbs churn between the page-0 count and a 10-page walk over a live index. Below 0.8 means a page went missing while the provider still claimed the rows. |
| `MIN_ABSOLUTE_SHORTFALL` | **25** (half a page) | Anti-flap. On a small set, churn is a big *fraction* but a tiny *count* — `num_found 30 / raw 22` is 73% but only 8 short. Below half a page it cannot be a dropped page, and a dropped page is the only thing this gate exists to catch. |
| `NORMALIZE_MIN_RATIO` | **0.25** | **Calibrated against production, not invented:** COMPLETED runs yield 20–43 vehicles from a 25- or 50-row call → observed normalize yield **≥0.40**. 0.25 sits below the worst observed value, so normal variance cannot trip it, while a response-shape break (yield → ~0) trips instantly. |
| `NORMALIZE_MIN_RAW` | **25** | Same anti-flap logic on small samples. |

**`num_found` absent → the gate is inert and that must be visible:** `expectedListings` returns
`null`, no FAILED is claimed (never fabricate a denominator), and the run records
`coverage: "UNKNOWN"` with `numFound: null` in `CronJobLog.result`. **See Open Question 1.**

False-positive suite (all must be non-FAILED): `num_found 12/raw 12`; `0/0` → ZERO_RESULTS;
`30/22`; `4000/500` at the page cap; `40000` with 2 of 10 calls and raw 100; `num_found null`.
Plus `rawListings 50, normalized 20` (ratio 0.40, the worst observed production yield) → **not**
FAILED — this test guards the calibration.

- [ ] **Step 5: Run** — `pnpm test:inventory`. **Step 6: Commit** —
  `feat(inventory): paginate MarketCheck to <=10 calls and fail materially short runs`

---

## Task 6 — Orchestrator wiring

**Files:** Modify `frontend/lib/services/inventory/orchestrator.ts`; modify
`frontend/app/api/cron/inventory-stale-sweep/route.ts`; add `export const maxDuration = 300` to
`inventory-sync-full/route.ts`. Extend `__tests__/orchestrator.test.ts`,
`__tests__/orchestrator-rollup.test.ts`; create `app/api/cron/__tests__/inventory-stale-sweep-route.test.ts`.

- [ ] **Step 1: Failing tests**
  - A `mode:"full"` run calls `prisma.inventoryItem.updateMany` **zero** times (the inline
    duplicate sweep at `:258-267` is gone) and `OrchestratorRunResult` no longer exposes
    `deactivated`.
  - `prisma.inventorySource.update` is called with `select: { id: true }`. **Unnarrowed it throws
    P2022 against an unmigrated DB, silently, inside the existing `.catch(()=>{})`.**
  - The VIN prefetch is **one** `inventoryItem.findMany({ where: { vin: { in: [...] } } })`, not N
    `findFirst` calls (`:191`) — at 500 vehicles that is 500 round-trips.
  - `rollUpOutcome(["PARTIAL"]) === "PARTIAL"`. **Silently green today**: these are `.some()`
    string checks, not compile-enforced, so `PARTIAL` currently falls through every branch and
    returns `"NOT_CONFIGURED"` — a run that fetched 3 of 10 pages and ingested 150 vehicles would
    report itself as an unconfigured provider.
  - `rollUpOutcome(["SUCCESS","PARTIAL"]) === "PARTIAL"`;
    `rollUpOutcome(["BUDGET_EXHAUSTED"]) === "BUDGET_EXHAUSTED"`;
    `rollUpOutcome(["SUCCESS","BUDGET_EXHAUSTED"]) === "SUCCESS"`.
  - `computeHealthScore` excludes `BUDGET_EXHAUSTED` from the denominator exactly as it excludes
    `NOT_CONFIGURED` (an all-exhausted run yields `null`, never 100 and never 0); `PARTIAL` counts
    as unhealthy.
  - The stale-sweep route holds **no predicate of its own** and delegates to `sweepStaleInventory`;
    it writes a `CronJobLog` in **all three modes including `off`**; the dealer removal email still
    fires only for rows with a `dealerId`; the FS-G feed-failure suppression is preserved.
- [ ] **Step 2: Run** — FAIL. (`pnpm typecheck` also fails: `outcomeToStatus` is a typed switch with
  no `default`, so the new `AdapterOutcome` member breaks the build until handled. That is the
  intended forcing function.)
- [ ] **Step 3: Implement** — per-sweep sequence in `runInventorySync`:
  1. `resolveMarketConfig(MARKETCHECK, "MarketCheck")`.
     `source_inactive` → `NOT_CONFIGURED`, error `"source is inactive"`, zero fetches — **this is
     the no-deploy kill switch**. `not_configured` → `NOT_CONFIGURED`, zero fetches.
     `config_read_error` → `DEFERRED`.
  2. `rollCycleForward(sourceId, cycleKeyFor(startedAt))`.
  3. `granted = min(config.maxCallsPerRun, MAX_CALLS_PER_SWEEP)`; `mode === "priority"` → `granted = 1`.
  4. `budget = makeCallBudget(...)` when `configSource === "row"`, else `makeStaticBudget(granted)`.
  5. Run the adapter; delete the inline stale sweep; narrow the `inventorySource.update` select;
     batch the VIN prefetch; record `apiCallsUsed`, `rawListings`, `numFound`, `stopReason`,
     `configSource`, `market`, `maxDistMiles` into the returned result (→ `CronJobLog.result`).
  - `BUDGET_EXHAUSTED` with zero pages → `SyncRunStatus.BUDGET_EXHAUSTED`, `healthScore: null`,
    excluded from the denominator, does **not** fire the `<70` alert; fires **one** `SYSTEM_ALERT`
    per cycle, deduped by a `findFirst` on the cycle-keyed title (a month-long exhaustion produces
    one greppable alert, not thirty). Exhausted mid-walk → `PARTIAL`; pages already fetched are
    still ingested (discarding good data is its own dishonesty).
  - `vehiclesFetched` on `InventorySyncRun` stays `vehicles.length` (post-normalize) as today;
    `rawListings`/`numFound` are recorded alongside and named in the FAILED `error` string, so the
    persisted column and the number the decision was made from are reconcilable.
- [ ] **Step 4: Run** — `pnpm test:inventory && pnpm test:cron && pnpm typecheck`. PASS.
- [ ] **Step 5: Commit** — `refactor(inventory): one sweep implementation, config-driven and budget-gated`

---

## Task 7 — Cron cadence

**Files:** `frontend/vercel.json` **and** `frontend/lib/services/monitoring/cron-schedule.ts` — the
same commit, always. `cron-schedule.test.ts:67-81` pins them bidirectionally, so either half alone
is a red `pnpm test:monitoring`.

| cron | `vercel.json` | `CRON_STALENESS` |
| --- | --- | --- |
| `inventory-sync-full` | `"0 */6 * * *"` → **`"0 8 * * *"`** | `6 * HOUR` → **`DAY`** |
| `inventory-sync-priority` | `"0 * * * *"` → **ENTRY DELETED** | `HOUR` → **ENTRY DELETED** |
| `inventory-stale-sweep` | `"*/30 * * * *"` → **`"30 8 * * *"`** | `30` → **`DAY`** |
| `inventory-match-refresh` | unchanged | unchanged |

**`inventory-sync-full` → daily 08:00 UTC.** The only scheduled MarketCheck spender. One run ×
≤10 calls × 50 rows = 500 listings = MarketCheck's own deep-paging ceiling — **a second daily run
could not reach any listing the first did not; it would re-fetch the same 500 at double the cost.**
08:00 UTC ≈ 02:00–03:00 America/Chicago, off-peak for DFW and clear of the 09:00 UTC cluster.

**`inventory-sync-priority` → de-scheduled (168/wk → 0), route retained.** Both route files call
`runInventorySync({}, mode)` with an **identical empty params object** — same adapter, same query,
same fallback zip, differing only in a `maxResults` of 25 vs 100 that `buildApiUrl:133` clamps to 50
for both. **There is no priority scope**: no per-request geography, no priority queue, no distinct
market. It is a strictly-smaller prefix of the daily sweep costing 24 calls/day ≈ **730/month, 146%
of the entire provider cap on its own.** It must leave `CRON_STALENESS` too or it goes OVERDUE.

**`inventory-stale-sweep` → daily 08:30 UTC (336/wk → 7).** Makes **zero** provider calls, so this
is a correctness and load argument, not a budget one. **Decisive point: the sweep's input only
changes when a sync runs.** `last_seen_at` is written by ingestion and nothing else, so once the
sync is daily, running the sweep more often cannot change any row's outcome — the other 47 daily
runs are empty `updateMany`s plus 47 extra `dealer.findMany` + per-dealer `count()` N+1 loops and
47 extra chances to re-send the dealer feed-failure email (which, unlike the removal email, has no
suppression). `:30` places it 30 min after the sync so it always evaluates a just-refreshed
catalogue and can never race an in-flight walk. **Cost, stated not hidden:** worst-case
deactivation lag moves from 48–48.5h to 48–72h. Matching and the auction path are unaffected
(`executableSupplyWhere` already refuses anything older than 48h); the extra day is visible only on
public/SEO surfaces, which filter on `isActive` alone.

**`inventory-match-refresh` → unchanged, deliberately.** Supply now changes once a day, which
superficially argues for daily — but matches also depend on **requests**, which arrive continuously;
a buyer who submits at 10:00 should not wait until the next morning. Its cadence is justified by
request arrival, not supply arrival, and it makes no API calls.

**Dead-cron side effect (measured):** `dead-cron-cadence.test.ts:125` requires `slow.length >= 34`;
today 68 entries, slow 35, fast 33 — margin of one. Removing `inventory-sync-priority` (fast) →
fast 32; `inventory-sync-full` 360→1440 stays slow; `inventory-stale-sweep` 30→1440 moves
fast→slow. **Net slow = 36.** Margin improves.

**Honest arithmetic:** inventory cron *invocations* drop from 28+168+336+28 = **560/week to 42**.
MarketCheck *calls* drop from **28/day (~850/month, 170% of cap)** to **≤10/day (~310/month, 62%)**.

- [ ] **Step 1: Failing test** — `cron-schedule.test.ts`: `inventory-sync-full` and
  `inventory-stale-sweep` are `DAY`; `inventory-sync-priority` absent from **both** files; and,
  parsing `vercel.json`, no scheduled cron reaching `runInventorySync` fires more than once per day
  — pinning the ≤10-calls/day ceiling **by test rather than by comment**.
- [ ] **Step 2: Run** — FAIL. **Step 3:** Edit both files. **Step 4:** Run
  `pnpm test:monitoring` — PASS, and `dead-cron-cadence.test.ts` stays green.
- [ ] **Step 5: Commit** — `perf(inventory): one daily sweep; de-schedule the redundant priority sync`

---

## Task 8 — Close the two remaining quota leaks

**Files:** `frontend/app/api/admin/inventory/search-tool/run/route.ts`,
`frontend/lib/services/inventory/orchestrator.ts` (`bootstrapInventory`).

- [ ] **Step 1: Failing tests** — the admin search tool draws 1 call from the same counter before
  its fetch and, when refused, takes the existing DB path reporting `source: "db_budget_exhausted"`;
  `bootstrapInventory()` performs **one** budget-gated `runInventorySync({}, "priority")`.
- [ ] **Step 2–4: Implement, minimally.**
  - `search-tool/run`: draw before the fetch. Also fix the pre-existing lie at `:63` — `source` is
    set to `"marketcheck"` *before* the request, so a non-OK response returns an empty list still
    labelled MarketCheck; it becomes `"db_provider_error"`. **Host, `condition` handling and
    response shape unchanged** (see §Rejected).
  - `bootstrapInventory`: delete the NY/LA/Chicago/Houston/Atlanta array — under pagination that
    would be **up to 50 calls per button press** — and run one config-driven, budget-gated
    `priority` sweep. This removes the last hardcoded geography in the codebase, and it would not
    typecheck otherwise since it passes a `maxResults` that is being retired.
- [ ] **Step 5: Commit** — `fix(inventory): put the admin search tool and bootstrap under the call budget`

---

## Task 9 — Unavailable shortlist items: visible, excluded, and routed to a request

**APPROVED with scope additions.** An unavailable item must be **visible on the page** but
**excluded from the request** — it must not consume a shortlist slot, must not satisfy the
activation gate, and must not be carried into an auction. Instead of a dead end it offers the
existing Vehicle Request flow, pre-filled from that vehicle.

**Files:**
- Modify: `frontend/app/buyer/shortlist/page.tsx` (stop dropping orphans; carry availability)
- Modify: `frontend/components/buyer/ShortlistClient.tsx` (unavailable card + CTA + counts)
- Create: `frontend/lib/services/shortlist/shortlist-availability.ts`
- Modify: `frontend/app/api/buyer/shortlist/route.ts`,
  `frontend/app/api/admin/buyers/[buyerId]/shortlist/route.ts`,
  `frontend/lib/services/shortlist/shortlist.service.ts` (cap counts available only)
- Modify: `frontend/app/buyer/requests/new/page.tsx` (accept `trim` + `maxMileage` params)
- Modify: `frontend/app/api/admin/buyers/[buyerId]/auction-vehicles/route.ts` (reject inactive)
- Test: `frontend/lib/services/shortlist/__tests__/shortlist-availability.test.ts` — **new suite**,
  so add `test:shortlist` to `package.json` **and chain it into `test:all`**, or
  `pnpm test:coverage-check` fails (the glob expander is non-recursive and
  `lib/services/shortlist/__tests__/` is not currently covered by any `test:*` script — **verify
  this before writing the file**).

**Interfaces:** Produces `isShortlistItemAvailable(inv)`, `countAvailable(items)`,
`buildSimilarRequestHref(v): string`, `mileageBandFor(mileage): MileageOption`,
`priceBandCentsFor(priceCents): number`.

- [ ] **Step 1: Failing tests**
  - An item whose `InventoryItem` has `isActive: false` is **unavailable**; one whose inventory row
    is **missing entirely** is also unavailable (today `page.tsx:44` silently `null`s and
    `.filter()`s these out — the buyer never learns their saved car vanished).
  - `countAvailable` over 5 items where 3 are unavailable returns **2** — so `POST
    /api/buyer/shortlist` accepts a 6th add. Today `items.length >= MAX_SHORTLIST_ITEMS` counts
    dead rows and locks the buyer out of their own shortlist at zero usable candidates.
  - `canActivate` is `false` when every item is unavailable, even though `items.length >= 1`.
  - `mileageBandFor(62_000) === "75k"` (smallest containing stop); `mileageBandFor(140_000) === "Any"`.
  - `priceBandCentsFor(2_845_000)` rounds **up** to a clean band (+10%, rounded up to the nearest
    $1,000 → `3_130_000`) — a band, never the exact asking price of a car that is gone.
  - `buildSimilarRequestHref` emits `/buyer/requests/new?` with `makePreference`, `modelPreference`,
    `trim`, `yearMin`, `yearMax`, `maxMileage`, `maxBudgetCents` — and **every emitted key is one
    the target page actually reads** (assert against the parser's key list, so a rename on either
    side fails here rather than silently producing an empty form).
  - `/buyer/requests/new` hydrates `trim` and `maxMileage` from the URL (the two params it does not
    read today; `vehicleType`, `condition`, `timeline`, `purchaseTimeframe`, `yearMin`, `yearMax`,
    `makePreference`, `modelPreference`, `zip`, `maxBudgetCents`, `features` already work at
    `page.tsx:175-217`).
  - `POST .../auction-vehicles` with an `inventoryItemId` whose row is inactive or missing → **400**,
    naming the offending ids; no `auctionVehicle` row is created.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
  - `page.tsx`: keep every item; map a missing/inactive inventory row to
    `{ ...item, available: false }` carrying whatever last-known fields exist, rather than dropping
    it. Compute `canActivate` from the **available** count.
  - `ShortlistClient`: unavailable card is visually distinct (dimmed, "No longer available" badge),
    **not** a `Link` to `/buyer/inventory/{id}`, and carries a primary
    **"Find one like this near me"** button to `buildSimilarRequestHref(item)`. Counts, the
    `{count} of {MAX_SHORTLIST_ITEMS}` line and the progress bar use the available count; the
    unavailable ones render below with their own count ("2 no longer available").
  - Cap enforcement in all three writers counts available items only.
- [ ] **Step 4: Run** — `pnpm test:shortlist && pnpm test:coverage-check && pnpm typecheck`.
- [ ] **Step 5: Note for the report** — this task changes buyer-facing UI, so `pnpm test:visual`
  **becomes applicable** and the Impeccable audit applies (CLAUDE.md pipeline steps 12-13).
- [ ] **Step 6: Commit** — `feat(buyer): show unavailable shortlist vehicles and route them into a pre-filled vehicle request`

**`journey.ts` note:** `computeJourney` completes the `shortlist` stage on
`facts.shortlistCount > 0` (`lib/services/buyer/journey.ts:107`). Whoever supplies `shortlistCount`
must supply the **available** count, or a buyer whose every saved car has sold still reads as having
completed the shortlist stage. Trace the caller and fix it in this task; if it turns out to be
non-trivial, say so explicitly rather than leaving it.

---

## Owner-gated steps — do not run in this work

### Vercel environment variables (Production **and** Preview)

| Name | Value | Purpose |
| --- | --- | --- |
| `INVENTORY_SWEEP_ZIP` | `76011` | Market centre fallback when `center_zip` is NULL (i.e. before the migration is applied). Arlington TX = DFW centroid. |
| `INVENTORY_SWEEP_RADIUS_MILES` | `100` | Radius fallback. Clamped to ≤100 in code regardless. |
| `INVENTORY_STALE_SWEEP_MODE` | `dry_run` | Deploy default. Flip to `enforce` only after reading dry-run evidence. |
| `INVENTORY_SWEEP_MAX_DEACTIVATIONS` | `150` | Blast-radius breaker. 95 legitimate, 150 headroom, a blackout trips it. |
| `MARKETCHECK_MONTHLY_CALL_BUDGET` | `400` | 310 scheduled + 90 for admin/manual, against a 500 provider cap. |

`MARKETCHECK_API_KEY` already exists (`.env.example:196`).

### Migration command — SUPERSEDED 2026-09-03, see the retraction above

~~`cd frontend && pnpm exec prisma migrate deploy`~~

**Both migrations are already applied.** The remaining work is ledger repair, not migration. Six
migrations are physically present with no `_prisma_migrations` row; `migrate deploy` would
re-execute all six against production, so the repair is `resolve --applied`, which writes ledger
rows and runs no DDL:

```bash
cd frontend
pnpm exec prisma migrate resolve --applied 20261014000000_esign_envelope_history
pnpm exec prisma migrate resolve --applied 20261015000000_esign_consent_and_executed_artifact
pnpm exec prisma migrate resolve --applied 20261016000000_ai_action_intent_lifecycle
pnpm exec prisma migrate resolve --applied 20261016000000_contract_scan_version_link
pnpm exec prisma migrate resolve --applied 20261104000000_inventory_market_config_and_call_budget
pnpm exec prisma migrate resolve --applied 20261105000000_inventory_dealer_provenance_and_call_accounting
pnpm exec prisma migrate deploy    # must print: No pending migrations to apply.
pnpm db:check-ledger               # must print: OK — every migration's ledger row agrees
```

The post-apply verification below already passes: `SELECT center_zip, radius_miles,
monthly_call_budget, max_calls_per_run, rows_per_call FROM inventory_sources WHERE
type='MARKETCHECK'` returned `76011 / 100 / 400 / 10 / 50` on 2026-09-03.

### Rollout — six phases, destructive step last

> **HARD ORDERING CONSTRAINT (owner, 2026-09-02).** `enforce` is the *last* step, and it does not
> happen until the DFW catalogue has actually populated. Enforcing before the new market is in the
> database is strictly worse than doing nothing.
>
> Verified read-only against production on 2026-09-02: of the 148 active rows, the 95 the sweep
> deactivates are 94 NY + 1 TX, and **all 53 survivors are New York — not one is Texas.** Flipping
> `enforce` today would leave the public catalogue at 53 stale New York listings and **zero cars in
> the market AutoLenis is repointing to.** ("Mostly New York" understates it; it is all of them.)
>
> The order is therefore: **apply the migration → repoint to 76011/100mi → let the sweep run 2–3
> days → confirm the catalogue is Texas-majority → only then flip `enforce`.** Phase 6 must not
> begin until phase 5's gate passes. There is no rush: the stale rows have been wrong for three
> months, and two more days of them costs nothing next to shipping an empty catalogue.

1. **Env only, no deploy.** Nothing reads them yet. *Rollback:* delete the variables.
2. **Deploy the code.** *(Corrected 2026-09-03: the migration is already applied, so the P2022
   fallback described here never engages — config resolves from the `inventory_sources` row, and
   `configSource` reads `"row"`, not `"env"`. The env tier remains as a fallback and is harmless.)*
   Market resolves to DFW (the `10001` literal is gone); sweep is
   `dry_run` and deactivates nothing; crons are already 1/day. Worst-case spend here is 10 × 31 =
   **310**, inside the cap. *This is why the code tolerates the unapplied migration: no deploy is
   coupled to a DBA action.* *Rollback:* Vercel instant rollback — but note it restores the
   28-call/day burn.
3. ~~**Apply the migration.**~~ **Already applied — replaced by ledger repair.** Run the six
   `prisma migrate resolve --applied` commands above, then `pnpm db:check-ledger`. No DDL executes
   and no schema changes, so there is nothing to roll back; `rollback.sql` stays available for the
   separate question of undoing the columns themselves.
4. **Confirm config took effect.** Watch the first 08:00 UTC sweep: `apiCallsUsed ≤ 10`,
   `stopReason` ∈ {`PAGE_CAP`,`PROVIDER_CEILING`,`NUM_FOUND_REACHED`}, `status = COMPLETED`,
   `calls_used_this_cycle = 10`, **`maxDistMiles <= 100`**, and `external_dealer_state` starting to
   show `TX` — the cheapest proof the repoint actually took rather than silently falling back.
5. **Let the DFW catalogue populate. This is the gate on phase 6 — do not skip it.** Leave
   `INVENTORY_STALE_SWEEP_MODE=dry_run` and let 2–3 daily sweeps land. Each sweep ingests up to 500
   Arlington-area listings, so Texas should overtake New York on the first or second run. **Both**
   conditions must hold before phase 6:

   * **Texas-majority.** More active rows in TX than in every other state combined, and the count
     rising run over run — not one lucky row. Today this query returns `NY 147 / TX 1`, 148 active
     in total (`(blank)` is now empty; it was 10 rows in the 2026-08 snapshot):

     ```sql
     SELECT coalesce(nullif(trim(external_dealer_state), ''), '(blank)') AS state,
            count(*) AS active_rows
       FROM inventory_items
      WHERE is_active
      GROUP BY 1
      ORDER BY 2 DESC;
     ```

     `external_dealer_state` is the column that carries geography — the adapter writes
     `external_dealer_*`, never the bare `city`/`state`/`zip` columns, which are blank on every
     active row.

   * **Dry-run evidence stable across two consecutive days:** `candidates` ≈ 95, `breakdown` 100%
     `dealerId`-null, `aborted:false`.

   If Texas is *not* climbing, the repoint silently fell back — do not proceed. Go back to phase 4's
   checks (`configSource`, `market.zip`, `maxDistMiles`) and diagnose. Sweeping the wrong market and
   then enforcing is the one combination that empties the catalogue.

   *Known interaction, already flagged and still open:* MarketCheck's default sort is distance
   ascending, so those ~500 rows all sit within ~1.1 miles of 76011. The gate still passes — they
   are Texas — but the catalogue will be Arlington, not DFW, until the sort question is decided.

6. **The only destructive step.** Once phase 5's gate has passed, snapshot then set
   `INVENTORY_STALE_SWEEP_MODE=enforce`.

```sql
CREATE TABLE IF NOT EXISTS "_bk_stale_sweep_20261104" AS
  SELECT id, is_active, lane, dealer_id, last_seen_at, created_at
    FROM inventory_items
   WHERE is_active
     AND (last_seen_at < now() - interval '48 hours'
          OR (last_seen_at IS NULL AND created_at < now() - interval '48 hours'));
```

*Rollback, in order of preference:* (a) mode back to `dry_run` — stops further deactivation within
one cycle; (b) `UPDATE inventory_items SET is_active=true WHERE id IN (<CronJobLog.result.deactivatedIds>)`;
(c) mode `off`, which still writes the cron log so it does not then alert as dead. Nothing is ever
hard-deleted, `priceHistory` survives, and no `AuctionVehicle` row is touched (0 are linked).

**Kill switches, no deploy:** `inventory_sources.is_active = false` → zero HTTP calls.
`monthly_call_budget = 0` → freezes spend while leaving the source configured. **Never set
`monthly_call_budget = NULL`** — that means unmetered.

### Quota forensics — the September deadline, and one unresolved question

Owner question (2026-09-02): *does a request rejected with HTTP 429 count against the monthly
allowance?* Answer: **unresolved from here** — but the forensics change what the question is worth
asking about, and give a zero-cost test that settles it.

**Provider mechanics, from MarketCheck's published docs.** Quota and rate are two separate limits
with separate headers: `Quota-Limit` / `Quota-Remaining` / `Quota-Reset-Time` for the monthly
allowance, `RateLimit-Remaining` for the per-second throttle. Quota is metered **at account level
across all API keys**, and the documented reset is the first of the following month at `00:00:00Z`.
The docs do not say whether a 429 decrements `Quota-Remaining`. `docs.marketcheck.com` and
`api.marketcheck.com` are both blocked by this sandbox's egress proxy, so neither the primary text
nor a live header read was available to confirm it here.

**What production actually shows** (read-only, 2026-09-02):

| Fact | Source |
| --- | --- |
| The crons started **2026-08-20 02:00:01** — four days before the first `inventory_sync_runs` row. | `cron_job_logs` |
| **The very first execution was already `MarketCheck HTTP 429`**, on a real 134 ms round trip. Not one call had succeeded before it. | `cron_job_logs.result` |
| Aug 20 → Aug 24 05:00: **114 executions, all 429, and not one `inventory_sync_runs` row** (98 priority + 16 full). `ensureInventorySource()` ran after the adapters, so `sourceId` was null and the run-row write was skipped — the calls went out, the ledger did not see them. | `cron_job_logs` vs `inventory_sync_runs` |
| Aug 24 05:00 → Aug 31 00:01: **191 more, all 429**, recorded `DEFERRED`. | `inventory_sync_runs` |
| **Total: 305 consecutive rejections and zero successful calls, across 11 days.** | both |
| Recovery was abrupt and mid-month: 429 at `00:01:16.536`, success at `00:01:33.164` — **17 seconds later**, `fetched=44`. No 429 since. | `inventory_sync_runs` |
| Current cycle: Aug 31 = 27, Sep 1 = 28, Sep 2 = 28 → **83 successful, 0 rejected.** | `inventory_sync_runs` |
| `inventory-sync-full` ran ~4×/day, not daily. 24 priority + 4 full = the observed **28 calls/day**. | 55 executions / 14 days |
| The second consumer — the admin search tool, on `marketcheck-prod.apigee.net` — **last ran 2026-06-26**. Not part of the Aug/Sep spend. | `admin_inventory_search_runs` |

**AutoLenis never drew down a MarketCheck allowance before 2026-08-31.** Zero successful calls in
11 days. So the premise behind the question — that August's rejections may have eaten into a 500-call
budget — cannot be tested against August: there was no successful consumption to compete with, and
whatever blocked the key originated **outside this codebase** (a trial already spent before the key
was wired in, an unactivated plan, or an account-level block). The abrupt mid-month recovery is not
the calendar reset the docs describe, which is a second thing the dashboard should explain.

**The zero-cost test that settles it.** Read `Quota-Reset-Time` on the dashboard first — it names the
cycle boundary. Then:

| If the current cycle began **2026-08-31** (recovery, i.e. the 305 rejections are inside it) | Reading |
| --- | --- |
| `Quota-Remaining` ≈ **417** (500 − 83 successful) | rejections **do not** count |
| `Quota-Remaining` ≈ **112** (500 − 83 − 305) | rejections **do** count |

If instead the cycle began **2026-09-01**, the rejections sit in a closed cycle and September holds
only 56 successful calls with no rejections at all — `Quota-Remaining` ≈ 444 either way, and the
question stays open until a 429 happens with quota still on the clock.

**It does not gate this rollout, whichever way it lands.** `tryConsumeCall()` debits the ledger
**before** the fetch and fail-closed, so it counts *attempts*, not successes. If a 429 costs no
provider quota the ledger merely over-counts (safe); if it does, the ledger matches the provider
exactly. **It cannot under-count either way**, so no budget number here changes on the answer.

**Headroom does need revisiting — for a different reason than expected.** The run count has
historically understated provider calls, not because of 429 accounting but because **114 calls left
no run record at all.** Any budget sized from `inventory_sync_runs` alone would have been short by
that much. The ledger closes this for metered runs, but note its limit: **it only meters once the
`inventory_sources` row exists.** In phase 2, before the migration, `sourceId` is null and the budget
is process-local — the bound there is the cron cadence, 1 sweep/day × 10 calls = **310/month**, not
the ledger.

**Deadline.** At the still-deployed 28 calls/day, and 83 of 500 spent by 2026-09-02, the next 429
wall lands **~17–18 September**. That is when this fix has to be live.

**Known gap, flagged not fixed** (outside this change's scope): all 305 rejected executions wrote
`cron_job_logs.status = 'COMPLETED'`, because `withCronRun` marks the run by whether the callback
threw, and `runInventorySync` returns `outcome: "DEFERRED"` rather than throwing. The corrected
status now lands on `inventory_sync_runs.status` and in the cron result JSON's `outcome`, so the
evidence is there — but any alert reading `cron_job_logs.status` alone would still have watched this
outage report success for 11 days.

### Blast radius the owner must accept before phase 6

Verified, and **not caused by this change** — caused by missing `isActive` filters that predate it:

- Public catalogue drops **148 → 53 active rows (−64%)**. `/api/public/inventory`,
  `/(public)/inventory`, `FeaturedInventory`, `sitemap.ts`, `image-sitemap.xml`,
  `/api/public/platform-stats` all filter on `isActive` alone. Several `/cars/{make}` landing pages
  will start returning 404. **This is the catalogue being *correct* for the first time** — those 95
  rows are 3+ months stale.
- **10 of 15 shortlist items** break (Task 9).
- All "Verified / Eligible for private 48-hour auction" LANE_1 badges disappear, because LANE_1 goes
  to zero. **Correct** — all 95 have `dealer_id IS NULL` and the badge was false — but it is a
  large, deliberate conversion-surface change.
- `/api/public/health` `inventoryHealth` stays at 100 (53 ≥ its threshold of 10), so **the health
  probe will not notice**. Follow-up.
- Matching output does **not** change: all 109 `vehicle_request_match_results` already point at
  active LANE_3 rows, and the 95 already fail `executableSupplyWhere`'s provenance clause.

---

## Owner decisions — 2026-09-02 (all resolved; no open blockers)

1. **`num_found` — CONFIRMED PRESENT from MarketCheck's own documentation.** It is a documented
   field on the Inventory Search response, and the pagination rules reference it directly: *"if
   `start` is greater than the total number of available results (`num_found`), the API will respond
   with HTTP 422."* Sibling endpoints declare it in their response interfaces. **The gate design
   stands as written.** Keep the absent-field fallback and the `coverage:"UNKNOWN"` record as
   defensive coding, but treat the field as present.
   **Consequence the plan must now handle — see Task 5:** `start > num_found` returns **HTTP 422**.
   A 4xx is currently classified `FAILED`. Overrunning the end of the result set is **not a
   failure**, so the loop needs (a) an explicit pre-fetch guard `start >= numFound → stop`, and
   (b) a 422 branch that terminates cleanly rather than recording a failure.
2. **DFW centre: `76011` (Arlington).** Metroplex centroid, balanced Dallas + Fort Worth coverage.
3. **Both behaviour changes approved:** admin-curated rows become exempt from the stale sweep and
   the matching freshness window (current blast radius zero); worst-case deactivation lag moves from
   48–48.5h to 48–72h.
4. **Task 9 approved, with scope additions** — see the rewritten Task 9.
5. **Still unknown, not blocking, owner to confirm with MarketCheck:** whether the 500-call
   allowance resets on the **calendar month** or a **billing anniversary**. The ledger keys on UTC
   `"YYYY-MM"`. If the provider resets mid-month, a 400-call calendar budget could legitimately
   spend ~400 in the back half of one provider cycle plus ~400 in the front half of the next — ~800
   inside one provider window — and the 429 storm returns while every internal counter reads green.
   The evidence (191 × 429 through Aug 31, then COMPLETED from Aug 31) *looks* like a month-end
   reset but does not prove it. **If it turns out to be an anniversary, the cycle key needs an
   anchor day.** The 400/500 headroom absorbs the risk in the meantime.

---

## Verification gate (run before any completion language)

```bash
cd frontend
pnpm typecheck
pnpm lint                 # baseline: 0 errors, 64 warnings, exit 0 — do not add errors
pnpm test:coverage-check
pnpm test:all             # full 26-suite matrix
pnpm build                # required: schema.prisma changed
```

**Not runnable here, must be named as such in the report:** CI's `migrations` job (applies the chain
to an empty postgres twice) and `pnpm db:check-drift` — the authoritative migration gate and the
reason the CHECK constraints were rejected. `pnpm test:visual` is **not applicable** (no UI change)
unless Task 9 is approved.
