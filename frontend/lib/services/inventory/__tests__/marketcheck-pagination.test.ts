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

/**
 * Stub the provider. `pages` maps a `start` offset to its response.
 *
 * `body` and `headers` exist because the adapter now READS a non-2xx response: a 422's
 * message is the only thing that distinguishes an invalid ZIP from a plan ceiling from a
 * misconfigured radius, and a 429's headers are the only thing that says when to come back.
 * A stub that returns a bodiless "err" cannot exercise either, which is why the old
 * blanket 422 handling went unchallenged for so long.
 */
function stubFetch(handler: (start: number, rows: number, url: URL) => {
  status?: number;
  numFound?: number | null;
  count?: number;
  startIndex?: number;
  /** Response body for a non-2xx. Objects are sent as JSON, strings verbatim. */
  body?: unknown;
  headers?: Record<string, string>;
  /** Override the listings for this page entirely (e.g. to vary `dist`). */
  listings?: unknown[];
}) {
  globalThis.fetch = (async (input: string | URL) => {
    const url = new URL(String(input));
    requested.push(url);
    const start = Number(url.searchParams.get("start") ?? 0);
    const rows = Number(url.searchParams.get("rows") ?? 0);
    const r = handler(start, rows, url);
    const status = r.status ?? 200;
    if (status !== 200) {
      const body = r.body === undefined
        ? "err"
        : typeof r.body === "string" ? r.body : JSON.stringify(r.body);
      return new Response(body, { status, statusText: `HTTP ${status}`, headers: r.headers });
    }
    const n = r.count ?? 0;
    const base = r.startIndex ?? start;
    return Response.json({
      num_found: r.numFound === undefined ? null : r.numFound,
      listings: r.listings ?? Array.from({ length: n }, (_, i) => listing(base + i)),
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

// ── 422 IS THREE DIFFERENT ANSWERS, AND USED TO BE TREATED AS ONE ───────────
//
// RETIRED HERE, DELIBERATELY: `"a 422 mid-walk terminates cleanly and is NOT a failure"`,
// which asserted stopReason NUM_FOUND_REACHED, outcome SUCCESS and error undefined for
// ANY 422. That test was green and it ratified the defect. It is not being relaxed to
// make new code pass — the behaviour it pinned is wrong, and §22a L1079 is the line that
// says so: "A provider failure is never shown to a buyer as an empty market — they are
// told the search is unavailable and offered the request path." Under the old branch an
// invalid ZIP and a misconfigured radius both returned a clean, empty, successful market.
//
// Three distinct 422 messages were observed live on 2026-09-10 against the same endpoint:
//
//   "Zipcode 00000 not found"                                    -> invalid input
//   "Subscribed package pagination limit of 500 rows exceeded"   -> plan ceiling
//   "Subscribed package radius limit of 100 miles exceeded"      -> OUR misconfiguration
//
// §9 named only the first two. The third is new evidence and it is the one that must never
// read as exhaustion: it means the configured radius exceeds what the plan allows, so the
// sweep is silently querying nothing.

test("422 'pagination limit' is the plan ceiling: stop cleanly, keep what was collected", async () => {
  stubFetch((start) =>
    start >= 100
      ? { status: 422, body: { message: "Subscribed package pagination limit of 500 rows exceeded" } }
      : { numFound: null, count: 50 });
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 10 });
  assert.equal(res.stopReason, "PROVIDER_CEILING");
  assert.equal(res.outcome, "SUCCESS", "reaching the plan's deep-paging limit is the design, not a failure");
  assert.equal(res.error, undefined);
  assert.equal(res.vehicles.length, 100, "everything already collected is kept");
});

test("422 'Zipcode not found' is INVALID INPUT and must never read as an empty market", async () => {
  stubFetch(() => ({ status: 422, body: { message: "Zipcode 00000 not found" } }));
  const res = await new MarketCheckAdapter().search({ zip: "00000", radius: 100, rowsPerCall: 50, maxCalls: 10 });
  assert.equal(res.outcome, "FAILED", "a bad ZIP is a failure to report, not a market with no cars in it");
  assert.notEqual(res.outcome, "ZERO_RESULTS");
  assert.equal(res.stopReason, "PROVIDER_INVALID_QUERY");
  assert.match(String(res.error), /Zipcode/);
  assert.equal(res.vehicles.length, 0);
});

test("422 'radius limit' is OUR misconfiguration and is reported as one", async () => {
  // The plan's radius ceiling is below the radius we asked for, so this query returned
  // nothing at all. Under the old branch it read as a clean, exhausted, empty market —
  // a swept catalogue quietly going to zero with every run recorded green.
  stubFetch(() => ({ status: 422, body: { message: "Subscribed package radius limit of 100 miles exceeded" } }));
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 10 });
  assert.equal(res.outcome, "FAILED");
  assert.equal(res.stopReason, "PROVIDER_RADIUS_REFUSED");
  assert.match(String(res.error), /radius/i);
});

test("an UNRECOGNISED 422 is a provider error, not an assumed exhaustion", async () => {
  // The safe default. The pre-fetch guard at the top of the walk already prevents the
  // genuine start-past-the-end case, so an unclassified 422 is something we do not
  // understand — and the failure mode of guessing "exhausted" is an empty market.
  stubFetch(() => ({ status: 422, body: { message: "Some message nobody has seen before" } }));
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 10 });
  assert.equal(res.outcome, "FAILED");
  assert.equal(res.stopReason, "PROVIDER_ERROR");
  assert.match(String(res.error), /422/);
});

