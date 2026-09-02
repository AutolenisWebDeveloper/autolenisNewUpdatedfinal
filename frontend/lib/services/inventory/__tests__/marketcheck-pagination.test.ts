// MarketCheck pagination, call-cap enforcement and provider-rule handling.
//
// The adapter used to make exactly ONE fetch with no `start` parameter, so a "full" sweep
// saw at most 50 listings — while two crons called it 28 times a day, ~850 calls/month
// against a 500 cap. One daily walk of <= 10 pages sees 10x more of the market for a third
// of the spend, but only if the walk terminates correctly on every provider rule.
//
//   npx tsx --test lib/services/inventory/__tests__/marketcheck-pagination.test.ts

import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { MarketCheckAdapter } from "@/lib/services/inventory/adapters/marketcheck.adapter";
import { makeStaticBudget } from "@/lib/services/inventory/inventory-call-budget.service";
import type { CallBudgetLike } from "@/lib/services/inventory/adapters/IInventoryAdapter";

const origFetch = globalThis.fetch;
const origKey = process.env.MARKETCHECK_API_KEY;

/** URLs the adapter actually requested, in order. */
let requested: URL[] = [];

/** A listing that survives normalize(). */
function listing(i: number, dist = 12) {
  return {
    vin: `VIN${String(i).padStart(14, "0")}`,
    dist,
    build: { year: 2022, make: "Ford", model: "F-150", trim: "XLT" },
    miles: 20_000 + i,
    price: 40_000 + i,
    media: { photo_links: ["a.jpg"] },
    dealer: { name: "Metroplex Ford", city: "Arlington", state: "TX" },
    vdp_url: `https://example.test/${i}`,
  };
}

/** Stub the provider. `pages` maps a `start` offset to its response. */
function stubFetch(handler: (start: number, rows: number, url: URL) => {
  status?: number;
  numFound?: number | null;
  count?: number;
  startIndex?: number;
}) {
  globalThis.fetch = (async (input: string | URL) => {
    const url = new URL(String(input));
    requested.push(url);
    const start = Number(url.searchParams.get("start") ?? 0);
    const rows = Number(url.searchParams.get("rows") ?? 0);
    const r = handler(start, rows, url);
    const status = r.status ?? 200;
    if (status !== 200) {
      return new Response("err", { status, statusText: `HTTP ${status}` });
    }
    const n = r.count ?? 0;
    const base = r.startIndex ?? start;
    return Response.json({
      num_found: r.numFound === undefined ? null : r.numFound,
      listings: Array.from({ length: n }, (_, i) => listing(base + i)),
    });
  }) as typeof fetch;
}

const DFW = { zip: "76011", radius: 100 };

beforeEach(() => {
  requested = [];
  process.env.MARKETCHECK_API_KEY = "test-key";
});
afterEach(() => {
  globalThis.fetch = origFetch;
  if (origKey === undefined) delete process.env.MARKETCHECK_API_KEY;
  else process.env.MARKETCHECK_API_KEY = origKey;
});

// ── The core walk ────────────────────────────────────────────────────────────

test("REPRODUCTION: a 10-call sweep walks start=0..450 and never exceeds start+rows=500", async () => {
  stubFetch(() => ({ numFound: 5000, count: 50 }));
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 10 });

  assert.equal(requested.length, 10, "exactly ten calls — the old adapter made one");
  assert.deepEqual(
    requested.map((u) => Number(u.searchParams.get("start"))),
    [0, 50, 100, 150, 200, 250, 300, 350, 400, 450],
  );
  for (const u of requested) {
    const s = Number(u.searchParams.get("start"));
    const r = Number(u.searchParams.get("rows"));
    assert.ok(s + r <= 500, `start+rows must not exceed 500 (got ${s}+${r})`);
  }
  assert.equal(res.stopReason, "PAGE_CAP");
  assert.equal(res.apiCallsUsed, 10);
  assert.equal(res.rawListings, 500);
  assert.equal(res.outcome, "SUCCESS");
});

test("the tenth page is legal: start=450 with rows=50 is NOT trimmed away", async () => {
  // A guard written as `start + rows >= 500` would stop after 9 calls / 450 listings while
  // its own test asserted ten. The rule is `start + rows <= 500`, so 450+50 is the last page.
  stubFetch(() => ({ numFound: 5000, count: 50 }));
  await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 10 });
  const last = requested.at(-1)!;
  assert.equal(last.searchParams.get("start"), "450");
  assert.equal(last.searchParams.get("rows"), "50");
});

