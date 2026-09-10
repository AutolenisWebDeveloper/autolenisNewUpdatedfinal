// The admin inventory search tool is the second CONSUMER of MARKETCHECK_API_KEY — and,
// since Phase 4, no longer a second CLIENT.
//
// It used to fetch a different host (marketcheck-prod.apigee.net) with its own URL
// builder: no radius, none of the three include_* flags while reading `build.*`, its own
// narrow listing type, and undocumented parameter names. Every one of those defects was
// fixed in MarketCheckAdapter and none of the fixes reached here, which is the argument
// against a second client rather than a hypothetical about one. It now calls the adapter
// (§10 inventory/R57, §8.4).
//
// Historic volume is low (28 in April, 4 in May, 7 in June, none since), so it is not the
// cause of the 2026-08 429 storm — but a monthly cap that only counts the orchestrator is
// not a real cap, and the ledger draw is unchanged: the adapter takes the budget and draws
// immediately before dispatch.
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
  // Distinct from db_budget_exhausted now. Both degrade to the internal DB, but "the
  // source is switched off" and "the month's calls are spent" are different facts and an
  // operator reading the screen needs to know which one they are looking at.
  assert.equal(body.source, "db_source_inactive");
});

test("the adapter is the client — one host, radius clamped, include flags sent", async () => {
  // §10 inventory/R57. The assertions are on the URL because the URL is what was wrong:
  // a second client meant a second set of provider defects, and the record shows they do
  // not get fixed twice.
  let url = "";
  globalThis.fetch = (async (input: string | URL) => {
    providerCalls++;
    url = String(input);
    return Response.json({ num_found: 0, listings: [] });
  }) as typeof fetch;

  const { POST } = await import("@/app/api/admin/inventory/search-tool/run/route");
  await POST(req({ make: "Ford", yearMin: 2019, yearMax: 2023 }));

  const u = new URL(url);
  assert.equal(u.host, "api.marketcheck.com", "one host — the apigee client is retired");
  assert.equal(u.searchParams.get("radius"), "100", "AutoLenis's radius applies; before, none was sent at all");
  assert.equal(u.searchParams.get("include_dealer_object"), "true");
  assert.equal(u.searchParams.get("include_mc_dealership_object"), "true");
  assert.equal(u.searchParams.get("include_build_object"), "true");
  assert.equal(u.searchParams.get("year_range"), "2019-2023", "the documented parameter name");
  assert.equal(u.searchParams.get("year_min"), null);
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
