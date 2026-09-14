// Phase 6 — the §12.4 offer journey, end to end.
//
//   1. offer submitted → auction closes → ranked report → buyer selects → Deal lineage
//   2. the close's zero-offer branch: an Operations case and a buyer notice, no money moved
//   3. the Premium interstitial: shown once, declinable, and NEVER blocking the Deal
//
// SCOPE AND HONESTY NOTE, in the style this suite already uses.
//
// These specs assert DATABASE STATE as well as visible text, and they require infrastructure this
// repository cannot provide by itself:
//   • DATABASE_URL pointed at autolenis_e2e — NEVER production
//   • a running Next server for the browser half (playwright.e2e.config.ts baseURL)
//   • E2E_STORAGE_STATE holding an authenticated buyer/admin session for the surfaces behind auth
//
// Each spec SKIPS with an explicit reason when its prerequisites are absent rather than passing
// vacuously. A green run that checked nothing is worse than a skipped one that says so.
//
// WHAT KEEPS A REAL DEALERSHIP OFF THE WIRE. The same three things Phase 5's spec relies on, in
// the same order: no RESEND_API_KEY / TWILIO_* in this environment so the adapters refuse first;
// every fixture address is an `.invalid` domain, which cannot resolve by RFC 2606; and the
// assertion is the `comms_outbox` ROW rather than a send. Phase 6 enqueues every notice and this
// environment never runs the drain, so a queued message and a delivered one are distinguishable —
// which is the whole point of asserting on the row.
//
// WHY THE OFFERS ARE SEEDED RATHER THAN SUBMITTED THROUGH `submitOffer`, stated plainly because
// it bounds what these journeys prove.
//
// `submitOffer` calls Next's `after()` for the first-offer buyer email, and `after()` THROWS
// outside a request scope — which is exactly what an in-process spec provides. All four of its
// production callers are route handlers (`app/api/dealer/offers`, `app/api/admin/offers` twice,
// and the AI action-intent approve route), so this is a constraint on calling it here, NOT a
// production defect; it was checked before being worked around.
//
// Driving it over HTTP instead would need an authenticated DEALER session, and CI's storage state
// is admin-only. So these journeys seed offers in the shape `submitOffer` writes — candidate
// binding, rooftop, expiry through the PRODUCTION `defaultOfferExpiry`, feature match through the
// production `computeFeatureMatch` — and assert the CLOSE → RANK → REPORT → SELECT → LINEAGE half
// end to end against a real database.
//
// What that leaves uncovered here, and where it IS covered: submission validation and the §8b caps
// (`lib/services/offer/__tests__/offer-submission.test.ts`, 24 cases) and the revision statement
// order against the real partial unique index
// (`lib/services/offer/__tests__/destructive/offer-revision-index.test.ts`, which needs the index
// and therefore a real database too).
//
// NOTHING HERE TOUCHES PRODUCTION. The guard below refuses to run unless DATABASE_URL names
// autolenis_e2e, the same load-bearing check the rest of this suite applies.

import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
// STATIC imports, for the reason `phase5-sourcing-journeys.spec.ts` records at length: Playwright
// applies the `@/*` paths at build time, and a runtime `await import("@/…")` escapes that
// transform and dies on the service's own internal imports.
// `defaultOfferExpiry` is the PRODUCTION expiry policy, imported rather than restated — the whole
// point of journey 1's expiry assertion is that the window opens at the close, and a fixture that
// computed its own would assert against itself.
import { defaultOfferExpiry } from "@/lib/services/offer/offer-validity";
import { computeFeatureMatch } from "@/lib/services/offer/feature-match";
import { processAuctionClose, sweepUnselectedAuctions } from "@/lib/services/auction/auction.service";
import { rankOffers, getBestPriceReport, selectTopOffers } from "@/lib/services/offer/best-price.service";
import { commitOfferSelection } from "@/lib/services/deal/select-offer.service";

const prisma = new PrismaClient();

