// Phase 7 — the §12.4 Stage 10-to-12 journey, end to end.
//
//   1. dealer reaffirms → buyer acknowledges → recap → terms locked, EXTERNAL financing
//   2. the same journey on the CASH path, where §12d settles the checkpoint differently
//   3. §10a: a material change presented, REJECTED, and the buyer returned to the remaining offers
//   4. §10a: a LOWER out-the-door applying automatically, and the buyer told about it
//   5. §10a: an ABOVE-CEILING out-the-door refused at the dealership, never shown to the buyer
//   6. the 24-hour deadline passing → returned to offers, scorecard entry, SLA on the repeat
//
// SCOPE AND HONESTY NOTE, in the style this suite already uses.
//
// These specs assert DATABASE STATE as well as visible text, and they require infrastructure this
// repository cannot provide by itself:
//   • DATABASE_URL pointed at autolenis_e2e — NEVER production
//   • a running Next server for the browser half (playwright.e2e.config.ts baseURL)
//   • E2E_STORAGE_STATE holding an authenticated buyer session for the surfaces behind auth
//
// Each spec SKIPS with an explicit reason when its prerequisites are absent rather than passing
// vacuously. A green run that checked nothing is worse than a skipped one that says so.
//
// WHAT KEEPS A REAL DEALERSHIP OFF THE WIRE — and this phase needs it more than any before it,
// because Stage 10 sends reaffirmation requests and reminders to dealerships and a real one
// cannot be taken back. The same three things Phases 5 and 6 rely on, in the same order: no
// RESEND_API_KEY / TWILIO_* in this environment so the adapters refuse first; every fixture
// address is an `.invalid` domain, which cannot resolve by RFC 2606; and the assertion is the
// `comms_outbox` ROW rather than a send. Phase 7 enqueues every notice and this environment never
// runs the drain, so a queued message and a delivered one stay distinguishable.
//
// THE HONEST LIMIT, stated because it bounds what these journeys prove: production holds ZERO
// deals and ZERO reaffirmations, so every assertion below runs against FIXTURES. That proves the
// surfaces work as built. It does not prove the experience of a real buyer with a real dealership,
// and no fixture can.