test("a short page ends the walk", async () => {
  stubFetch((start) => ({ numFound: 5000, count: start === 150 ? 20 : 50 }));
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 10 });
  assert.equal(requested.length, 4);
  assert.equal(res.stopReason, "SHORT_PAGE");
  assert.equal(res.rawListings, 170);
});

test("collecting everything the provider claimed ends the walk", async () => {
  stubFetch(() => ({ numFound: 100, count: 50 }));
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 10 });
  assert.equal(requested.length, 2, "100 of 100 collected — no third call");
  assert.equal(res.stopReason, "NUM_FOUND_REACHED");
});

test("a page contributing zero NEW keys ends the walk (start being ignored)", async () => {
  // Without this guard, a provider that ignores `start` lets a 10-call sweep ingest the
  // same 50 listings ten times and report a healthy run.
  stubFetch(() => ({ numFound: 5000, count: 50, startIndex: 0 }));
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 10 });
  assert.equal(requested.length, 2);
  assert.equal(res.stopReason, "NO_NEW_KEYS");
  assert.equal(res.vehicles.length, 50, "the duplicates collapse to one set");
  assert.equal(res.rawListings, 100, "but the raw count records what was actually received");
});

test("cross-page duplicate VINs collapse to a single vehicle", async () => {
  stubFetch((start) => ({ numFound: 5000, count: 50, startIndex: start === 100 ? 0 : start }));
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 3 });
  assert.equal(res.rawListings, 150);
  assert.equal(res.vehicles.length, 100, "page 3 repeated page 1's VINs");
});

// ── The documented 422 rule ──────────────────────────────────────────────────

test("start past num_found is never requested — the 422 is avoided, not earned", async () => {
  // Provider rule: `start` greater than num_found returns HTTP 422. Spending a call to
  // discover the end of the result set is a wasted call against a 500/month cap.
  stubFetch((start) => ({ numFound: 120, count: start >= 100 ? 20 : 50 }));
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 10 });
  assert.equal(requested.length, 3, "start=0,50,100 — and then it stops");
  assert.ok(requested.every((u) => Number(u.searchParams.get("start")) < 120));
  assert.equal(res.outcome, "SUCCESS");
});

test("a 422 mid-walk terminates cleanly and is NOT a failure", async () => {
  // Belt-and-braces behind the pre-fetch guard. Without this branch a COMPLETE sweep falls
  // into the 4xx path and a finished walk reports FAILED.
  stubFetch((start) => (start >= 100 ? { status: 422 } : { numFound: null, count: 50 }));
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 10 });
  assert.equal(res.stopReason, "NUM_FOUND_REACHED");
  assert.equal(res.outcome, "SUCCESS", "overrunning the result set is exhaustion, not an error");
  assert.equal(res.error, undefined);
  assert.equal(res.vehicles.length, 100, "everything already collected is kept");
});

// ── Failure handling ─────────────────────────────────────────────────────────

test("a 429 on page 0 is DEFERRED with no partial data (unchanged behaviour)", async () => {
  stubFetch(() => ({ status: 429 }));
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 10 });
  assert.equal(res.outcome, "DEFERRED");
  assert.equal(res.apiCallsUsed, 1, "it must not burn the whole grant discovering it is rate-limited");
  assert.equal(res.vehicles.length, 0);
  assert.match(String(res.error), /429/);
});

test("a 429 on page 4 is PARTIAL and keeps the three good pages", async () => {
  stubFetch((start) => (start >= 150 ? { status: 429 } : { numFound: 5000, count: 50 }));
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 10 });
  assert.equal(res.outcome, "PARTIAL", "never a clean SUCCESS, never a total FAILED");
  assert.equal(res.pagesFetched, 3);
  assert.equal(res.pagesFailed, 1);
  assert.equal(res.vehicles.length, 150, "discarding good data would be its own dishonesty");
  assert.match(String(res.error), /429/);
});

test("a 400 on page 0 is a hard FAILED, not a retry-next-time DEFERRED", async () => {
  stubFetch(() => ({ status: 400 }));
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 10 });
  assert.equal(res.outcome, "FAILED");
});

// ── Cap enforcement: three independent layers ────────────────────────────────

test("a corrupt config row cannot raise the compiled per-sweep cap", async () => {
  stubFetch(() => ({ numFound: 100_000, count: 50 }));
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 999, maxCalls: 999 });
  assert.equal(requested.length, 10, "MAX_CALLS_PER_SWEEP is compiled in and min()-ed");
  assert.equal(Number(requested[0]!.searchParams.get("rows")), 50, "rows is capped at the provider max");
  assert.equal(res.apiCallsUsed, 10);
});