const HAS_DB = /autolenis_e2e/.test(process.env.DATABASE_URL ?? "");

test.beforeAll(() => {
  if (HAS_DB) return;
  // Refuse rather than silently target whatever DATABASE_URL points at.
  if (process.env.DATABASE_URL) {
    throw new Error("Refusing to run E2E: DATABASE_URL must target autolenis_e2e");
  }
});

const needsInfra = () => {
  test.skip(!HAS_DB, "DATABASE_URL does not target autolenis_e2e — seeded fixtures unavailable");
};

interface Fixture {
  stamp: string;
  userIds: string[];
  buyerId: string;
  requestId: string;
  depositId: string;
  auctionId: string;
  dealerIds: string[];
}
const created: Fixture[] = [];

test.afterEach(async () => {
  for (const f of created.splice(0)) {
    // Ordered child-first: nothing here relies on a cascade that may not exist.
    await prisma.commsOutbox.deleteMany({ where: { auctionId: f.auctionId } }).catch(() => {});
    await prisma.commsOutbox.deleteMany({ where: { vehicleRequestId: f.requestId } }).catch(() => {});
    await prisma.queueItem.deleteMany({ where: { auctionId: f.auctionId } }).catch(() => {});
    await prisma.queueItem.deleteMany({ where: { vehicleRequestId: f.requestId } }).catch(() => {});
    await prisma.bestPriceCalculationLog.deleteMany({ where: { auctionId: f.auctionId } }).catch(() => {});
    await prisma.dealStatusHistory.deleteMany({ where: { deal: { vehicleRequestId: f.requestId } } }).catch(() => {});
    await prisma.deal.deleteMany({ where: { vehicleRequestId: f.requestId } }).catch(() => {});
    await prisma.offer.deleteMany({ where: { auctionId: f.auctionId } }).catch(() => {});
    await prisma.auctionVehicle.deleteMany({ where: { auctionId: f.auctionId } }).catch(() => {});
    await prisma.auctionInvitation.deleteMany({ where: { auctionId: f.auctionId } }).catch(() => {});
    await prisma.auction.deleteMany({ where: { id: f.auctionId } }).catch(() => {});
    await prisma.buyerActivityEvent.deleteMany({ where: { buyerId: f.buyerId } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { buyerId: f.buyerId } }).catch(() => {});
    await prisma.deposit.deleteMany({ where: { id: f.depositId } }).catch(() => {});
    await prisma.vehicleRequestEvent.deleteMany({ where: { requestId: f.requestId } }).catch(() => {});
    await prisma.preQualification.deleteMany({ where: { buyerId: f.buyerId } }).catch(() => {});
    await prisma.vehicleRequest.deleteMany({ where: { id: f.requestId } }).catch(() => {});
    await prisma.dealer.deleteMany({ where: { id: { in: f.dealerIds } } }).catch(() => {});
    await prisma.buyer.deleteMany({ where: { id: f.buyerId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: f.userIds } } }).catch(() => {});
  }
});

/**
 * A paid buyer with a live approval, an ACTIVE auction, and N invited dealerships.
 *
 * The approval is deliberately GENEROUS and its ceiling is asserted rather than assumed: §8b
 * disqualifies an over-ceiling offer rather than rejecting it, so a mean fixture would produce a
 * report full of disqualified offers and every assertion below would pass for the wrong reason.
 */