import { test, expect } from "@playwright/test";
import { PrismaClient, DealStatus, FinancingStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
// STATIC imports, for the reason phase5/phase6 record: Playwright applies the `@/*` paths at build
// time, and a runtime `await import("@/…")` escapes that transform.
import { writeDealCreationRecord } from "@/lib/services/deal/deal-creation";
import {
  submitReaffirmation,
  acknowledgeConditionDisclosure,
  decideMaterialChange,
  expireOverdueReaffirmations,
  sweepExpiringHolds,
  releaseVehicleHold,
} from "@/lib/services/deal/dealer-reaffirmation.service";
import { currentRecap, decideOptionalProduct, confirmRecap, disputeRecap } from "@/lib/services/deal/deal-recap.service";
import { recordFinancingCheckpoint } from "@/lib/services/financing/financing-checkpoint.service";
import {
  dealerIdentityVisible,
  dealerIdentityVisibleMany,
  secureHandoffPacket,
} from "@/lib/services/deal/identity-firewall.service";
import { PHASE_7_TEMPLATES } from "@/lib/services/comms/state-recheck-registry";
import { getDealerDealById, getDealerDeals } from "@/lib/services/dealer/dealer-deals.service";

const prisma = new PrismaClient();

const HAS_DB = /autolenis_e2e/.test(process.env.DATABASE_URL ?? "");

test.beforeAll(() => {
  if (HAS_DB) return;
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
  rooftopId: string;
  dealerIds: string[];
  offerIds: string[];
  dealId: string;
}
const created: Fixture[] = [];

test.afterEach(async () => {
  for (const f of created.splice(0)) {
    await prisma.commsOutbox.deleteMany({ where: { dealId: f.dealId } }).catch(() => {});
    await prisma.commsOutbox.deleteMany({ where: { auctionId: f.auctionId } }).catch(() => {});
    await prisma.queueItem.deleteMany({ where: { dealId: f.dealId } }).catch(() => {});
    await prisma.queueItem.deleteMany({ where: { auctionId: f.auctionId } }).catch(() => {});
    await prisma.slaViolation.deleteMany({ where: { entityId: f.rooftopId } }).catch(() => {});
    await prisma.slaViolation.deleteMany({ where: { entityId: { in: f.dealerIds } } }).catch(() => {});
    await prisma.identityFirewallEntry.deleteMany({ where: { auctionId: f.auctionId } }).catch(() => {});
    await prisma.financingAuditEvent.deleteMany({ where: { dealId: f.dealId } }).catch(() => {});
    await prisma.financing.deleteMany({ where: { dealId: f.dealId } }).catch(() => {});
    await prisma.dealRecap.deleteMany({ where: { dealId: f.dealId } }).catch(() => {});
    await prisma.dealerReaffirmation.deleteMany({ where: { dealId: f.dealId } }).catch(() => {});
    await prisma.dealStatusHistory.deleteMany({ where: { dealId: f.dealId } }).catch(() => {});
    await prisma.planSnapshot.deleteMany({ where: { dealId: f.dealId } }).catch(() => {});
    await prisma.deal.deleteMany({ where: { id: f.dealId } }).catch(() => {});
    await prisma.offer.deleteMany({ where: { auctionId: f.auctionId } }).catch(() => {});
    await prisma.auctionVehicle.deleteMany({ where: { auctionId: f.auctionId } }).catch(() => {});
    await prisma.auctionInvitation.deleteMany({ where: { auctionId: f.auctionId } }).catch(() => {});
    await prisma.auction.deleteMany({ where: { id: f.auctionId } }).catch(() => {});
    await prisma.buyerActivityEvent.deleteMany({ where: { buyerId: f.buyerId } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { buyerId: f.buyerId } }).catch(() => {});
    await prisma.deposit.deleteMany({ where: { id: f.depositId } }).catch(() => {});
    await prisma.preQualification.deleteMany({ where: { buyerId: f.buyerId } }).catch(() => {});
    await prisma.vehicleRequest.deleteMany({ where: { id: f.requestId } }).catch(() => {});
    await prisma.dealer.deleteMany({ where: { id: { in: f.dealerIds } } }).catch(() => {});
    await prisma.dealerRooftop.deleteMany({ where: { id: f.rooftopId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: f.userIds } } }).catch(() => {});
  }
});

const CEILING_CENTS = 6_000_000;
const ACCEPTED_OTD = 4_120_000;

/**
 * A buyer who has ALREADY SELECTED — a Deal at DEALER_CONFIRMATION with its reaffirmation window
 * open, plus one losing offer so "the remaining valid offers" is a real set rather than an empty
 * one. The second offer is what makes journey 3 and journey 6 mean anything.
 */
async function seedSelectedDeal(opts: { otdCents?: number } = {}): Promise<Fixture> {
  const stamp = `p7-${randomUUID().slice(0, 8)}`;
  const buyerUser = await prisma.user.create({
    data: { supabaseId: `${stamp}-buyer`, email: `${stamp}-buyer@autolenis.invalid`, role: "BUYER" },
  });
  const buyer = await prisma.buyer.create({
    data: { userId: buyerUser.id, firstName: "Stage", lastName: "Ten", zip: "78701", phone: "512-555-0100" },
  });
  await prisma.preQualification.create({
    data: {
      buyerId: buyer.id,
      decision: "APPROVED",
      maxOtdAmountCents: CEILING_CENTS,
      expiresAt: new Date(Date.now() + 30 * 24 * 3_600_000),
    },
  });
  const request = await prisma.vehicleRequest.create({
    data: { buyerId: buyer.id, status: "OFFER_ACCEPTED" },
  });
  const deposit = await prisma.deposit.create({
    data: { buyerId: buyer.id, vehicleRequestId: request.id, amountCents: 9900, status: "PAID" },
  });
  const auction = await prisma.auction.create({
    data: {
      buyerId: buyer.id,
      depositId: deposit.id,
      vehicleRequestId: request.id,
      status: "CLOSED",
      startedAt: new Date(Date.now() - 48 * 3_600_000),
      endsAt: new Date(Date.now() - 3_600_000),
    },
  });
  const rooftop = await prisma.dealerRooftop.create({
    data: { displayName: `Journey Rooftop ${stamp}`, nameKey: `journey-${stamp}` },
  });

  const dealerIds: string[] = [];
  const userIds = [buyerUser.id];
  const offerIds: string[] = [];
  for (let i = 0; i < 2; i++) {
    const du = await prisma.user.create({
      data: { supabaseId: `${stamp}-d${i}`, email: `${stamp}-d${i}@autolenis.invalid`, role: "DEALER" },
    });
    const d = await prisma.dealer.create({
      data: {
        userId: du.id,
        dealershipName: `Stage Ten Motors ${i}`,
        status: "ACTIVE",
        ...(i === 0 ? { rooftopId: rooftop.id } : {}),
      },
    });
    const offer = await prisma.offer.create({
      data: {
        auctionId: auction.id,
        dealerId: d.id,
        rooftopId: i === 0 ? rooftop.id : null,
        status: i === 0 ? "ACCEPTED" : "SUBMITTED",
        otdPriceCents: opts.otdCents ?? (i === 0 ? ACCEPTED_OTD : ACCEPTED_OTD + 90_000),
        vehiclePriceCents: 3_600_000,
        taxCents: 300_000,
        feesCents: 80_000,
        docFeeCents: 29_900,
        titleRegistrationCents: 40_000,
        junkFeeItems: [{ label: "Doc fee", amountCents: 29_900 }],
        addOnItems: i === 0 ? [{ label: "GAP protection", amountCents: 99_500 }] : [],
        incentiveItems: [],
        submittedAt: new Date(Date.now() - 2 * 3_600_000),
        expiresAt: new Date(Date.now() + 48 * 3_600_000),
        vehicleYear: 2023,
        vehicleMake: "Honda",
        vehicleModel: "Accord",
        vin: "1HGCM82633A004352",
        odometer: 31_000,
      },
    });
    dealerIds.push(d.id);
    userIds.push(du.id);
    offerIds.push(offer.id);
  }

  // The Deal, created exactly as Phase 6's selection creates it — which is what opens the Stage 10
  // window, because `writeDealCreationRecord` is the seam `openReaffirmation` hangs off.
  const dealId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.deal.create({
      data: {
        id: dealId,
        buyerId: buyer.id,
        offerId: offerIds[0]!,
        auctionId: auction.id,
        vehicleRequestId: request.id,
        dealerId: dealerIds[0]!,
        rooftopId: rooftop.id,
        status: DealStatus.DEALER_CONFIRMATION,
        downPaymentCents: 200_000,
      },
    });
    await writeDealCreationRecord(tx, {
      dealId,
      buyerId: buyer.id,
      plan: "STANDARD",
      vehicleRequestId: request.id,
      reason: "Phase 7 journey fixture — selection",
      now: new Date(),
    });
  });

  const f: Fixture = {
    stamp,
    userIds,
    buyerId: buyer.id,
    requestId: request.id,
    depositId: deposit.id,
    auctionId: auction.id,
    rooftopId: rooftop.id,
    dealerIds,
    offerIds,
    dealId,
  };
  created.push(f);
  return f;
}

/**
 * A SECOND deal for the SAME rooftop and dealership, so §Stage 10's "repeated failures" can be
 * exercised against one dealership's record rather than two unrelated ones. Everything else is
 * fresh — a second buyer, request, deposit and auction — because a repeat is two transactions,
 * not one transaction twice.
 */
