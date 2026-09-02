// Swept-market configuration.
//
// Geography used to be an inline literal: marketcheck.adapter.ts did
// `zip: params.zip ?? "10001"` and BOTH crons called runInventorySync({}) with an empty
// params object, so the NYC fallback always won. 100% of production inventory carried
// external_dealer_state='NY' as a result, and the market could not be changed without a
// deploy. inventory_sources had no geography columns at all.
//
// Resolution order is row -> env -> NOT_CONFIGURED. A P2021/P2022 (the migration not yet
// applied) degrades to env; any OTHER read error is an incident, not a config gap.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/inventory/__tests__/marketcheck-market-config.test.ts

import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveMarketConfig, clampRadius, resolveMonthlyBudget,
  MAX_RADIUS_MILES, MAX_ROWS_PER_CALL, MAX_CALLS_PER_SWEEP,
  PROVIDER_PAGINATION_LIMIT, DEFAULT_RADIUS_MILES, DEFAULT_MONTHLY_CALL_BUDGET,
} from "@/lib/services/inventory/inventory-source-config.service";

const ENV_KEYS = [
  "INVENTORY_SWEEP_ZIP", "INVENTORY_SWEEP_RADIUS_MILES", "MARKETCHECK_MONTHLY_CALL_BUDGET",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** Minimal prisma double. `row` null => no source row; `columnError` => simulate an
 *  unapplied migration (Prisma P2022 "column does not exist"). */
function db(opts: {
  row?: Record<string, unknown> | null;
  columnError?: boolean;
  otherError?: boolean;
} = {}) {
  let calls = 0;
  return {
    calls: () => calls,
    client: {
      inventorySource: {
        findFirst: async ({ select }: { select?: Record<string, unknown> }) => {
          calls++;
          if (opts.otherError) throw Object.assign(new Error("connection reset"), { code: "P1001" });
          // The wide select (config columns) fails when the migration is unapplied; the
          // narrow retry (id/isActive only) still succeeds.
          const wantsConfigColumns = !!select && "centerZip" in select;
          if (opts.columnError && wantsConfigColumns) {
            throw Object.assign(
              new Error("The column `inventory_sources.center_zip` does not exist"),
              { code: "P2022" },
            );
          }
          if (opts.row === null) return null;
          return opts.row ?? { id: "src_1", isActive: true };
        },
      },
    },
  };
}

// ── clamps ───────────────────────────────────────────────────────────────────

test("clampRadius(null) is the DEFAULT, not 1 — Math.max(null,1) would give a 1-mile market", () => {
  assert.deepEqual(clampRadius(null), { miles: DEFAULT_RADIUS_MILES, clamped: false });
  assert.deepEqual(clampRadius(undefined), { miles: DEFAULT_RADIUS_MILES, clamped: false });
});

test("clampRadius caps at the provider ceiling and floors at 1", () => {
  assert.deepEqual(clampRadius(250), { miles: MAX_RADIUS_MILES, clamped: true });
  assert.deepEqual(clampRadius(100), { miles: 100, clamped: false });
  assert.deepEqual(clampRadius(0), { miles: 1, clamped: true });
  assert.deepEqual(clampRadius(-5), { miles: 1, clamped: true });
  assert.deepEqual(clampRadius(45), { miles: 45, clamped: false });
});

test("provider ceilings are the free-tier limits", () => {
  assert.equal(MAX_RADIUS_MILES, 100);
  assert.equal(MAX_ROWS_PER_CALL, 50);
  assert.equal(MAX_CALLS_PER_SWEEP, 10);
  assert.equal(PROVIDER_PAGINATION_LIMIT, 500);
  assert.equal(MAX_ROWS_PER_CALL * MAX_CALLS_PER_SWEEP, PROVIDER_PAGINATION_LIMIT);
});

test("resolveMonthlyBudget never returns null for a metered source", () => {
  assert.equal(resolveMonthlyBudget(320), 320);
  assert.equal(resolveMonthlyBudget(null), DEFAULT_MONTHLY_CALL_BUDGET);
  process.env.MARKETCHECK_MONTHLY_CALL_BUDGET = "250";
  assert.equal(resolveMonthlyBudget(null), 250, "env overrides the default");
  assert.equal(resolveMonthlyBudget(320), 320, "but the row still wins over env");
  process.env.MARKETCHECK_MONTHLY_CALL_BUDGET = "not-a-number";
  assert.equal(resolveMonthlyBudget(null), DEFAULT_MONTHLY_CALL_BUDGET, "garbage never means unmetered");
  process.env.MARKETCHECK_MONTHLY_CALL_BUDGET = "0";
  assert.equal(resolveMonthlyBudget(null), DEFAULT_MONTHLY_CALL_BUDGET, "0 from env is not a valid cap");
  assert.equal(resolveMonthlyBudget(0), 0, "but an explicit 0 on the row freezes spend");
});

// ── resolution order ─────────────────────────────────────────────────────────

test("no row and no env is NOT_CONFIGURED — never a silent fallback market", async () => {
  const d = db({ row: null });
  const r = await resolveMarketConfig("MARKETCHECK", "MarketCheck", { prisma: d.client });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "not_configured");
});

