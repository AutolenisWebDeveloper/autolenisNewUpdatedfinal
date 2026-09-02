// The admin inventory search tool is the SECOND consumer of MARKETCHECK_API_KEY.
//
// It issues its own fetch to a different host (marketcheck-prod.apigee.net), one call per
// admin click, and it was outside every budget. Historic volume is low (28 in April, 4 in
// May, 7 in June, none since), so it is not the cause of the 2026-08 429 storm — but a
// monthly cap that only counts the orchestrator is not a real cap.
//
//   npx tsx --test --experimental-test-module-mocks \
//     app/api/admin/__tests__/inventory-search-tool-budget.test.ts

import test, { mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

let sourceRow: Record<string, unknown> | null = null;
let ledgerAllows = true;
const drawAttempts: Array<Record<string, unknown>> = [];
let providerCalls = 0;
let providerStatus = 200;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      inventorySource: {
        findFirst: async () => sourceRow,
        updateMany: async (args: { where: Record<string, unknown> }) => {
          drawAttempts.push(args);
          // Rollover call (has OR) always succeeds; the draw obeys `ledgerAllows`.
          if (Array.isArray((args.where as { OR?: unknown[] }).OR)) return { count: 1 };
          return { count: ledgerAllows ? 1 : 0 };
        },
      },
      inventoryItem: { findMany: async () => [] },
      adminInventorySearchRun: { create: async () => ({ id: "run_1" }) },
      $queryRawUnsafe: async () => [],
    },
  },
});

mock.module("@/lib/auth/admin-api", {
  namedExports: {
    getAdminFromRequest: async () => ({ adminId: "admin_1", email: "ops@autolenis.com" }),
    createAuditLog: async () => ({ id: "log_1" }),
  },
});

const origFetch = globalThis.fetch;
const origKey = process.env.MARKETCHECK_API_KEY;

function req(body: Record<string, unknown> = { make: "Ford" }) {
  return new NextRequest("http://localhost/api/admin/inventory/search-tool/run", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  process.env.MARKETCHECK_API_KEY = "test-key";
  drawAttempts.length = 0;
  providerCalls = 0;
  providerStatus = 200;
  ledgerAllows = true;
  sourceRow = {
    id: "src_1", isActive: true, centerZip: "76011", radiusMiles: 100,
    filterMake: null, filterModel: null, filterYearMin: null, filterYearMax: null,
    filterPriceMaxCents: null, rowsPerCall: 50, maxCallsPerRun: 10,
    monthlyCallBudget: 400, callsUsedThisCycle: 0, budgetCycleKey: "2026-09",
  };
  globalThis.fetch = (async () => {
    providerCalls++;
    if (providerStatus !== 200) return new Response("err", { status: providerStatus });
    return Response.json({ listings: [] });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = origFetch;
  if (origKey === undefined) delete process.env.MARKETCHECK_API_KEY;
  else process.env.MARKETCHECK_API_KEY = origKey;
});

test("an allowed search draws exactly one call from the shared ledger", async () => {
  const { POST } = await import("@/app/api/admin/inventory/search-tool/run/route");
  const res = await POST(req());
  assert.equal(res.status, 200);
  assert.equal(providerCalls, 1);

  const draws = drawAttempts.filter((a) => !Array.isArray((a.where as { OR?: unknown[] }).OR));
  assert.equal(draws.length, 1, "one click, one drawn call");
  assert.equal((draws[0]!.where as { id: string }).id, "src_1",
    "drawn from the SAME per-credential ledger as the orchestrator, not a separate counter");
});

test("an exhausted budget makes ZERO provider calls and says so", async () => {
  ledgerAllows = false;
  const { POST } = await import("@/app/api/admin/inventory/search-tool/run/route");
  const res = await POST(req());
  const body = await res.json() as { source?: string };

  assert.equal(providerCalls, 0, "the cap must actually stop the call, not merely count it");
  assert.equal(res.status, 200, "the admin still gets internal results — it degrades, not fails");
  assert.equal(body.source, "db_budget_exhausted");
});

test("an inactive source is the kill switch here too", async () => {
  sourceRow = { id: "src_1", isActive: false };
  const { POST } = await import("@/app/api/admin/inventory/search-tool/run/route");
  const res = await POST(req());
  const body = await res.json() as { source?: string };
  assert.equal(providerCalls, 0);
  assert.equal(body.source, "db_budget_exhausted");
});

test("a failed provider call is NOT labelled as a MarketCheck result", async () => {
  // `source` used to be set to "marketcheck" BEFORE the request, so a non-OK response
  // returned an empty list still labelled MarketCheck — an empty market and a broken
  // integration looked identical to the admin reading the screen.
  providerStatus = 500;
  const { POST } = await import("@/app/api/admin/inventory/search-tool/run/route");
  const res = await POST(req());
  const body = await res.json() as { source?: string };
  assert.equal(providerCalls, 1);
  assert.equal(body.source, "db_provider_error");
});