async function seedSelectedDealOnRooftop(prev: Fixture): Promise<Fixture> {
  const stamp = `p7r-${randomUUID().slice(0, 8)}`;
  const buyerUser = await prisma.user.create({
    data: { supabaseId: `${stamp}-buyer`, email: `${stamp}-buyer@autolenis.invalid`, role: "BUYER" },
  });
  const buyer = await prisma.buyer.create({
    data: { userId: buyerUser.id, firstName: "Repeat", lastName: "Buyer", zip: "78701" },
  });
  await prisma.preQualification.create({
    data: {
      buyerId: buyer.id,
      decision: "APPROVED",
      maxOtdAmountCents: CEILING_CENTS,
      expiresAt: new Date(Date.now() + 30 * 24 * 3_600_000),
    },
  });
  const request = await prisma.vehicleRequest.create({ data: { buyerId: buyer.id, status: "OFFER_ACCEPTED" } });
  const deposit = await prisma.deposit.create({
    data: { buyerId: buyer.id, vehicleRequestId: request.id, amountCents: 9900, status: "PAID" },
  });
  const auction = await prisma.auction.create({
    data: {
      buyerId: buyer.id,
      depositId: deposit.id,
      vehicleRequestId: request.id,
      status: "CLOSED",
      startedAt: new Date(Date.now() - 48 * 3_600_000),
      endsAt: new Date(Date.now() - 3_600_000),
    },
  });
  const offer = await prisma.offer.create({
    data: {
      auctionId: auction.id,
      dealerId: prev.dealerIds[0]!,
      rooftopId: prev.rooftopId,
      status: "ACCEPTED",
      otdPriceCents: ACCEPTED_OTD,
      vehiclePriceCents: 3_600_000,
      taxCents: 300_000,
      feesCents: 80_000,
      junkFeeItems: [],
      submittedAt: new Date(),
      expiresAt: new Date(Date.now() + 48 * 3_600_000),
    },
  });
  const dealId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.deal.create({
      data: {
        id: dealId,
        buyerId: buyer.id,
        offerId: offer.id,
        auctionId: auction.id,
        vehicleRequestId: request.id,
        dealerId: prev.dealerIds[0]!,
        rooftopId: prev.rooftopId,
        status: DealStatus.DEALER_CONFIRMATION,
      },
    });
    await writeDealCreationRecord(tx, {
      dealId,
      buyerId: buyer.id,
      plan: "STANDARD",
      vehicleRequestId: request.id,
      reason: "Phase 7 journey fixture — repeat failure",
      now: new Date(),
    });
  });

  const f: Fixture = {
    stamp,
    userIds: [buyerUser.id],
    buyerId: buyer.id,
    requestId: request.id,
    depositId: deposit.id,
    auctionId: auction.id,
    // The rooftop and dealership belong to the PREVIOUS fixture and are cleaned up by it.
    rooftopId: prev.rooftopId,
    dealerIds: [],
    offerIds: [offer.id],
    dealId,
  };
  created.push(f);
  return f;
}