test("the NYC literal is gone from the adapter and the market array from the orchestrator", () => {
  // Comments are stripped first. Both files explain in prose WHY the old literals were a
  // defect, and a naive text match would fail on the explanation — pressuring the author to
  // delete the reasoning instead of keeping the guarantee. (Same rule the migration
  // correspondence tests use.)
  const code = (rel: string) =>
    readFileSync(join(process.cwd(), rel), "utf8")
      .split("\n").map((l) => l.split("//")[0]).join("\n");

  const adapter = code("lib/services/inventory/adapters/marketcheck.adapter.ts");
  assert.ok(!/["']10001["']/.test(adapter),
    "marketcheck.adapter.ts must not carry a fallback zip in executable code");

  const orch = code("lib/services/inventory/orchestrator.ts");
  assert.ok(!/["']90001["']|["']60601["']|["']77001["']|["']30301["']|["']10001["']/.test(orch),
    "orchestrator.ts must not carry a hardcoded market array");
});

test("a configured row wins, with radius clamped to the provider ceiling", async () => {
  const d = db({ row: {
    id: "src_1", isActive: true, centerZip: "76011", radiusMiles: 250,
    filterMake: null, filterModel: null, filterYearMin: null, filterYearMax: null,
    filterPriceMaxCents: 3_500_000, rowsPerCall: 50, maxCallsPerRun: 10,
    monthlyCallBudget: 400, callsUsedThisCycle: 0, budgetCycleKey: "2026-09",
  } });
  const r = await resolveMarketConfig("MARKETCHECK", "MarketCheck", { prisma: d.client });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.config.zip, "76011");
  assert.equal(r.config.radiusMiles, 100);
  assert.equal(r.config.radiusClamped, true);
  assert.equal(r.config.priceMaxCents, 3_500_000);
  assert.equal(r.config.configSource, "row");
});

test("a corrupt maxCallsPerRun cannot raise the compiled sweep cap", async () => {
  const d = db({ row: {
    id: "src_1", isActive: true, centerZip: "76011", radiusMiles: 100,
    filterMake: null, filterModel: null, filterYearMin: null, filterYearMax: null,
    filterPriceMaxCents: null, rowsPerCall: 999, maxCallsPerRun: 999,
    monthlyCallBudget: 400, callsUsedThisCycle: 0, budgetCycleKey: null,
  } });
  const r = await resolveMarketConfig("MARKETCHECK", "MarketCheck", { prisma: d.client });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.config.maxCallsPerRun, MAX_CALLS_PER_SWEEP);
  assert.equal(r.config.rowsPerCall, MAX_ROWS_PER_CALL);
});

test("an UNAPPLIED migration degrades to env config, and still ingests", async () => {
  process.env.INVENTORY_SWEEP_ZIP = "76011";
  process.env.INVENTORY_SWEEP_RADIUS_MILES = "100";
  const d = db({ columnError: true });
  const r = await resolveMarketConfig("MARKETCHECK", "MarketCheck", { prisma: d.client });
  assert.ok(r.ok, "a P2022 must not stop the sweep — no deploy is coupled to a DBA action");
  if (!r.ok) return;
  assert.equal(r.config.configSource, "env");
  assert.equal(r.config.zip, "76011");
  assert.equal(r.config.radiusMiles, 100);
  assert.equal(r.config.monthlyCallBudget, DEFAULT_MONTHLY_CALL_BUDGET);
});

test("an inactive source is the no-deploy kill switch, even mid-migration", async () => {
  process.env.INVENTORY_SWEEP_ZIP = "76011";
  const d = db({ columnError: true, row: { id: "src_1", isActive: false } });
  const r = await resolveMarketConfig("MARKETCHECK", "MarketCheck", { prisma: d.client });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "source_inactive");
});

test("a NON-schema read error is an incident (DEFERRED), not a config gap", async () => {
  process.env.INVENTORY_SWEEP_ZIP = "76011";
  const d = db({ otherError: true });
  const r = await resolveMarketConfig("MARKETCHECK", "MarketCheck", { prisma: d.client });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "config_read_error");
});

test("an invalid env zip is refused rather than guessed", async () => {
  process.env.INVENTORY_SWEEP_ZIP = "not-a-zip";
  const d = db({ row: null });
  const r = await resolveMarketConfig("MARKETCHECK", "MarketCheck", { prisma: d.client });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "not_configured");
});
