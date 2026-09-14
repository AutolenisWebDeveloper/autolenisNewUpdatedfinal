// §8c — THE BEST PRICE ENGINE: within-candidate ranking, cross-candidate discount, one store.
//
// The engine had NO test of any kind before this phase. Parity rows C6/C7/C8 and §8.2 defect 9 are
// all here:
//
//   C6  "Rank WITHIN a candidate". Every offer on the auction was ranked in one pool, so on a
//       two-candidate auction the cheaper CAR won every rank and the dealership with the best
//       offer on the other candidate was reported #3 of 3 — a comparison the buyer never asked
//       for, since they put both cars up precisely because they are different.
//       Fees and junk fees were also collapsed: the engine added `weightFees` and `weightJunkFees`
//       together and applied the sum to ONE junk-fee rank, so 20% of the configured model was
//       spent on a dimension the administrator never pointed it at.
//
//   C7  Cross-candidate ranking on DISCOUNT to listed market price — missing entirely.
//
//   C8  ONE STORE. The log was written at close and the per-offer rank columns only by the admin
//       re-run, so the two records of the same auction could disagree with nothing to say which
//       was current; and the log insert ended in `.catch(() => {})`, so "never a black box"
//       quietly meant "unless the insert failed, in which case there is no trace of that either".
//
//   Ranking also ignored `is_disqualified` and `expires_at`, so a §13-D40 over-ceiling offer and a
//   lapsed one were both ranked and both shown to the buyer.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/offer/__tests__/best-price-engine.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

type Rec = Record<string, unknown>;

let offers: Rec[];
let weightConfig: Rec | null;
let logsCreated: Rec[];
let offerUpdates: Rec[];
let txCalls: number;

function matches(o: Rec, where: Rec): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === "OR") {
      if (!(v as Rec[]).some((c) => matches(o, c))) return false;
      continue;
    }
    const actual = o[k];
    if (v !== null && typeof v === "object") {
      const cond = v as Rec;
      if ("gt" in cond && !(actual instanceof Date && actual.getTime() > (cond.gt as Date).getTime())) return false;
      continue;
    }
    if (actual !== v) return false;
  }
  return true;
}

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      // HONOURS THE `where`. The defect under test includes an unfiltered query, so a fake that
      // returned every seeded row would make the qualification assertions pass for the wrong reason.
      offer: {
        findMany: async ({ where }: { where: Rec }) => {
          const ids = (where.id as Rec | undefined)?.in as string[] | undefined;
          const rest = { ...where };
          delete rest.id;
          return offers.filter((o) => (!ids || ids.includes(o.id as string)) && matches(o, rest));
        },
        update: (a: Rec) => { offerUpdates.push(a); return a; },
      },
      bestPriceWeightConfig: { findFirst: async () => weightConfig },
      bestPriceCalculationLog: {
        create: (a: Rec) => { logsCreated.push((a as { data: Rec }).data); return a; },
        findFirst: async () => (logsCreated.length ? { ...logsCreated[logsCreated.length - 1], calculatedAt: new Date() } : null),
      },
      // The persistence is one transaction — both halves commit together or neither does.
      $transaction: async (ops: unknown[]) => { txCalls++; return ops; },
    },
  },
});

const FUTURE = new Date(Date.now() + 72 * 3_600_000);
const PAST = new Date(Date.now() - 3_600_000);

function offer(over: Rec = {}): Rec {
  return {
    id: `off_${offers.length + 1}`,
    auctionId: "auc_1",
    dealerId: "d1",
    status: "SUBMITTED",
    isDisqualified: false,
    expiresAt: FUTURE,
    otdPriceCents: 3_000_000,
    feesCents: 50_000,
    junkFeeItems: [],
    includesFinancing: false,
    aprRate: null,
    termMonths: null,
    aprFlag: null,
    submittedAt: new Date("2026-09-01T00:00:00Z"),
    auctionVehicleId: "cand_1",
    requiredFeatureMatches: null,
    requiredFeatureMismatches: null,
    dealer: { id: "d1", tier: "STANDARD", dealershipName: "D" },
    auctionVehicle: { id: "cand_1", distanceMiles: 20, listingSnapshot: { priceCents: 3_200_000 }, inventoryItem: { priceCents: 3_200_000 } },
    ...over,
  };
}