async function seed(opts: { dealers: number; candidates?: number }): Promise<Fixture> {
  const stamp = `p6-${randomUUID().slice(0, 8)}`;
  const buyerUser = await prisma.user.create({
    data: { supabaseId: `${stamp}-buyer`, email: `${stamp}-buyer@autolenis.invalid`, role: "BUYER" },
  });
  const buyer = await prisma.buyer.create({
    data: { userId: buyerUser.id, firstName: "Journey", lastName: "Buyer", zip: "78701" },
  });
  await prisma.preQualification.create({
    data: {
      buyerId: buyer.id,
      decision: "APPROVED",
      maxOtdAmountCents: 6_000_000,
      expiresAt: new Date(Date.now() + 30 * 24 * 3_600_000),
    },
  });
  const request = await prisma.vehicleRequest.create({
    data: { buyerId: buyer.id, status: "ACTIVE_SOURCING", requiredFeatures: ["Heated Seats"] },
  });
  const deposit = await prisma.deposit.create({
    data: { buyerId: buyer.id, vehicleRequestId: request.id, amountCents: 9900, status: "PAID" },
  });
  const auction = await prisma.auction.create({
    data: {
      buyerId: buyer.id,
      depositId: deposit.id,
      vehicleRequestId: request.id,
      status: "ACTIVE",
      startedAt: new Date(Date.now() - 3_600_000),
      endsAt: new Date(Date.now() + 3_600_000),
    },
  });

  for (let i = 0; i < (opts.candidates ?? 1); i++) {
    await prisma.auctionVehicle.create({
      data: {
        auctionId: auction.id,
        year: 2023,
        make: "Honda",
        model: i === 0 ? "Accord" : "CR-V",
        candidateStatus: "ACTIVE",
        distanceMiles: 10 + i * 5,
      },
    });
  }

  const dealerIds: string[] = [];
  const userIds = [buyerUser.id];
  for (let i = 0; i < opts.dealers; i++) {
    const du = await prisma.user.create({
      data: { supabaseId: `${stamp}-d${i}`, email: `${stamp}-d${i}@autolenis.invalid`, role: "DEALER" },
    });
    const d = await prisma.dealer.create({ data: { userId: du.id, dealershipName: `Journey Motors ${i}` } });
    await prisma.auctionInvitation.create({ data: { auctionId: auction.id, dealerId: d.id } });
    dealerIds.push(d.id);
    userIds.push(du.id);
  }

  const f: Fixture = {
    stamp,
    userIds,
    buyerId: buyer.id,
    requestId: request.id,
    depositId: deposit.id,
    auctionId: auction.id,
    dealerIds,
  };
  created.push(f);
  return f;
}

/**
 * One offer, written exactly as `submitOffer` writes it.
 *
 * The fields that matter downstream are the ones Phase 6 added and earlier phases left NULL —
 * `auction_vehicle_id`, `rooftop_id`, `expires_at`, the vehicle snapshot and the feature match.
 * A fixture that omitted them would exercise the pre-Phase-6 shape and every assertion about
 * ranking, the per-candidate rule and the reminder would pass for the wrong reason.
 */
async function seedOffer(opts: {
  auctionId: string;
  dealerId: string;
  auctionVehicleId: string | null;
  otdPriceCents: number;
  closesAt: Date;
  requiredFeatures?: string[];
  offeredFeatures?: string[];
  expiresAt?: Date;
}) {
  const match = computeFeatureMatch(opts.requiredFeatures, opts.offeredFeatures);
  return prisma.offer.create({
    data: {
      auctionId: opts.auctionId,
      dealerId: opts.dealerId,
      auctionVehicleId: opts.auctionVehicleId,
      status: "SUBMITTED",
      version: 1,
      otdPriceCents: opts.otdPriceCents,
      vehiclePriceCents: opts.otdPriceCents - 200_000,
      taxCents: 150_000,
      feesCents: 50_000,
      junkFeeItems: [],
      submittedAt: new Date(),
      expiresAt: opts.expiresAt ?? defaultOfferExpiry(opts.closesAt),
      vehicleYear: 2023,
      vehicleMake: "Honda",
      vehicleModel: "Accord",
      requiredFeatureMatches: match.matches ?? undefined,
      requiredFeatureMismatches: match.mismatches ?? undefined,
    },
  });
}

async function candidateId(auctionId: string, index = 0): Promise<string> {
  const rows = await prisma.auctionVehicle.findMany({ where: { auctionId }, orderBy: { createdAt: "asc" } });
  return rows[index].id;
}