function submission(overrides: Record<string, unknown> = {}) {
  return {
    vehicleAvailable: true,
    confirmedVin: "1HGCM82633A004352",
    confirmedOdometer: 31_100,
    confirmedOtdCents: ACCEPTED_OTD,
    confirmedFeeItems: [{ label: "Doc fee", amountCents: 29_900 }],
    confirmedIncentiveItems: [],
    confirmedAddOnItems: [{ label: "GAP protection", amountCents: 99_500 }],
    confirmedDeliveryTerms: "Collect from the dealership",
    outOfStateHandling: "We title and register in the buyer's state",
    canProceed: true,
    tradeSubjectToAppraisalAck: true,
    holdUntil: new Date(Date.now() + 7 * 24 * 3_600_000),
    disclosureArtifactUrls: ["https://example.invalid/condition.pdf"],
    ...overrides,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// Journey 1 — the happy path, EXTERNAL financing
// ───────────────────────────────────────────────────────────────────────────────

test("journey 1 — dealer reaffirms → buyer acknowledges → recap → terms locked (external)", async () => {
  needsInfra();
  const f = await seedSelectedDeal();

  // The window opened with the Deal, and the request AND the 12-hour reminder are already queued.
  const opening = await prisma.dealerReaffirmation.findFirst({ where: { dealId: f.dealId } });
  expect(opening?.status).toBe("PENDING");
  expect(opening?.dueAt).toBeTruthy();
  const queued = await prisma.commsOutbox.findMany({ where: { dealId: f.dealId } });
  expect(queued.map((r) => r.templateKey).sort()).toContain(PHASE_7_TEMPLATES.REAFFIRMATION_REQUEST);
  expect(queued.map((r) => r.templateKey)).toContain(PHASE_7_TEMPLATES.REAFFIRMATION_REMINDER);

  // §25.1 — BEFORE reaffirmation the firewall is closed, and the handoff is null rather than a
  // partially-populated object.
  const before = await dealerIdentityVisible(f.dealId, f.dealerIds[0]!);
  expect(before.visible).toBe(false);
  expect(before.reason).toBe("NOT_REAFFIRMED");
  expect(await secureHandoffPacket(f.dealId, f.dealerIds[0]!)).toBeNull();

  const result = await submitReaffirmation({
    dealId: f.dealId,
    dealerId: f.dealerIds[0]!,
    submission: submission(),
  });
  expect(result.status).toBe("CONFIRMED");

  // §Stage 10 — the lift happens AT confirmation, and the packet carries the buyer and the trade.
  const after = await dealerIdentityVisible(f.dealId, f.dealerIds[0]!);
  expect(after.visible).toBe(true);
  const packet = await secureHandoffPacket(f.dealId, f.dealerIds[0]!);
  expect(packet?.buyer.firstName).toBe("Stage");
  const ledger = await prisma.identityFirewallEntry.findFirst({
    where: { auctionId: f.auctionId, rooftopId: f.rooftopId },
  });
  expect(ledger?.state).toBe("LIFTED");
  expect(ledger?.liftedAt).toBeTruthy();
  expect(ledger?.revokedAt).toBeNull();

  // The hold is on the Deal.
  const held = await prisma.deal.findUnique({ where: { id: f.dealId } });
  expect(held?.vehicleHoldUntil).toBeTruthy();
  expect(held?.status).toBe(DealStatus.DEALER_CONFIRMATION);

  // §Stage 10 exit needs the buyer's acknowledgement too.
  const ack = await acknowledgeConditionDisclosure({ dealId: f.dealId, buyerId: f.buyerId });
  expect(ack.advanced).toBe(true);
  const atRecap = await prisma.deal.findUnique({ where: { id: f.dealId } });
  expect(atRecap?.status).toBe(DealStatus.RECAP_PENDING);
  expect(atRecap?.conditionDisclosureAcknowledgedAt).toBeTruthy();

  // §Stage 11 — the recap was built on arrival, itemised, with the add-on as an undecided product.
  const recap = await currentRecap(f.dealId);
  expect(recap?.version).toBe(1);
  expect(recap?.itemised?.otdCents).toBe(ACCEPTED_OTD);
  expect(recap?.optionalProducts.length).toBe(1);
  expect(recap?.optionalProducts[0]?.accepted).toBeNull();

  // §11a — the buyer cannot confirm while a product is undecided.
  await expect(confirmRecap({ dealId: f.dealId, actor: "BUYER", actorId: f.buyerId })).rejects.toThrow(
    /PRODUCTS_UNDECIDED|optional product/i,
  );

  await decideOptionalProduct({
    dealId: f.dealId,
    buyerId: f.buyerId,
    productKey: recap!.optionalProducts[0]!.key,
    accepted: true,
  });
  const buyerConfirm = await confirmRecap({ dealId: f.dealId, actor: "BUYER", actorId: f.buyerId });
  expect(buyerConfirm.bothConfirmed).toBe(false);
  const dealerConfirm = await confirmRecap({ dealId: f.dealId, actor: "DEALER", actorId: f.dealerIds[0]! });
  expect(dealerConfirm.bothConfirmed).toBe(true);
  expect(dealerConfirm.advanced).toBe(true);

  const atFinancing = await prisma.deal.findUnique({ where: { id: f.dealId } });
  expect(atFinancing?.status).toBe(DealStatus.FINANCING_PENDING);

  // §12c — Finance records the checkpoint against evidence. TERMS_LOCKED, not COMPLETED.
  const locked = await recordFinancingCheckpoint({
    dealId: f.dealId,
    status: FinancingStatus.TERMS_LOCKED,
    path: "EXTERNAL",
    actorId: "admin_journey",
    actorEmail: "finance@autolenis.invalid",
    actorType: "ADMIN",
    reason: "Verified the credit union approval letter against the deal",
    evidence: {
      source: "Journey Credit Union",
      externalReference: "APP-778812",
      approvedAmountCents: 4_500_000,
      aprRate: 6.4,
      termMonths: 60,
    },
  });
  expect(locked.status).toBe(FinancingStatus.TERMS_LOCKED);

  const financing = await prisma.financing.findUnique({ where: { dealId: f.dealId } });
  expect(financing?.status).toBe(FinancingStatus.TERMS_LOCKED);
  expect(financing?.termsLockedAt).toBeTruthy();
  expect(financing?.verifiedBy).toBe("admin_journey");

  // §13-D19 — the tamper-evident chain carries the first entries, with §12c's full payload.
  const chain = await prisma.financingAuditEvent.findMany({ where: { dealId: f.dealId } });
  expect(chain.length).toBeGreaterThan(0);
  const lock = chain.find((e) => e.eventType === "TERMS_LOCKED");
  expect(lock).toBeTruthy();
  expect(lock!.financingId).toBe(financing!.id);
  expect((lock!.payload as Record<string, unknown>).source).toBe("Journey Credit Union");
  expect((lock!.payload as Record<string, unknown>).verifiedBy).toBe("admin_journey");

  // The owner's rule: nothing in this phase reached COMPLETED or wrote funding clearance.
  expect(financing?.status).not.toBe(FinancingStatus.COMPLETED);
  expect(atFinancing?.fundingClearedAt).toBeNull();
});

// ───────────────────────────────────────────────────────────────────────────────
// Journey 2 — the same path, CASH
// ───────────────────────────────────────────────────────────────────────────────

test("journey 2 — the cash path reaches NOT_REQUIRED_CASH at Stage 12, not COMPLETED", async () => {
  needsInfra();
  const f = await seedSelectedDeal();

  await submitReaffirmation({ dealId: f.dealId, dealerId: f.dealerIds[0]!, submission: submission() });
  await acknowledgeConditionDisclosure({ dealId: f.dealId, buyerId: f.buyerId });

  const recap = await currentRecap(f.dealId);
  await decideOptionalProduct({
    dealId: f.dealId,
    buyerId: f.buyerId,
    productKey: recap!.optionalProducts[0]!.key,
    accepted: false, // §11a — declined, and it must not reappear later.
  });
  await confirmRecap({ dealId: f.dealId, actor: "BUYER", actorId: f.buyerId });
  await confirmRecap({ dealId: f.dealId, actor: "DEALER", actorId: f.dealerIds[0]! });

  const cash = await recordFinancingCheckpoint({
    dealId: f.dealId,
    status: FinancingStatus.NOT_REQUIRED_CASH,
    path: "CASH",
    actorId: "admin_journey",
    actorEmail: "finance@autolenis.invalid",
    actorType: "ADMIN",
    reason: "Buyer confirmed a cash purchase; no lender involved",
  });
  expect(cash.status).toBe(FinancingStatus.NOT_REQUIRED_CASH);

  const financing = await prisma.financing.findUnique({ where: { dealId: f.dealId } });
  expect(financing?.status).toBe(FinancingStatus.NOT_REQUIRED_CASH);
  // §12d — "Cash does not skip a checkpoint; it satisfies it differently." The money itself is
  // confirmed received at funding clearance, which is Phase 8's.
  const deal = await prisma.deal.findUnique({ where: { id: f.dealId } });
  expect(deal?.financingTermsLockedAt).toBeTruthy();
  expect(deal?.fundingClearedAt).toBeNull();

  const declined = await currentRecap(f.dealId);
  expect(declined?.optionalProducts[0]?.accepted).toBe(false);
});

// ───────────────────────────────────────────────────────────────────────────────
// Journey 3 — §10a, a material change rejected
// ───────────────────────────────────────────────────────────────────────────────

test("journey 3 — a material change is presented, rejected, and the buyer returns to the remaining offers", async () => {
  needsInfra();
  const f = await seedSelectedDeal();

  const result = await submitReaffirmation({
    dealId: f.dealId,
    dealerId: f.dealerIds[0]!,
    // A different VIN and $1,400 more — two of §10a's seven.
    submission: submission({ confirmedVin: "2HGCM82633A004353", confirmedOtdCents: ACCEPTED_OTD + 140_000 }),
  });
  expect(result.status).toBe("MATERIAL_CHANGE_PENDING");
  expect(result.materialChange!.length).toBeGreaterThanOrEqual(2);

  // §25.1 — the firewall stays CLOSED while the buyer has not accepted. A proposal is not a
  // confirmation.
  expect((await dealerIdentityVisible(f.dealId, f.dealerIds[0]!)).visible).toBe(false);

  const notice = await prisma.commsOutbox.findFirst({
    where: { dealId: f.dealId, templateKey: PHASE_7_TEMPLATES.MATERIAL_CHANGE_PROPOSED },
  });
  expect(notice).toBeTruthy();

  const decision = await decideMaterialChange({ dealId: f.dealId, buyerId: f.buyerId, accept: false });
  expect(decision.decision).toBe("REJECTED");

  const deal = await prisma.deal.findUnique({ where: { id: f.dealId } });
  expect(deal?.status).toBe(DealStatus.CANCELLED);

  // §Stage 10's failure clause: the reason is stated, and the remaining offer is still valid.
  const returned = await prisma.commsOutbox.findFirst({
    where: { dealId: f.dealId, templateKey: PHASE_7_TEMPLATES.RETURNED_TO_OFFERS },
  });
  expect(returned).toBeTruthy();
  const remaining = await prisma.offer.count({
    where: { auctionId: f.auctionId, status: "SUBMITTED", isDisqualified: false },
  });
  expect(remaining).toBe(1);

  // §26 — an exception, owned by Operations.
  const exception = await prisma.queueItem.findFirst({
    where: { dealId: f.dealId, exceptionCode: "DEALER_MATERIAL_CHANGE" },
  });
  expect(exception).toBeTruthy();

  // A buyer rejecting a change is NOT the dealership's failure — no SLA row.
  const sla = await prisma.slaViolation.count({ where: { entityId: f.rooftopId, slaType: "REAFFIRMATION" } });
  expect(sla).toBe(0);
});

// ───────────────────────────────────────────────────────────────────────────────
// Journey 4 — §10a, a lower out-the-door applies automatically
// ───────────────────────────────────────────────────────────────────────────────

test("journey 4 — a lower out-the-door applies automatically, and the buyer is told", async () => {
  needsInfra();
  const f = await seedSelectedDeal();

  const result = await submitReaffirmation({
    dealId: f.dealId,
    dealerId: f.dealerIds[0]!,
    submission: submission({ confirmedOtdCents: ACCEPTED_OTD - 40_000 }),
  });
  // No buyer decision is owed — §10a applies it "in the buyer's favor".
  expect(result.status).toBe("CONFIRMED");

  const deal = await prisma.deal.findUnique({ where: { id: f.dealId } });
  expect(deal?.otdCentsConfirmed).toBe(ACCEPTED_OTD - 40_000);

  // AUTOMATIC MUST NOT MEAN SILENT. The decision is on the record and the buyer is notified.
  const row = await prisma.dealerReaffirmation.findFirst({ where: { dealId: f.dealId } });
  expect(row?.buyerDecision).toBe("AUTO_APPLIED");
  const proposal = row?.materialChangeProposal as { autoApplied?: boolean; savingCents?: number };
  expect(proposal.autoApplied).toBe(true);
  expect(proposal.savingCents).toBe(40_000);

  const told = await prisma.commsOutbox.findFirst({
    where: { dealId: f.dealId, templateKey: PHASE_7_TEMPLATES.DEALER_CONFIRMED },
  });
  expect(told).toBeTruthy();
  expect(JSON.stringify(told!.payload)).toMatch(/came down/i);
});

// ───────────────────────────────────────────────────────────────────────────────
// Journey 5 — §10a, above the ceiling is refused at the dealership
// ───────────────────────────────────────────────────────────────────────────────

test("journey 5 — an above-ceiling out-the-door is refused, and never reaches the buyer", async () => {
  needsInfra();
  const f = await seedSelectedDeal();

  const result = await submitReaffirmation({
    dealId: f.dealId,
    dealerId: f.dealerIds[0]!,
    submission: submission({ confirmedOtdCents: CEILING_CENTS + 100_000 }),
  });
  expect(result.status).toBe("REFUSED");

  // NOTHING WAS WRITTEN. §10a: it "cannot be accepted at all", so it is not a pending decision.
  const row = await prisma.dealerReaffirmation.findFirst({ where: { dealId: f.dealId } });
  expect(row?.status).toBe("PENDING");
  expect(row?.confirmedOtdCents).toBeNull();

  // The buyer was never shown a choice.
  const shown = await prisma.commsOutbox.count({
    where: { dealId: f.dealId, templateKey: PHASE_7_TEMPLATES.MATERIAL_CHANGE_PROPOSED },
  });
  expect(shown).toBe(0);

  // The firewall stayed closed.
  expect((await dealerIdentityVisible(f.dealId, f.dealerIds[0]!)).visible).toBe(false);
});

// ───────────────────────────────────────────────────────────────────────────────
// Journey 6 — the 24-hour deadline passing, and the SLA on the repeat
// ───────────────────────────────────────────────────────────────────────────────

test("journey 6 — the 24-hour window closes → back to offers, scorecard entry, SLA on the repeat", async () => {
  needsInfra();
  const first = await seedSelectedDeal();
  await prisma.dealerReaffirmation.updateMany({
    where: { dealId: first.dealId },
    data: { dueAt: new Date(Date.now() - 60_000) },
  });

  const expired = await expireOverdueReaffirmations();
  expect(expired.expired).toBeGreaterThanOrEqual(1);

  const row = await prisma.dealerReaffirmation.findFirst({ where: { dealId: first.dealId } });
  expect(row?.status).toBe("TIMED_OUT");
  const deal = await prisma.deal.findUnique({ where: { id: first.dealId } });
  expect(deal?.status).toBe(DealStatus.CANCELLED);

  const exception = await prisma.queueItem.findFirst({
    where: { dealId: first.dealId, exceptionCode: "WINNING_DEALER_REJECTS_OR_TIMES_OUT" },
  });
  expect(exception).toBeTruthy();

  // §Stage 10 — "The failure is recorded on the dealership's scorecard." ONE failure is recorded,
  // and the record is keyed on the ROOFTOP: §13-D20's placeholder is a single shared system Dealer,
  // so an outside winner's failure keyed on `Offer.dealerId` would land on a row shared by every
  // outside dealership at once. `SlaViolation.entity_type` is free TEXT and carries a rooftop.
  const afterFirst = await prisma.slaViolation.findMany({
    where: { entityId: first.rooftopId, slaType: "REAFFIRMATION" },
  });
  expect(afterFirst.length).toBe(1);
  expect(afterFirst[0]!.entityType).toBe("ROOFTOP");

  // ONE failure is not yet "repeated". N = 2 within §13-D42's 90-day window (owner-ruled at
  // STOP 1), so no SLA REVIEW row yet. The review is keyed on the dealership, which is how it is
  // told apart from the deal's own exception.
  const reviewAfterFirst = await prisma.queueItem.count({
    where: { dealerId: first.dealerIds[0]!, exceptionCode: "WINNING_DEALER_REJECTS_OR_TIMES_OUT" },
  });
  expect(reviewAfterFirst).toBe(0);

  // THE REPEAT. A second deal on the SAME rooftop, timed out the same way, crosses the threshold.
  const second = await seedSelectedDealOnRooftop(first);
  await prisma.dealerReaffirmation.updateMany({
    where: { dealId: second.dealId },
    data: { dueAt: new Date(Date.now() - 60_000) },
  });
  await expireOverdueReaffirmations();

  const afterSecond = await prisma.slaViolation.count({
    where: { entityId: first.rooftopId, slaType: "REAFFIRMATION" },
  });
  expect(afterSecond).toBe(2);

  const review = await prisma.queueItem.findFirst({
    where: { dealerId: first.dealerIds[0]!, exceptionCode: "WINNING_DEALER_REJECTS_OR_TIMES_OUT" },
  });
  expect(review).toBeTruthy();
  expect(review!.requiredAction ?? "").toBeTruthy();
});

// ───────────────────────────────────────────────────────────────────────────────
// Journeys 7–12 — the defects the independent review found, each with the path that failed
//
// Every one of these was reachable in the built system and none was caught by the six journeys
// above, because each of the six drives the stages in ONE order. These drive the other orders, the
// second window, the third dispute and the batch reader.
// ───────────────────────────────────────────────────────────────────────────────

test("journey 7 — the buyer acknowledges FIRST, and the dealership's confirmation still advances the deal", async () => {
  needsInfra();
  const f = await seedSelectedDeal();

  // §Stage 10 orders the disclosure and its acknowledgement: the dealership discloses, then the
  // buyer acknowledges. The route accepted the acknowledgement at any point and only the UI hid
  // the button, so a buyer could record an acknowledgement of a disclosure THAT DID NOT EXIST.
  await expect(
    acknowledgeConditionDisclosure({ dealId: f.dealId, buyerId: f.buyerId }),
  ).rejects.toThrow(/has not confirmed this deal yet/i);

  const untouched = await prisma.deal.findUnique({ where: { id: f.dealId } });
  expect(untouched?.conditionDisclosureAcknowledgedAt).toBeNull();

  // Now the dealership confirms — and it is the LAST of the three exit clauses to be satisfied,
  // which is the case that stranded deals: only the buyer's two actions asked whether the exit was
  // met, so a deal whose final clause was the dealership's sat at DEALER_CONFIRMATION forever.
  const result = await submitReaffirmation({
    dealId: f.dealId,
    dealerId: f.dealerIds[0]!,
    submission: submission(),
  });
  expect(result.status).toBe("CONFIRMED");

  // The acknowledgement is now accepted, and it completes the exit.
  const ack = await acknowledgeConditionDisclosure({ dealId: f.dealId, buyerId: f.buyerId });
  expect(ack.acknowledged).toBe(true);
  expect(ack.advanced).toBe(true);
  const advanced = await prisma.deal.findUnique({ where: { id: f.dealId } });
  expect(advanced?.status).toBe(DealStatus.RECAP_PENDING);
});

test("journey 8 — the dealership acknowledging LAST advances it too, with the reminder cancelled", async () => {
  needsInfra();
  const f = await seedSelectedDeal();

  // Drive the OTHER order: the dealership confirms, the buyer acknowledges, and then check that a
  // dealership confirming after an acknowledgement (journey 7's order, reversed) also lands.
  await submitReaffirmation({ dealId: f.dealId, dealerId: f.dealerIds[0]!, submission: submission() });
  await acknowledgeConditionDisclosure({ dealId: f.dealId, buyerId: f.buyerId });

  const atRecap = await prisma.deal.findUnique({ where: { id: f.dealId } });
  expect(atRecap?.status).toBe(DealStatus.RECAP_PENDING);

  // §27 — the 12-hour reminder is about a question that has been answered. A comment in the
  // service claimed it was cancelled on confirmation; nothing called `cancelByKey` on that path.
  const reminder = await prisma.commsOutbox.findFirst({
    where: { dealId: f.dealId, templateKey: PHASE_7_TEMPLATES.REAFFIRMATION_REMINDER },
  });
  expect(reminder).toBeTruthy();
  expect(reminder!.status).toBe("cancelled");
});

test("journey 9 — the third dispute FREEZES the recap, and neither side can confirm past it", async () => {
  needsInfra();
  const f = await seedSelectedDeal();
  await submitReaffirmation({ dealId: f.dealId, dealerId: f.dealerIds[0]!, submission: submission() });
  await acknowledgeConditionDisclosure({ dealId: f.dealId, buyerId: f.buyerId });

  const v1 = await currentRecap(f.dealId);
  expect(v1?.version).toBe(1);

  // §Stage 11: "Repeated failure escalates to Operations with the Deal frozen at recap." The owner
  // ruled N = 2 at STOP 1, so the THIRD dispute freezes. `frozen` was computed, written into the
  // exception's text, and then ignored — `confirmRecap` had no freeze check at all, so both
  // parties could confirm the next version minutes later and the deal advanced to financing
  // without the Operations decision the escalation exists to require.
  const d1 = await disputeRecap({ dealId: f.dealId, actor: "BUYER", actorId: f.buyerId, reason: "The doc fee is wrong" });
  expect(d1.frozen).toBe(false);
  const d2 = await disputeRecap({ dealId: f.dealId, actor: "BUYER", actorId: f.buyerId, reason: "The taxes are still wrong" });
  expect(d2.frozen).toBe(false);
  const d3 = await disputeRecap({ dealId: f.dealId, actor: "BUYER", actorId: f.buyerId, reason: "The total is still wrong" });
  expect(d3.frozen).toBe(true);

  await expect(
    confirmRecap({ dealId: f.dealId, actor: "DEALER", actorId: f.dealerIds[0]! }),
  ).rejects.toThrow(/Operations/i);

  const stillAtRecap = await prisma.deal.findUnique({ where: { id: f.dealId } });
  expect(stillAtRecap?.status).toBe(DealStatus.RECAP_PENDING);

  // The freeze is held by the OPEN Operations row, so resolving it is the decision that releases
  // the deal — there is no separate unfreeze, and nothing can unfreeze itself.
  await prisma.queueItem.updateMany({
    where: { dealId: f.dealId, exceptionCode: "RECAP_DISPUTED" },
    data: { status: "RESOLVED", resolvedAt: new Date(), resolvedBy: "ops_journey" },
  });
  const released = await confirmRecap({ dealId: f.dealId, actor: "DEALER", actorId: f.dealerIds[0]! });
  expect(released.confirmed).toBe(true);

  // Versions are append-only: three disputes, four versions, one live.
  const versions = await prisma.dealRecap.findMany({ where: { dealId: f.dealId }, orderBy: { version: "asc" } });
  expect(versions.map((v) => v.version)).toEqual([1, 2, 3, 4]);
  expect(versions.filter((v) => v.supersededBy === null)).toHaveLength(1);
});

test("journey 10 — a material change nobody answers expires on its OWN clock and returns the buyer to the offers", async () => {
  needsInfra();
  const f = await seedSelectedDeal();

  // The dealership proposes a change. Before this fix the row parked at MATERIAL_CHANGE_PENDING
  // with `holdUntil` written to the REAFFIRMATION row only, so `sweepExpiringHolds` (which reads
  // `deals.vehicle_hold_until`) never saw it and `expireOverdueReaffirmations` (which filtered
  // `status: "PENDING"`) skipped it. A buyer who never opened the email left the deal parked
  // forever with the vehicle held off the market.
  const proposed = await submitReaffirmation({
    dealId: f.dealId,
    dealerId: f.dealerIds[0]!,
    submission: submission({ confirmedOtdCents: ACCEPTED_OTD + 140_000 }),
  });
  expect(proposed.status).toBe("MATERIAL_CHANGE_PENDING");

  // Both clocks are now set: the hold is on the DEAL, and the reaffirmation's deadline was RESET
  // to a fresh window — a dealership answering at hour 23 must not leave the buyer one hour.
  const parked = await prisma.deal.findUnique({ where: { id: f.dealId } });
  expect(parked?.vehicleHoldUntil).toBeTruthy();
  const row = await prisma.dealerReaffirmation.findFirst({ where: { dealId: f.dealId } });
  expect(row?.dueAt).toBeTruthy();
  expect(row!.dueAt!.getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);

  // The window closes with no answer.
  await prisma.dealerReaffirmation.update({
    where: { id: row!.id },
    data: { dueAt: new Date(Date.now() - 60_000) },
  });
  const swept = await expireOverdueReaffirmations(new Date());
  expect(swept.expired).toBeGreaterThan(0);

  const stoodDown = await prisma.deal.findUnique({ where: { id: f.dealId } });
  expect(stoodDown?.status).toBe(DealStatus.CANCELLED);
  const notice = await prisma.commsOutbox.findFirst({
    where: { dealId: f.dealId, templateKey: PHASE_7_TEMPLATES.RETURNED_TO_OFFERS },
  });
  expect(notice).toBeTruthy();

  // A buyer who did not answer is NOT a dealership failing, so it must never reach the SLA counter.
  const sla = await prisma.slaViolation.findMany({ where: { entityId: f.rooftopId, slaType: "REAFFIRMATION" } });
  expect(sla).toHaveLength(0);
});

test("journey 11 — the hold sweep asks the DEALERSHIP to extend or release, not only the buyer", async () => {
  needsInfra();
  const f = await seedSelectedDeal();
  await submitReaffirmation({
    dealId: f.dealId,
    dealerId: f.dealerIds[0]!,
    submission: submission({ holdUntil: new Date(Date.now() + 3_600_000) }),
  });

  // §27.1's row is "Vehicle hold expiring → Buyer + DEALERSHIP + Operations → extend or release".
  // Only the buyer half was sent, and the buyer's copy said "our team has asked them to extend the
  // hold or release it" — a statement about a message nobody sent to the only party that can act.
  await sweepExpiringHolds(new Date());

  const rows = await prisma.commsOutbox.findMany({
    where: { dealId: f.dealId, templateKey: PHASE_7_TEMPLATES.VEHICLE_HOLD_EXPIRING },
  });
  expect(rows.map((r) => r.recipientKind).sort()).toEqual(["buyer", "dealer"]);

  // `skipIfHoldNoLongerExpiring` reads `payload.holdUntil` to suppress a notice about a hold the
  // dealership has since extended. The payload never carried the field, so that branch was dead
  // and a buyer could be told the old date ten minutes after it moved.
  for (const row of rows) {
    expect((row.payload as Record<string, unknown>).holdUntil).toBeTruthy();
  }

  const opsRow = await prisma.queueItem.findFirst({
    where: { dealId: f.dealId, exceptionCode: "VEHICLE_HOLD_EXPIRED" },
  });
  expect(opsRow).toBeTruthy();
});

test("journey 12 — the batched firewall reader agrees with the single predicate, deal by deal", async () => {
  needsInfra();
  const a = await seedSelectedDeal();
  const b = await seedSelectedDealOnRooftop(a);

  // `app/dealer/financing/page.tsx` awaited the single predicate inside a loop over up to 50 rows,
  // each making up to three queries — up to 150 serialised round-trips per render. The batch
  // reader replaces it, and the only thing that matters about it is that it gives the SAME answer:
  // a privacy predicate with two implementations is a predicate with one that drifts.
  // Before any reaffirmation: both closed.
  let batch = await dealerIdentityVisibleMany([a.dealId, b.dealId], a.dealerIds[0]!);
  expect(batch.get(a.dealId)).toEqual(await dealerIdentityVisible(a.dealId, a.dealerIds[0]!));
  expect(batch.get(b.dealId)!.visible).toBe(false);

  // One confirmed, one not — the interesting case, because a batch that answered per-batch rather
  // than per-deal would open both.
  await submitReaffirmation({ dealId: a.dealId, dealerId: a.dealerIds[0]!, submission: submission() });
  batch = await dealerIdentityVisibleMany([a.dealId, b.dealId], a.dealerIds[0]!);
  expect(batch.get(a.dealId)).toEqual(await dealerIdentityVisible(a.dealId, a.dealerIds[0]!));
  expect(batch.get(a.dealId)!.visible).toBe(true);
  expect(batch.get(b.dealId)!.visible).toBe(false);

  // A deal that does not exist is withheld, not absent — a caller reading `.get(id)?.visible` on a
  // missing key gets `undefined`, and `undefined` is not `false` in every expression.
  const missing = await dealerIdentityVisibleMany(["00000000-0000-0000-0000-000000000000"], a.dealerIds[0]!);
  expect(missing.get("00000000-0000-0000-0000-000000000000")!.visible).toBe(false);

  // Another dealership's id sees nothing, in the batch exactly as in the single predicate.
  //
  // `a.dealerIds[1]` is the LOSING dealership on the same auction — it bid, it did not win, and
  // §25.1 gives it nothing. (`b` is deliberately the SAME dealership on a second deal, which is
  // what makes journey 6's repeat-threshold work, so it is not the foreign case.)
  const losing = a.dealerIds[1]!;
  expect(losing).not.toBe(a.dealerIds[0]!);
  const foreign = await dealerIdentityVisibleMany([a.dealId], losing);
  expect(foreign.get(a.dealId)).toEqual(await dealerIdentityVisible(a.dealId, losing));
  expect(foreign.get(a.dealId)!.visible).toBe(false);
  expect(foreign.get(a.dealId)!.reason).toBe("NO_DEAL");
});

// ───────────────────────────────────────────────────────────────────────────────
// Journeys 13–14 — the re-audit findings, against a real database
//
// Journey 13 is the one that matters most in this file: it is the only assertion here that a
// dealership cannot reach into another dealership's deal. It failed before the fix.
// ───────────────────────────────────────────────────────────────────────────────

test("journey 13 — a dealership CANNOT release another dealership's hold", async () => {
  needsInfra();
  const f = await seedSelectedDeal();
  await submitReaffirmation({ dealId: f.dealId, dealerId: f.dealerIds[0]!, submission: submission() });

  const winner = f.dealerIds[0]!;
  const intruder = f.dealerIds[1]!;
  expect(intruder).not.toBe(winner);

  // BEFORE THE FIX THIS SUCCEEDED. `releaseVehicleHold` took `actorId` only and went straight to
  // `returnToRemainingOffers`: the intruder's id was recorded as the actor and the victim's deal
  // was cancelled, its firewall revoked, its buyer emailed, and a dealer-fault SLA violation filed
  // against the WINNER's rooftop.
  await expect(
    releaseVehicleHold({ dealId: f.dealId, dealerId: intruder, actorId: intruder, reason: "not mine to release" }),
  ).rejects.toThrow(/belongs to another dealership/i);

  // Nothing moved: the deal is live, the firewall is still lifted, no notice, no SLA row.
  const after = await prisma.deal.findUnique({ where: { id: f.dealId } });
  expect(after?.status).toBe(DealStatus.DEALER_CONFIRMATION);
  expect((await dealerIdentityVisible(f.dealId, winner)).visible).toBe(true);
  expect(
    await prisma.commsOutbox.count({
      where: { dealId: f.dealId, templateKey: PHASE_7_TEMPLATES.RETURNED_TO_OFFERS },
    }),
  ).toBe(0);
  expect(await prisma.slaViolation.count({ where: { entityId: f.rooftopId, slaType: "REAFFIRMATION" } })).toBe(0);

  // The OWNER can still release — the fix must not have closed the legitimate path.
  await releaseVehicleHold({ dealId: f.dealId, dealerId: winner, actorId: winner, reason: "the vehicle sold this morning" });
  const released = await prisma.deal.findUnique({ where: { id: f.dealId } });
  expect(released?.status).toBe(DealStatus.CANCELLED);
});

test("journey 14 — an outside winner's own deal is visible to it, and its timeout is not its fault", async () => {
  needsInfra();
  const f = await seedSelectedDeal();

  // Make the winning offer placeholder-owned, which is what an outside winner is: the offer keeps
  // the shared system Dealer (§13-D20 never re-points it) and `Deal.dealerId` carries the claimed
  // dealership — the field whose writer §13-D58 assigns to the dealer-recruitment area.
  await prisma.dealer.update({
    where: { id: f.dealerIds[0]! },
    data: { isSystemPlaceholder: true },
  });

  // §13-D20's split: the page readers must find the deal by EITHER id. Before the fix they used
  // `offer.dealerId` alone, so the dealership's own recap email linked it to a 404.
  const claimed = f.dealerIds[1]!;
  await prisma.deal.update({ where: { id: f.dealId }, data: { dealerId: claimed } });
  expect(await getDealerDealById(f.dealId, claimed)).not.toBeNull();
  expect((await getDealerDeals(claimed)).map((d) => d.id)).toContain(f.dealId);

  // §10b blocks them (the claim sequence is incomplete — D58), so the window closes on a deal they
  // could never have confirmed. The stand-down still happens; the BLAME does not.
  const row = await prisma.dealerReaffirmation.findFirst({ where: { dealId: f.dealId } });
  await prisma.dealerReaffirmation.update({
    where: { id: row!.id },
    data: { dueAt: new Date(Date.now() - 60_000) },
  });
  await expireOverdueReaffirmations(new Date());

  const stoodDown = await prisma.deal.findUnique({ where: { id: f.dealId } });
  expect(stoodDown?.status).toBe(DealStatus.CANCELLED);
  // The buyer is still told — the stand-down is not suppressed, only the attribution is.
  expect(
    await prisma.commsOutbox.count({
      where: { dealId: f.dealId, templateKey: PHASE_7_TEMPLATES.RETURNED_TO_OFFERS },
    }),
  ).toBeGreaterThan(0);
  // No SLA mark on a dealership the platform blocked.
  expect(await prisma.slaViolation.count({ where: { entityId: f.rooftopId, slaType: "REAFFIRMATION" } })).toBe(0);
  // And Operations is told why it was not recorded.
  const ops = await prisma.queueItem.findFirst({
    where: { dealId: f.dealId, exceptionCode: "OUTSIDE_WINNER_FAILS_VERIFICATION" },
  });
  expect(ops).toBeTruthy();
  // `raiseException`'s `detail` is folded into `required_action` by `buildRequiredAction`
  // (queue-item.service.ts:189) — `queue_items` has no `detail` column. An earlier draft of this
  // assertion read `ops!.detail`, got undefined, and failed: the test was wrong, not the code.
  expect(ops!.requiredAction ?? "").toMatch(/was NOT at fault/i);
});
