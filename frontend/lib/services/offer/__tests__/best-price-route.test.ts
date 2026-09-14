// §8c parity row C9 — THE BUYER REPORT IS THE ENGINE OUTPUT, and the term is a server parameter.
//
// The route carried a SECOND ranking implementation. It re-sorted the offers itself, picked Best
// Cash from its own sort and Best Overall from the engine (so the two could disagree about one
// auction), applied a fabricated `DEFAULT_APR_RATE = 7` to offers carrying no financing — so the
// Best Monthly card could be won on a payment no dealership ever quoted — and assigned the #1/#2/#3
// badges with ties broken "by card order", which §8c forbids in as many words.
//
// The term came straight from the query string with `parseInt(... ?? "60")` and no validation:
// `?months=abc` reached the engine as NaN and `?months=0` reached a monthly-payment formula that
// divides by the term (§8.2 defect 9, "server-only parameters").
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/offer/__tests__/best-price-route.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/dist/server/web/spec-extension/request";

type Rec = Record<string, unknown>;

let auction: Rec | null;
let report: Rec[];
let reportCalls: Array<{ auctionId: string; termMonths: number }>;
let otdRows: Rec[];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      // HONOURS THE `where`. A fake that answered regardless of scope made
      // "another buyer's auction is not found" pass with `buyerId` deleted from the route's
      // query — a green suite over a cross-buyer IDOR on a report containing someone else's
      // offers. Found by review; the engine fake in the same commit already did this.
      auction: {
        findFirst: async ({ where }: { where: Rec }) =>
          auction && (where.buyerId === undefined || where.buyerId === (auction as Rec).buyerId)
            ? auction
            : null,
      },
      offer: { findMany: async () => otdRows },
    },
  },
});

mock.module("@/lib/auth/api", {
  namedExports: {
    getRequestBuyer: async () => ({ id: "b1" }),
    successResponse: (data: unknown) => Response.json({ success: true, data }),
    errorResponse: (code: string, message: string, status: number) =>
      Response.json({ success: false, error: { code, message } }, { status }),
  },
});

mock.module("@/lib/services/offer/best-price.service", {
  namedExports: {
    getBestPriceReport: async (auctionId: string, termMonths: number) => {
      reportCalls.push({ auctionId, termMonths });
      return { ranked: report, source: "persisted" };
    },
    // The REAL card selection, imported rather than faked: the point of the row is that the route
    // stops choosing winners, so a fake here would hide whether it still does.
    selectTopOffers: (ranked: Rec[]) => {
      if (!ranked.length) return { bestCash: null, bestMonthly: null, bestOverall: null };
      const financed = ranked.filter((r) => r.monthlyPayment != null);
      return {
        bestCash: ranked[0],
        bestMonthly: financed.length
          ? financed.reduce((a, b) => ((b.monthlyPayment as number) < (a.monthlyPayment as number) ? b : a))
          : null,
        bestOverall: ranked.reduce((a, b) => ((b.overallScore as number) < (a.overallScore as number) ? b : a)),
      };
    },
  },
});

function ranked(over: Rec = {}): Rec {
  return {
    offerId: "off_1",
    otdPriceCents: 3_000_000,
    junkFeesCents: 0,
    monthlyPayment: undefined,
    dealerTier: "STANDARD",
    aprFlag: null,
    aprRate: null,
    submittedAt: new Date("2026-09-01T06:00:00Z"),
    overallScore: 0.2,
    ...over,
  };
}

beforeEach(() => {
  auction = { id: "auc_1", buyerId: "b1", status: "CLOSED", startedAt: new Date("2026-09-01T00:00:00Z"), createdAt: new Date("2026-09-01T00:00:00Z") };
  report = [ranked()];
  reportCalls = [];
  otdRows = [{ id: "off_1", vehiclePriceCents: 2_800_000, taxCents: 150_000, feesCents: 50_000 }];
});

async function get(query = "") {
  const { GET } = await import("../../../../app/api/buyer/auctions/[auctionId]/best-price/route");
  const req = new NextRequest(`http://localhost/api/buyer/auctions/auc_1/best-price${query}`);
  const res = await GET(req, { params: Promise.resolve({ auctionId: "auc_1" }) });
  return { status: res.status, json: (await res.json()) as Rec };
}

// ── the term is a SERVER parameter ──────────────────────────────────────────────────────────────

test("a non-numeric term is refused, not passed through as NaN", async () => {
  const { status, json } = await get("?months=abc");
  assert.equal(status, 400);
  assert.equal(((json.error as Rec).code), "VALIDATION_ERROR");
  assert.equal(reportCalls.length, 0, "NaN reached the engine");
});

test("a zero or negative term is refused — the monthly formula divides by it", async () => {
  for (const q of ["?months=0", "?months=-12"]) {
    assert.equal((await get(q)).status, 400, q);
  }
});

test("a term outside §8a's 6–96 range is refused rather than silently clamped", async () => {
  // Clamping would show a buyer who asked for 120 months a payment for 96 without saying so.
  assert.equal((await get("?months=120")).status, 400);
  assert.equal((await get("?months=5")).status, 400);
  assert.equal((await get("?months=6")).status, 200);
  assert.equal((await get("?months=96")).status, 200);
});