// ── JOURNEY 1 — submit → close → report → select → Deal lineage ─────────────────────────────────

test("journey 1: dealers submit, the auction closes, the buyer selects, and the Deal carries full lineage", async () => {
  needsInfra();
  const f = await seed({ dealers: 3 });
  const cand = await candidateId(f.auctionId);

  // Three dealerships bid on the one candidate, in the shape `submitOffer` writes (see the note
  // at the top of this file for why they are seeded rather than submitted in-process).
  const closesAt = new Date(Date.now() + 3_600_000);
  const prices = [3_000_000, 2_900_000, 3_100_000];
  for (let i = 0; i < f.dealerIds.length; i++) {
    await seedOffer({
      auctionId: f.auctionId,
      dealerId: f.dealerIds[i],
      auctionVehicleId: cand,
      otdPriceCents: prices[i],
      closesAt,
      requiredFeatures: ["Heated Seats"],
      offeredFeatures: ["Heated Seats", "Apple CarPlay"],
    });
  }

  const submitted = await prisma.offer.findMany({ where: { auctionId: f.auctionId, status: "SUBMITTED" } });
  expect(submitted).toHaveLength(3);
  // §8a/A16b — the expiry is a POLICY WINDOW opening at the close, never the close itself. If it
  // were the close, every assertion after this point would be about an expired offer.
  for (const o of submitted) {
    expect(o.expiresAt).not.toBeNull();
    expect(o.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(o.auctionVehicleId).toBe(cand);
    expect(o.isDisqualified).toBe(false);
  }

  // ── close ────────────────────────────────────────────────────────────────────────────────────
  await prisma.auction.update({
    where: { id: f.auctionId },
    data: { status: "CLOSED", closedAt: new Date(), endsAt: new Date(Date.now() - 1000) },
  });
  const closed = await processAuctionClose(f.auctionId);
  expect(closed.offers).toBe(3);

  // §8c exit (C12) — the request advances, with a timeline event.
  const request = await prisma.vehicleRequest.findUniqueOrThrow({ where: { id: f.requestId } });
  expect(request.status).toBe("OFFER_READY");
  const events = await prisma.vehicleRequestEvent.findMany({ where: { requestId: f.requestId, eventType: "OFFER_READY" } });
  expect(events).toHaveLength(1);

  // §27.1 K27-1326 — the offers-ready notice is ENQUEUED, not sent. The row is the assertion.
  const ready = await prisma.commsOutbox.findMany({ where: { auctionId: f.auctionId, templateKey: "offers_ready" } });
  expect(ready).toHaveLength(1);
  expect(ready[0].status).toBe("pending");

  // §9 / S14 — the pre-expiry reminder, scheduled and cancellable.
  const reminder = await prisma.commsOutbox.findMany({
    where: { auctionId: f.auctionId, templateKey: "selection_reminder" },
  });
  expect(reminder).toHaveLength(1);
  expect(reminder[0].cancelKey).toBe(`selection-reminder:${f.auctionId}`);

  // §8c C8 — ONE persisted ranking, both halves written together.
  const logs = await prisma.bestPriceCalculationLog.findMany({ where: { auctionId: f.auctionId } });
  expect(logs).toHaveLength(1);
  const rankedRows = await prisma.offer.findMany({ where: { auctionId: f.auctionId, rankCash: { not: null } } });
  expect(rankedRows).toHaveLength(3);

  // ── the ranked report ────────────────────────────────────────────────────────────────────────
  const report = await getBestPriceReport(f.auctionId, 60);
  expect(report.source).toBe("persisted");
  expect(report.ranked).toHaveLength(3);
  const top = selectTopOffers(report.ranked);
  // §8c's first key: lowest out-the-door.
  expect(top.bestCash!.otdPriceCents).toBe(2_900_000);

  // ── selection ────────────────────────────────────────────────────────────────────────────────
  const winner = top.bestCash!.offerId;
  const { dealId } = await commitOfferSelection({ buyerId: f.buyerId, auctionId: f.auctionId, offerId: winner });

  // §9a — the Deal at DEALER_CONFIRMATION with full lineage.
  const deal = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });
  expect(deal.status).toBe("DEALER_CONFIRMATION");
  expect(deal.offerId).toBe(winner);
  expect(deal.buyerId).toBe(f.buyerId);
  expect(deal.vehicleRequestId).toBe(f.requestId);
  expect(deal.auctionId).toBe(f.auctionId);
  expect(deal.depositId).toBe(f.depositId);

  // Losers DECLINED, candidates CLOSED, and the reminder cancelled — all in the same transaction.
  const losers = await prisma.offer.findMany({ where: { auctionId: f.auctionId, status: "DECLINED" } });
  expect(losers).toHaveLength(2);
  const cancelled = await prisma.commsOutbox.findFirst({
    where: { auctionId: f.auctionId, templateKey: "selection_reminder" },
  });
  expect(cancelled!.status).toBe("cancelled");

  // EXACTLY ONE Deal. The concurrency proof lives in the destructive suite; this asserts the
  // ordinary path does not somehow produce two.
  const allDeals = await prisma.deal.findMany({ where: { vehicleRequestId: f.requestId } });
  expect(allDeals).toHaveLength(1);
});