test("a 422 with an unreadable body still fails closed", async () => {
  stubFetch(() => ({ status: 422, body: "<html>gateway</html>" }));
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 10 });
  assert.equal(res.outcome, "FAILED");
  assert.notEqual(res.outcome, "ZERO_RESULTS");
});

test("a plan-ceiling 422 on page 0 has nothing to keep and is not a success", async () => {
  // Distinct from the mid-walk case above: reaching the ceiling before any page landed
  // means the FIRST request was refused, which is a configuration problem, not a
  // completed walk.
  stubFetch(() => ({ status: 422, body: { message: "Subscribed package pagination limit of 500 rows exceeded" } }));
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 10 });
  assert.equal(res.vehicles.length, 0);
  assert.notEqual(res.outcome, "SUCCESS");
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

// ── Throttling: read what the provider tells us, do not guess ───────────────
//
// The 191-run silent freeze was 429s recorded as a non-alerting deferred status with
// nothing read off them. "Transient, try tomorrow" is a guess; Retry-After is an answer.
// The exact header NAMES are UNVERIFIED against the production plan — the MCP transport
// does not expose HTTP headers and this session must not make a raw keyed call — so the
// read is deliberately tolerant: case-insensitive, absence-tolerant, and advisory only.
// Nothing branches on a missing header.

test("Retry-After and the quota headers are read off a 429 and reported", async () => {
  stubFetch(() => ({
    status: 429,
    headers: {
      "Retry-After": "120",
      "X-RateLimit-Remaining": "0",
      "Quota-Remaining": "0",
      "Quota-Limit": "500",
    },
  }));
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 10 });
  assert.equal(res.outcome, "DEFERRED");
  assert.equal(res.throttle?.retryAfterSeconds, 120);
  assert.equal(res.throttle?.quotaRemaining, 0);
  assert.equal(res.throttle?.quotaLimit, 500);
});

test("header names are matched case-insensitively", async () => {
  stubFetch(() => ({ status: 429, headers: { "retry-after": "45", "quota-remaining": "7" } }));
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 10 });
  assert.equal(res.throttle?.retryAfterSeconds, 45);
  assert.equal(res.throttle?.quotaRemaining, 7);
});

test("a 429 with NO throttle headers is still a clean DEFERRED — the read is advisory", async () => {
  stubFetch(() => ({ status: 429 }));
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 10 });
  assert.equal(res.outcome, "DEFERRED");
  assert.equal(res.throttle?.retryAfterSeconds, undefined);
  assert.equal(res.throttle?.observed, false, "absence is recorded, so 'we did not look' and 'they did not say' stay distinguishable");
});

test("an HTTP-date Retry-After is parsed, not silently dropped", async () => {
  // RFC 9110 allows either delta-seconds or an HTTP-date. Which one this provider sends is
  // UNVERIFIED, so both are handled.
  const when = new Date(Date.now() + 90_000).toUTCString();
  stubFetch(() => ({ status: 429, headers: { "Retry-After": when } }));
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 10 });
  const secs = res.throttle?.retryAfterSeconds ?? 0;
  assert.ok(secs > 60 && secs <= 91, `expected ~90s from an HTTP-date, got ${secs}`);
});

// ── The radius is a policy, so a listing outside it is rejected ─────────────