beforeEach(() => {
  offers = [];
  weightConfig = { weightOtd: 0.4, weightMonthly: 0.25, weightFees: 0.2, weightJunkFees: 0.15 };
  logsCreated = [];
  offerUpdates = [];
  txCalls = 0;
});

async function rank(term = 60, opts: Rec = {}) {
  const { rankOffers } = await import("../best-price.service");
  return rankOffers("auc_1", term, opts as never);
}

// ── qualification ───────────────────────────────────────────────────────────────────────────────

test("a disqualified offer is never ranked (§8c: never presented as qualified)", async () => {
  offers = [offer(), offer({ id: "bad", isDisqualified: true, otdPriceCents: 2_000_000 })];
  const r = await rank();
  assert.equal(r.length, 1);
  assert.equal(r[0].offerId, "off_1", "the over-ceiling offer took the top of the buyer's report");
});

test("a lapsed offer is never ranked", async () => {
  offers = [offer(), offer({ id: "old", expiresAt: PAST, otdPriceCents: 2_000_000 })];
  const r = await rank();
  assert.equal(r.length, 1);
});

test("a withdrawn revision is never ranked", async () => {
  offers = [offer(), offer({ id: "w", status: "WITHDRAWN", otdPriceCents: 2_000_000 })];
  assert.equal((await rank()).length, 1);
});

// ── C6 — within-candidate ───────────────────────────────────────────────────────────────────────

test("each candidate has its own #1 — the cheaper CAR does not win every rank", async () => {
  const cheapCar = { id: "cand_1", distanceMiles: 10, listingSnapshot: { priceCents: 3_200_000 }, inventoryItem: null };
  const dearCar = { id: "cand_2", distanceMiles: 10, listingSnapshot: { priceCents: 5_000_000 }, inventoryItem: null };
  offers = [
    offer({ id: "a1", auctionVehicleId: "cand_1", auctionVehicle: cheapCar, otdPriceCents: 3_000_000 }),
    offer({ id: "a2", auctionVehicleId: "cand_1", auctionVehicle: cheapCar, otdPriceCents: 3_100_000 }),
    offer({ id: "b1", auctionVehicleId: "cand_2", auctionVehicle: dearCar, otdPriceCents: 4_600_000 }),
    offer({ id: "b2", auctionVehicleId: "cand_2", auctionVehicle: dearCar, otdPriceCents: 4_700_000 }),
  ];
  const byId = new Map((await rank()).map((r) => [r.offerId, r]));
  assert.equal(byId.get("a1")!.rankCash, 1);
  assert.equal(byId.get("b1")!.rankCash, 1, "the best offer on the second candidate was ranked against the first car");
  assert.equal(byId.get("a2")!.rankCash, 2);
  assert.equal(byId.get("b2")!.rankCash, 2);
});

test("a custom request (no candidate) forms one group rather than one group per offer", async () => {
  offers = [
    offer({ id: "c1", auctionVehicleId: null, auctionVehicle: null, otdPriceCents: 3_000_000 }),
    offer({ id: "c2", auctionVehicleId: null, auctionVehicle: null, otdPriceCents: 3_100_000 }),
  ];
  const byId = new Map((await rank()).map((r) => [r.offerId, r]));
  assert.equal(byId.get("c1")!.rankCash, 1);
  assert.equal(byId.get("c2")!.rankCash, 2);
});

test("fees and junk fees are ranked SEPARATELY", async () => {
  // The old engine never ranked total fees at all: it added `weightFees` to `weightJunkFees` and
  // applied the sum to one junk-fee rank. A dealership with low junk fees but a high total fee
  // load was scored as though the administrator had never weighted total fees.
  offers = [
    offer({ id: "lowfees", feesCents: 10_000, junkFeeItems: [{ name: "Doc", amountCents: 90_000, isJunk: true }] }),
    offer({ id: "lowjunk", feesCents: 90_000, junkFeeItems: [{ name: "Doc", amountCents: 10_000, isJunk: true }] }),
  ];
  const byId = new Map((await rank()).map((r) => [r.offerId, r]));
  assert.equal(byId.get("lowfees")!.rankFees, 1);
  assert.equal(byId.get("lowjunk")!.rankFees, 2);
  assert.equal(byId.get("lowjunk")!.rankJunkFees, 1);
  assert.equal(byId.get("lowfees")!.rankJunkFees, 2);
});