// ── JOURNEY 2 — the zero-offer branch ───────────────────────────────────────────────────────────

test("journey 2: a close with no offers opens an owned case, tells the buyer, and moves no money", async () => {
  needsInfra();
  const f = await seed({ dealers: 2 });

  await prisma.auction.update({
    where: { id: f.auctionId },
    data: { status: "CLOSED", closedAt: new Date(), endsAt: new Date(Date.now() - 1000) },
  });
  const closed = await processAuctionClose(f.auctionId);
  expect(closed.offers).toBe(0);

  // §26 — an OWNED case, not just a notification.
  const cases = await prisma.queueItem.findMany({
    where: { auctionId: f.auctionId, exceptionCode: "ZERO_OFFERS_ALL_CANDIDATES" },
  });
  expect(cases).toHaveLength(1);
  expect(cases[0].ownerRole).toBe("OPERATIONS");
  expect(cases[0].deadlineAt).not.toBeNull();
  expect(cases[0].returnPoint).toBeTruthy();

  // §27.1 K27-1327 — the buyer notice, enqueued.
  const notice = await prisma.commsOutbox.findMany({
    where: { auctionId: f.auctionId, templateKey: "auction_zero_offers" },
  });
  expect(notice).toHaveLength(1);

  // §23.1 / T19 — NO AUTO-REFUND. The deposit is untouched.
  const deposit = await prisma.deposit.findUniqueOrThrow({ where: { id: f.depositId } });
  expect(deposit.status).toBe("PAID");
  expect(deposit.refundedAt).toBeNull();

  // §22a / N1 — every candidate closed, because nothing was answered.
  const candidates = await prisma.auctionVehicle.findMany({ where: { auctionId: f.auctionId } });
  expect(candidates.every((c) => c.candidateStatus === "CLOSED")).toBe(true);

  // The request does NOT advance — only the success branch writes OFFER_READY.
  const request = await prisma.vehicleRequest.findUniqueOrThrow({ where: { id: f.requestId } });
  expect(request.status).toBe("ACTIVE_SOURCING");

  // Re-running the close is a no-op: the claim is already stamped.
  await processAuctionClose(f.auctionId);
  const casesAgain = await prisma.queueItem.findMany({ where: { auctionId: f.auctionId } });
  expect(casesAgain).toHaveLength(1);
});

// ── JOURNEY 3 — §22a / N1's per-candidate rule, and the unselected sweep ────────────────────────