test("a listing beyond the requested radius is REJECTED, not stored", async () => {
  // §9 item 2: the adapter recorded maxDist as evidence and then ingested the row anyway.
  // A listing 140 miles out is not shortlist-eligible and must not enter the catalogue as
  // though it were — the shortlist gate would refuse it later, after it had already been
  // shown with a distance the buyer could act on.
  stubFetch(() => ({
    listings: [listing(1, 12), listing(2, 140), listing(3, 99.9)],
    numFound: 3,
  }));
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 1 });
  assert.equal(res.vehicles.length, 2, "the 140-mile listing is dropped; 12 and 99.9 are kept");
  assert.equal(res.outOfRadiusDropped, 1);
  assert.equal(res.maxDistMiles, 99.9, "maxDist reports what was KEPT, so it stays proof the radius held");
});

test("exactly the radius is INSIDE it — the boundary matches the shortlist gate", async () => {
  stubFetch(() => ({ listings: [listing(1, 100)], numFound: 1 }));
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 1 });
  assert.equal(res.vehicles.length, 1, "shortlistGate treats 100 as in-radius; the adapter must agree");
});

test("a listing with NO dist is kept — absent is not far", async () => {
  const noDist = { ...listing(1, 12) } as Record<string, unknown>;
  delete noDist.dist;
  stubFetch(() => ({ listings: [noDist], numFound: 1 }));
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 1 });
  assert.equal(res.vehicles.length, 1, "the shortlist gate fails such a row closed later; the adapter does not guess here");
  assert.equal(res.outOfRadiusDropped, 0);
});

test("dropping out-of-radius rows does not corrupt the coverage gate", async () => {
  // rawListings counts what the provider SENT. If dropped rows silently reduced it, a
  // provider ignoring our radius would read as a short run rather than as what it is.
  stubFetch(() => ({
    listings: Array.from({ length: 50 }, (_, i) => listing(i, i < 40 ? 10 : 500)),
    numFound: 50,
  }));
  const res = await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 1 });
  assert.equal(res.rawListings, 50, "raw is what arrived");
  assert.equal(res.outOfRadiusDropped, 10);
  assert.equal(res.vehicles.length, 40);
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
  assert.equal(u.searchParams.get("price_max"), "35000", "cents internally, dollars at the wire");
});

// ── The three include flags, which are the root cause of the null dealer ────
//
// None of them defaults to true. Probed live 2026-09-10: a query WITHOUT them returns a
// listing carrying neither a `dealer` key nor a `build` key — and normalize() derives
// year/make/model from `build` and every provenance column from `dealer`. That omission
// is the probable root cause of "0 of 148 active rows carry a dealer reference"
// (Appendix FINDINGS[7]) and it is why mc_rooftop_id has been NULL on all 1,422 rooftops
// and all 221 listings: there is no key to join them on.

test("all three include flags are sent — without them the payload carries no dealer and no build", async () => {
  stubFetch(() => ({ numFound: 10, count: 10 }));
  await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 1 });
  const u = requested[0]!;
  assert.equal(u.searchParams.get("include_dealer_object"), "true",
    "without this the listing has no dealer key at all — probed live 2026-09-10");
  assert.equal(u.searchParams.get("include_mc_dealership_object"), "true",
    "mc_rooftop_id exists ONLY on mc_dealership; it is the rooftop-level join key");
  assert.equal(u.searchParams.get("include_build_object"), "true",
    "normalize() derives year/make/model from build and rejects the listing without them");
});

test("every page of a multi-page walk carries the include flags, not just the first", async () => {
  stubFetch(() => ({ numFound: 5000, count: 50 }));
  await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 4 });
  assert.equal(requested.length, 4);
  for (const [i, u] of requested.entries()) {
    assert.equal(u.searchParams.get("include_mc_dealership_object"), "true", `page ${i} lost the flag`);
  }
});

// ── Filter parameter NAMES, which are not what the adapter used to send ─────

test("a year range is sent as the documented `year_range`, not year_min/year_max", async () => {
  // The provider's schema for /v2/search/car/active exposes `year_range` in "min-max"
  // form and does NOT document year_min/year_max. Whether those were silently ignored is
  // UNVERIFIED — this session cannot make a keyed call — and an ignored filter is the
  // worst case, not the safe one: it silently widens the query, so a buyer sees cars
  // outside their criteria while the code believes it filtered. Send the documented name.
  stubFetch(() => ({ numFound: 10, count: 10 }));
  await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 1, yearMin: 2019, yearMax: 2023 });
  const u = requested[0]!;
  assert.equal(u.searchParams.get("year_range"), "2019-2023");
  assert.equal(u.searchParams.get("year_min"), null, "the undocumented name must not be sent");
  assert.equal(u.searchParams.get("year_max"), null);
});

test("a one-sided year bound still produces a valid range", async () => {
  stubFetch(() => ({ numFound: 10, count: 10 }));
  await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 1, yearMin: 2019 });
  assert.equal(requested[0]!.searchParams.get("year_range"), "2019-9999");
  requested = [];
  await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 1, yearMax: 2023 });
  assert.equal(requested[0]!.searchParams.get("year_range"), "0-2023");
});