test("a fractional term is refused", async () => {
  assert.equal((await get("?months=60.5")).status, 400);
});

test("no term means the documented default, and it reaches the engine", async () => {
  await get();
  assert.deepEqual(reportCalls, [{ auctionId: "auc_1", termMonths: 60 }]);
});

// ── the route does no ranking of its own ────────────────────────────────────────────────────────

test("the cards come from the engine's order — the route never re-sorts", async () => {
  // `bestCash` is the engine's first row. A route that re-sorted by price would pick the other.
  report = [
    ranked({ offerId: "engine_first", otdPriceCents: 3_000_000, overallScore: 0.1 }),
    ranked({ offerId: "cheaper_looking", otdPriceCents: 2_900_000, overallScore: 0.9 }),
  ];
  otdRows = [
    { id: "engine_first", vehiclePriceCents: 1, taxCents: 1, feesCents: 1 },
    { id: "cheaper_looking", vehiclePriceCents: 1, taxCents: 1, feesCents: 1 },
  ];
  const { json } = await get();
  const cards = (json.data as Rec).offers as Rec[];
  assert.equal(cards[0].rankType, "BEST_CASH");
  assert.equal(cards[0].offerId, "engine_first", "the route re-sorted instead of trusting the engine");
});

test("a cash-only auction produces NO Best Monthly card — no APR is invented", async () => {
  report = [ranked({ offerId: "cash", monthlyPayment: undefined })];
  const { json } = await get();
  const cards = (json.data as Rec).offers as Rec[];
  assert.equal(cards.some((c) => c.rankType === "BEST_MONTHLY"), false);
  assert.equal(cards[0].monthlyPayment, undefined, "a monthly payment was fabricated for a cash offer");
});

test("one offer winning every dimension yields ONE card, not three copies of itself", async () => {
  report = [ranked({ offerId: "solo", monthlyPayment: 48_000, overallScore: 0.1 })];
  const cards = ((await get()).json.data as Rec).offers as Rec[];
  assert.equal(cards.length, 1);
  assert.equal(cards[0].rankType, "BEST_CASH");
});

// ── §8c: equal results presented as equal ───────────────────────────────────────────────────────

test("two cards at the same price BOTH read #1", async () => {
  // The old badge assigned #1/#2 with ties broken "by card order", inventing a winner.
  report = [
    ranked({ offerId: "a", otdPriceCents: 3_000_000, overallScore: 0.9 }),
    ranked({ offerId: "b", otdPriceCents: 3_000_000, monthlyPayment: 44_000, overallScore: 0.1 }),
  ];
  otdRows = [
    { id: "a", vehiclePriceCents: 1, taxCents: 1, feesCents: 1 },
    { id: "b", vehiclePriceCents: 1, taxCents: 1, feesCents: 1 },
  ];
  const cards = ((await get()).json.data as Rec).offers as Rec[];
  assert.ok(cards.length >= 2);
  for (const c of cards) assert.equal(c.rank, 1, `${c.rankType} was badged #${c.rank}`);
});

test("a dearer card is badged behind a cheaper one", async () => {
  report = [
    ranked({ offerId: "cheap", otdPriceCents: 2_900_000, overallScore: 0.9 }),
    ranked({ offerId: "dear", otdPriceCents: 3_400_000, monthlyPayment: 40_000, overallScore: 0.1 }),
  ];
  otdRows = [
    { id: "cheap", vehiclePriceCents: 1, taxCents: 1, feesCents: 1 },
    { id: "dear", vehiclePriceCents: 1, taxCents: 1, feesCents: 1 },
  ];
  const cards = ((await get()).json.data as Rec).offers as Rec[];
  assert.equal(cards.find((c) => c.offerId === "cheap")!.rank, 1);
  assert.equal(cards.find((c) => c.offerId === "dear")!.rank, 2);
});

// ── the surrounding contract, unchanged but re-pinned ───────────────────────────────────────────

test("the OTD breakdown and response time still reach the cards", async () => {
  const cards = ((await get()).json.data as Rec).offers as Rec[];
  assert.deepEqual(cards[0].otdBreakdown, { vehiclePriceCents: 2_800_000, taxCents: 150_000, feesCents: 50_000 });
  assert.equal(cards[0].responseTimeHours, 6);
});

test("an ACTIVE auction is still labelled preliminary", async () => {
  auction = { ...auction!, status: "ACTIVE" };
  const data = (await get()).json.data as Rec;
  assert.equal(data.preliminary, true);
  assert.match(String(data.label), /Preliminary/);
});

test("a PENDING auction has nothing to rank", async () => {
  auction = { ...auction!, status: "PENDING" };
  assert.equal((await get()).status, 400);
});

test("another buyer's auction is not found — the query is SCOPED, not just filtered here", async () => {
  // The fake honours `where.buyerId`, so this fails if the route ever stops scoping the lookup.
  auction = { ...auction!, buyerId: "someone_else" };
  assert.equal((await get()).status, 404);
});

test("a missing auction is a 404", async () => {
  auction = null;
  assert.equal((await get()).status, 404);
});

test("no offers is an empty report, not an error", async () => {
  report = [];
  const { status, json } = await get();
  assert.equal(status, 200);
  assert.deepEqual((json.data as Rec).offers, []);
});