test("journey 3: offers on one candidate and none on another is a SUCCESS", async () => {
  needsInfra();
  const f = await seed({ dealers: 1, candidates: 2 });
  const answered = await candidateId(f.auctionId, 0);
  const unanswered = await candidateId(f.auctionId, 1);

  await seedOffer({
    auctionId: f.auctionId,
    dealerId: f.dealerIds[0],
    auctionVehicleId: answered,
    otdPriceCents: 3_000_000,
    closesAt: new Date(Date.now() + 3_600_000),
  });

  await prisma.auction.update({
    where: { id: f.auctionId },
    data: { status: "CLOSED", closedAt: new Date(), endsAt: new Date(Date.now() - 1000) },
  });
  const closed = await processAuctionClose(f.auctionId);

  expect(closed.offers).toBe(1);
  // NOT a zero-offer auction.
  const cases = await prisma.queueItem.findMany({ where: { auctionId: f.auctionId } });
  expect(cases).toHaveLength(0);

  const rows = await prisma.auctionVehicle.findMany({ where: { auctionId: f.auctionId } });
  expect(rows.find((c) => c.id === answered)!.candidateStatus).toBe("ACTIVE");
  expect(rows.find((c) => c.id === unanswered)!.candidateStatus).toBe("CLOSED");
});

test("journey 4: every offer lapsing without a selection opens a case and tells the buyer (S15/S16)", async () => {
  needsInfra();
  const f = await seed({ dealers: 1 });
  const cand = await candidateId(f.auctionId);

  await seedOffer({
    auctionId: f.auctionId,
    dealerId: f.dealerIds[0],
    auctionVehicleId: cand,
    otdPriceCents: 3_000_000,
    closesAt: new Date(Date.now() + 3_600_000),
    // A short, dealer-stated expiry, so the sweep has something to find without waiting 72 hours.
    expiresAt: new Date(Date.now() + 2_000),
  });

  await prisma.auction.update({
    where: { id: f.auctionId },
    data: { status: "CLOSED", closedAt: new Date(), endsAt: new Date(Date.now() - 1000) },
  });
  await processAuctionClose(f.auctionId);

  // Lapse it, then sweep.
  await prisma.offer.updateMany({
    where: { auctionId: f.auctionId },
    data: { status: "EXPIRED", expiresAt: new Date(Date.now() - 1000) },
  });
  const swept = await sweepUnselectedAuctions();
  expect(swept).toBeGreaterThanOrEqual(1);

  const cases = await prisma.queueItem.findMany({
    where: { auctionId: f.auctionId, exceptionCode: "BUYER_DOES_NOT_SELECT" },
  });
  expect(cases).toHaveLength(1);

  const notice = await prisma.commsOutbox.findMany({
    where: { auctionId: f.auctionId, templateKey: "offers_expired_unselected" },
  });
  expect(notice).toHaveLength(1);

  // S16 — still no refund.
  const deposit = await prisma.deposit.findUniqueOrThrow({ where: { id: f.depositId } });
  expect(deposit.status).toBe("PAID");
  expect(deposit.refundedAt).toBeNull();
});

// ── JOURNEY 5 — the ranking is deterministic and reproducible ───────────────────────────────────

test("journey 5: two identical offers SHARE a rank and the order is reproducible", async () => {
  needsInfra();
  const f = await seed({ dealers: 2 });
  const cand = await candidateId(f.auctionId);

  for (const dealerId of f.dealerIds) {
    await seedOffer({
      auctionId: f.auctionId,
      dealerId,
      auctionVehicleId: cand,
      otdPriceCents: 3_000_000,
      closesAt: new Date(Date.now() + 3_600_000),
    });
  }

  const first = await rankOffers(f.auctionId, 60);
  const second = await rankOffers(f.auctionId, 60);

  // §8c: "equal-value results are presented honestly as equal."
  expect(first.map((r) => r.rankCash)).toEqual([1, 1]);
  expect(first[0].tiedWith).toHaveLength(1);

  // ...and deterministic: the same set produces the same list, which the old `findIndex` over a
  // database-ordered array did not guarantee.
  expect(second.map((r) => r.offerId)).toEqual(first.map((r) => r.offerId));
});