test("a cash offer gets no monthly rank, and a financed one does", async () => {
  offers = [
    offer({ id: "cash" }),
    offer({ id: "fin", includesFinancing: true, aprRate: 6.9, termMonths: 60, otdPriceCents: 3_100_000 }),
  ];
  const byId = new Map((await rank()).map((r) => [r.offerId, r]));
  assert.equal(byId.get("cash")!.rankMonthly, null);
  assert.equal(byId.get("fin")!.rankMonthly, 1);
  assert.ok(byId.get("fin")!.monthlyPayment! > 0);
});

test("equal offers share the overall rank and name each other", async () => {
  offers = [
    offer({ id: "x", submittedAt: new Date("2026-09-01T00:00:00Z") }),
    offer({ id: "y", submittedAt: new Date("2026-09-02T00:00:00Z") }),
  ];
  const byId = new Map((await rank()).map((r) => [r.offerId, r]));
  assert.equal(byId.get("x")!.rankOverall, 1);
  assert.equal(byId.get("y")!.rankOverall, 1, "identical offers were badged #1 and #2");
  assert.deepEqual(byId.get("x")!.tiedWith, ["y"]);
});

// ── C7 — cross-candidate ────────────────────────────────────────────────────────────────────────

test("cross-candidate ranks on DISCOUNT, not on price", async () => {
  // Across different cars the cheapest offer is simply the cheapest car, which the buyer already
  // knew. The question §8c asks is which dealership gives up the most against the listed price.
  offers = [
    offer({
      id: "sedan", auctionVehicleId: "cand_1", otdPriceCents: 2_400_000,
      auctionVehicle: { id: "cand_1", distanceMiles: 10, listingSnapshot: { priceCents: 2_500_000 }, inventoryItem: null },
    }),
    offer({
      id: "truck", auctionVehicleId: "cand_2", otdPriceCents: 6_300_000,
      auctionVehicle: { id: "cand_2", distanceMiles: 10, listingSnapshot: { priceCents: 7_000_000 }, inventoryItem: null },
    }),
  ];
  const byId = new Map((await rank()).map((r) => [r.offerId, r]));
  // The truck is far more expensive but gives up 10% against its listing; the sedan gives up 4%.
  assert.equal(byId.get("truck")!.rankCrossCandidate, 1);
  assert.equal(byId.get("sedan")!.rankCrossCandidate, 2);
  assert.equal(byId.get("truck")!.discountToListedCents, 700_000);
  assert.ok(Math.abs(byId.get("truck")!.discountToListedPct! - 0.1) < 1e-9);
});

test("an unknown listed price is EXCLUDED from the cross-candidate rank, not ranked last", async () => {
  // An unknown discount is not a small one.
  offers = [
    offer({ id: "known" }),
    offer({
      id: "unknown", auctionVehicleId: "cand_2",
      auctionVehicle: { id: "cand_2", distanceMiles: 10, listingSnapshot: null, inventoryItem: null },
    }),
  ];
  const byId = new Map((await rank()).map((r) => [r.offerId, r]));
  assert.equal(byId.get("known")!.rankCrossCandidate, 1);
  assert.equal(byId.get("unknown")!.rankCrossCandidate, null);
  assert.equal(byId.get("unknown")!.discountToListedCents, null);
});

test("the listed price comes from the SNAPSHOT, not from today's inventory row", async () => {
  // The snapshot is what the listing carried when the buyer chose this candidate. Reading today's
  // price would let a dealership that cut its sticker mid-auction shrink every rival's discount.
  offers = [offer({
    id: "s", otdPriceCents: 3_000_000,
    auctionVehicle: { id: "cand_1", distanceMiles: 10, listingSnapshot: { priceCents: 3_500_000 }, inventoryItem: { priceCents: 3_050_000 } },
  })];
  const r = await rank();
  assert.equal(r[0].discountToListedCents, 500_000);
});

// ── C8 — one store ──────────────────────────────────────────────────────────────────────────────

test("persistLog writes the log AND the per-offer columns, in one transaction", async () => {
  offers = [offer({ id: "p1" }), offer({ id: "p2", otdPriceCents: 3_100_000 })];
  await rank(60, { persistLog: true });
  assert.equal(txCalls, 1, "the two halves of the record can no longer be written apart");
  assert.equal(logsCreated.length, 1);
  assert.equal(logsCreated[0].offerCount, 2);
  assert.equal(offerUpdates.length, 2, "the per-offer rank columns were still admin-re-run-only");
  const cols = (offerUpdates[0] as { data: Rec }).data;
  assert.ok("rankCash" in cols && "rankBalanced" in cols && "bestPriceScore" in cols);
});