test("no year bound sends no year parameter at all", async () => {
  stubFetch(() => ({ numFound: 10, count: 10 }));
  await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 1 });
  assert.equal(requested[0]!.searchParams.get("year_range"), null);
});

// ── The parameters qualified results needs, which SearchParams did not carry ─

test("condition, mileage ceiling and a price FLOOR reach the provider", async () => {
  stubFetch(() => ({ numFound: 10, count: 10 }));
  await new MarketCheckAdapter().search({
    ...DFW, rowsPerCall: 50, maxCalls: 1,
    carType: "certified", milesMax: 60_000, priceMinCents: 1_500_000, priceMaxCents: 3_500_000,
  });
  const u = requested[0]!;
  assert.equal(u.searchParams.get("car_type"), "certified", "the buyer's condition preference, not a hardcoded 'used'");
  assert.equal(u.searchParams.get("miles_range"), "0-60000");
  assert.equal(u.searchParams.get("price_min"), "15000", "a buyer's floor overrides the anti-unpriced sentinel");
  assert.equal(u.searchParams.get("price_max"), "35000");
});

test("car_type still defaults to used when the caller does not say", async () => {
  stubFetch(() => ({ numFound: 10, count: 10 }));
  await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 1 });
  assert.equal(requested[0]!.searchParams.get("car_type"), "used", "the sweep's behaviour is unchanged");
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

// ── Every call must come back full of usable listings ────────────────────────

test("the sweep asks only for PRICED listings", async () => {
  // normalize() discards a listing with no price — a car with no price cannot be shown to a
  // buyer or taken to a reverse auction. Verified live against the DFW market on 2026-09-02
  // (zip 76011, radius 100): an unfiltered page returned 33 priced listings of 50, the same
  // page with a price floor returned 50 of 50. Across a 10-page sweep that is the difference
  // between ~330 and 500 usable vehicles for the SAME 10 calls against a 500/month cap.
  stubFetch(() => ({ numFound: 83_223, count: 50 }));
  await new MarketCheckAdapter().search({ ...DFW, rowsPerCall: 50, maxCalls: 1 });

  const u = requested[0]!;
  assert.equal(u.searchParams.get("price_min"), "1",
    "fetching listings normalize() is guaranteed to discard wastes a third of every call");
});

test("the price floor coexists with a configured maximum", async () => {
  stubFetch(() => ({ numFound: 100, count: 10 }));
  await new MarketCheckAdapter().search({
    ...DFW, rowsPerCall: 50, maxCalls: 1, priceMaxCents: 3_500_000,
  });
  const u = requested[0]!;
  assert.equal(u.searchParams.get("price_min"), "1");
  assert.equal(u.searchParams.get("price_max"), "35000", "cents internally, dollars at the wire");
});


test("a page that is mostly OUT OF RADIUS is not reported as a normalization failure", async () => {
  // FOUND IN REVIEW, and it is the exact case the radius rejection was added for (§9 item 2).
  //
  // Dropped rows are counted in `rawListings` but never reach normalize(), so the
  // normalization gate saw 10 normalized of 50 raw — below the 0.25 floor — and downgraded a
  // perfectly healthy run to FAILED with "normalization dropped 40 of 50 listings (missing
  // year/make/model/price)". The orchestrator then raised INVENTORY_SWEEP_SHORTFALL with that
  // false root cause, `assessSyncRun` logged the cron FAILED, and the qualified-results view
  // told buyers the market was unknowable over ten good cars.
  //
  // The earlier test here dropped 10 of 50 — 20%, under the floor — so it could never reach
  // this. This one drops 40.
  const listings = [
    ...Array.from({ length: 40 }, (_, i) => listing(i, 250)),
    ...Array.from({ length: 10 }, (_, i) => listing(100 + i, 12)),
  ];
  stubFetch(() => ({ numFound: 50, listings }));

  const res = await new MarketCheckAdapter().search({ zip: "76011", radius: 100, rowsPerCall: 50, maxCalls: 1 });

  assert.equal(res.rawListings, 50, "rawListings stays an honest count of what the provider sent");
  assert.equal(res.outOfRadiusDropped, 40);
  assert.equal(res.vehicles.length, 10);
  assert.equal(res.outcome, "SUCCESS",
    "ten good cars is a healthy run — the normalization gate measures SHAPE loss, not policy rejections");
  assert.equal(res.error, undefined, "and it must not be given a false root cause");
});