test("the budget refusing at page 3 stops the walk with what it has", async () => {
  stubFetch(() => ({ numFound: 5000, count: 50 }));
  const budget = makeStaticBudget(3);
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 10, budget });
  assert.equal(requested.length, 3);
  assert.equal(res.stopReason, "BUDGET_EXHAUSTED");
  assert.equal(res.outcome, "PARTIAL");
  assert.equal(res.vehicles.length, 150);
});

test("the budget refusing at page 0 dispatches NOTHING", async () => {
  stubFetch(() => ({ numFound: 5000, count: 50 }));
  const exhausted: CallBudgetLike = { async acquire() { return false; }, spent: () => 0 };
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 10, budget: exhausted });
  assert.equal(requested.length, 0, "zero HTTP calls when the ledger is spent");
  assert.equal(res.apiCallsUsed, 0);
  assert.equal(res.outcome, "BUDGET_EXHAUSTED");
});

test("the budget draw happens immediately before dispatch — no reserve, no refund", async () => {
  // If a call were reserved and then not dispatched, spent() and apiCallsUsed would diverge.
  stubFetch((start) => (start >= 100 ? { status: 500 } : { numFound: 5000, count: 50 }));
  const budget = makeStaticBudget(10);
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 10, budget });
  assert.equal(budget.spent(), res.apiCallsUsed, "every drawn call was actually dispatched");
  assert.equal(budget.spent(), 3);
});

// ── Configuration reaching the wire ──────────────────────────────────────────

test("no market configured means ZERO calls and NOT_CONFIGURED", async () => {
  stubFetch(() => ({ numFound: 5000, count: 50 }));
  const res = await new MarketCheckAdapter().search({ radius: 100, rowsPerCall: 50, maxCalls: 10 });
  assert.equal(requested.length, 0);
  assert.equal(res.outcome, "NOT_CONFIGURED");
  assert.match(String(res.error), /no market configured/);
});

test("the configured market reaches the URL, with radius capped and price in dollars", async () => {
  stubFetch(() => ({ numFound: 10, count: 10 }));
  await new MarketCheckAdapter().search({
    zip: "76011", radius: 250, rowsPerCall: 50, maxCalls: 1,
    make: "Ford", yearMin: 2020, priceMaxCents: 3_500_000,
  });
  const u = requested[0]!;
  assert.equal(u.searchParams.get("zip"), "76011");
  assert.equal(u.searchParams.get("radius"), "100", "the adapter clamps independently of the resolver");
  assert.equal(u.searchParams.get("make"), "Ford");
  assert.equal(u.searchParams.get("year_min"), "2020");
  assert.equal(u.searchParams.get("price_max"), "35000", "cents internally, dollars at the wire");
});

test("maxDistMiles is reported — the cheapest proof the radius took effect", async () => {
  stubFetch(() => ({ numFound: 3, count: 3 }));
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 1 });
  assert.equal(res.maxDistMiles, 12);
  assert.deepEqual(res.market, { zip: "76011", radiusMiles: 100 });
});

test("an unconfigured credential is still NOT_CONFIGURED and makes no call", async () => {
  delete process.env.MARKETCHECK_API_KEY;
  stubFetch(() => ({ numFound: 5000, count: 50 }));
  const res = await new MarketCheckAdapter().search({ ...DFW, maxCalls: 10 });
  assert.equal(requested.length, 0);
  assert.equal(res.outcome, "NOT_CONFIGURED");
  assert.equal(res.configured, false);
});

// ── The yield gate, end to end through the adapter ───────────────────────────

test("a materially short run records FAILED, not COMPLETED", async () => {
  // One page of 20 against a claimed 5000, then the short page ends the walk.
  stubFetch(() => ({ numFound: 5000, count: 20 }));
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 10 });
  assert.equal(res.stopReason, "SHORT_PAGE");
  assert.equal(res.outcome, "FAILED");
  assert.equal(res.coverage, "SHORT");
  assert.match(String(res.error), /short run/);
});

test("a complete sweep of a small market is SUCCESS", async () => {
  stubFetch(() => ({ numFound: 37, count: 37 }));
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 10 });
  assert.equal(res.outcome, "SUCCESS");
  assert.equal(res.coverage, "OK");
  assert.equal(res.vehicles.length, 37);
});