test("the log carries the candidate binding and the tie information, not just prices", async () => {
  offers = [offer({ id: "l1" }), offer({ id: "l2" })];
  await rank(60, { persistLog: true });
  const rows = logsCreated[0].result as Rec[];
  assert.equal(rows.length, 2);
  assert.ok("auctionVehicleId" in rows[0], "the persisted ranking cannot be reproduced per candidate");
  assert.ok("tiedWith" in rows[0]);
  assert.ok("rankCrossCandidate" in rows[0]);
});

test("nothing is persisted without persistLog — the polled buyer GET must not append rows", async () => {
  offers = [offer()];
  await rank();
  assert.equal(logsCreated.length, 0);
  assert.equal(offerUpdates.length, 0);
});

test("getPersistedRanking serves the committed ranking back", async () => {
  offers = [offer({ id: "g1" })];
  await rank(72, { persistLog: true });
  const { getPersistedRanking } = await import("../best-price.service");
  const got = await getPersistedRanking("auc_1");
  assert.equal(got!.termMonths, 72);
  assert.equal(got!.ranked[0].offerId, "g1");
});

test("getPersistedRanking returns null when nothing was ever persisted", async () => {
  const { getPersistedRanking } = await import("../best-price.service");
  assert.equal(await getPersistedRanking("auc_1"), null);
});

test("the served report drops an offer that lapsed AFTER the ranking was committed", async () => {
  // The ranking is committed at close and the buyer reads it over the next 72 hours. An offer can
  // lapse, be withdrawn, or be disqualified in between. Rendering it from the log alone would keep
  // showing it as qualified, and the select route would then refuse it — the buyer discovering by
  // rejection what the report should have stopped showing.
  offers = [offer({ id: "lives" }), offer({ id: "lapses", otdPriceCents: 2_900_000 })];
  await rank(60, { persistLog: true });
  assert.equal((logsCreated[0].result as Rec[]).length, 2, "both were ranked at close");

  // ...time passes, and the second offer lapses.
  offers[1].expiresAt = PAST;
  const { getBestPriceReport } = await import("../best-price.service");
  const report = await getBestPriceReport("auc_1", 60);
  assert.equal(report.source, "persisted", "the committed ranking must still be the one served");
  assert.deepEqual(report.ranked.map((r) => r.offerId), ["lives"]);
});

test("the served report keeps the RANKS the close committed, not a fresh ranking", async () => {
  // Re-ranking on every page load would let the report change under a buyer who is reading it.
  offers = [offer({ id: "a", otdPriceCents: 3_000_000 }), offer({ id: "b", otdPriceCents: 3_100_000 })];
  await rank(60, { persistLog: true });
  // A third offer arrives after the close (staff intake). It is NOT in the committed ranking and
  // must not silently appear in, or reorder, the report the buyer was sent.
  offers.push(offer({ id: "late", otdPriceCents: 2_500_000 }));
  const { getBestPriceReport } = await import("../best-price.service");
  const report = await getBestPriceReport("auc_1", 60);
  assert.deepEqual(report.ranked.map((r) => r.offerId), ["a", "b"]);
  assert.equal(report.ranked[0].rankCash, 1);
});

// ── the three cards ─────────────────────────────────────────────────────────────────────────────

test("the cards are chosen across the AUCTION, not from whichever candidate sorts first", async () => {
  // `rankCash === 1` no longer identifies one offer: with within-candidate ranking there is a
  // rank-1 per candidate, so picking "the first row whose rank is 1" would hand Best Cash to
  // whichever candidate happened to come first.
  const carA = { id: "cand_1", distanceMiles: 10, listingSnapshot: null, inventoryItem: null };
  const carB = { id: "cand_2", distanceMiles: 10, listingSnapshot: null, inventoryItem: null };
  offers = [
    offer({ id: "a1", auctionVehicleId: "cand_1", auctionVehicle: carA, otdPriceCents: 4_000_000 }),
    offer({ id: "b1", auctionVehicleId: "cand_2", auctionVehicle: carB, otdPriceCents: 2_800_000 }),
  ];
  const ranked = await rank();
  const { selectTopOffers } = await import("../best-price.service");
  const top = selectTopOffers(ranked);
  assert.equal(top.bestCash!.offerId, "b1");
  assert.equal(top.bestMonthly, null, "no offer carries financing, so the card is genuinely absent");
});

test("Best Monthly is the lowest monthly payment, and never a cash offer", async () => {
  offers = [
    offer({ id: "cash", otdPriceCents: 2_800_000 }),
    offer({ id: "fin_hi", includesFinancing: true, aprRate: 12, termMonths: 48, otdPriceCents: 3_000_000 }),
    offer({ id: "fin_lo", includesFinancing: true, aprRate: 3, termMonths: 72, otdPriceCents: 3_050_000 }),
  ];
  const top = (await import("../best-price.service")).selectTopOffers(await rank());
  assert.equal(top.bestCash!.offerId, "cash");
  assert.equal(top.bestMonthly!.offerId, "fin_lo");
});

// ── Best Overall across candidates (review finding) ─────────────────────────────────────────────

test("on a MULTI-candidate auction, Best Overall is the deepest discount, not the best within-group score", async () => {
  // `overallScore` is a WITHIN-candidate normalised rank — a position among the offers on the same
  // car. Comparing those across candidates compares positions in different races: a candidate
  // answered by ONE dealership has no ranking to speak of, so its sole offer scored neutral while
  // the winner of a two-offer race on another candidate scored best — and the card went to the
  // second for having had a rival to beat, however much better the first deal was.
  const carA = { id: "cand_1", distanceMiles: 10, listingSnapshot: { priceCents: 3_200_000 }, inventoryItem: null };
  const carB = { id: "cand_2", distanceMiles: 10, listingSnapshot: { priceCents: 5_000_000 }, inventoryItem: null };
  offers = [
    // Two offers on car A. The better of them wins its race but concedes only 6% of the listing.
    offer({ id: "a1", auctionVehicleId: "cand_1", auctionVehicle: carA, otdPriceCents: 3_000_000 }),
    offer({ id: "a2", auctionVehicleId: "cand_1", auctionVehicle: carA, otdPriceCents: 3_150_000 }),
    // The ONLY offer on car B, conceding 20%.
    offer({ id: "b1", auctionVehicleId: "cand_2", auctionVehicle: carB, otdPriceCents: 4_000_000 }),
  ];
  const ranked = await rank();
  const { selectTopOffers } = await import("../best-price.service");
  const top = selectTopOffers(ranked);
  assert.equal(top.bestOverall!.offerId, "b1", "the sole bidder could not win the card at any depth of discount");
  assert.equal(top.bestCash!.offerId, "a1", "Best Cash is still simply the lowest out-the-door");
});

test("on a SINGLE-candidate auction the within-candidate score decides, under the PERSISTED weights", async () => {
  // Every offer is in one race, so the weighted score is the right comparison — and it is the
  // ADMINISTRATOR's weights that decide it, not a constant. Under the defaults (OTD 0.4, fees 0.2)
  // the cheaper car wins despite carrying $890 more in fees...
  const seed = () => [
    offer({ id: "s1", otdPriceCents: 3_000_000, feesCents: 90_000 }),
    offer({ id: "s2", otdPriceCents: 3_010_000, feesCents: 1_000 }),
  ];
  offers = seed();
  const { selectTopOffers } = await import("../best-price.service");
  assert.equal(selectTopOffers(await rank()).bestOverall!.offerId, "s1");

  // ...and under a config that weights fees above price, the same two offers flip. If the weights
  // were not being read, this assertion could not pass.
  offers = seed();
  weightConfig = { weightOtd: 0.1, weightMonthly: 0.1, weightFees: 0.7, weightJunkFees: 0.1 };
  assert.equal(selectTopOffers(await rank()).bestOverall!.offerId, "s2");
});

test("the monthly payment carries the term it was computed at", async () => {
  // The card used to label the payment with a term chosen in the UI while the number came from the
  // dealership's own quote, so toggling to 36mo relabelled a 72-month payment.
  offers = [offer({ id: "fin", includesFinancing: true, aprRate: 6.9, termMonths: 72 })];
  const r = await rank();
  assert.equal(r[0].monthlyTermMonths, 72);
  assert.ok(r[0].monthlyPayment! > 0);
});

test("a cash offer carries NO term, because it has no payment", async () => {
  offers = [offer({ id: "cash" })];
  const r = await rank();
  assert.equal(r[0].monthlyPayment, undefined);
  assert.equal(r[0].monthlyTermMonths, null);
});
