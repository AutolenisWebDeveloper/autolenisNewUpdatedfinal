// lib/services/deal/funding-clearance.service.ts
//
// Stage 14 — financing completion, the six-item funding-clearance list, the Premium
// window close, and the full send-back when financing changes.
//
// THE RULE THIS FILE EXISTS TO ENFORCE, in the specification's own words:
//
//   "No conditional or spot delivery. A vehicle is never released on the expectation
//    that financing will complete later. This rule exists to protect the buyer from
//    unwinding after delivery, and it is enforced STRUCTURALLY: release requires funding
//    cleared, and funding clearance requires completed financing."
//
// Structural means the two predicates below, not a policy anyone can remember to apply.
// `clearFunding` refuses unless financing is COMPLETED or NOT_REQUIRED_CASH, and the
// release gates downstream refuse unless `funding_cleared_at` is set. Neither is
// reachable around the other.
//
// EVERY ONE OF THE SIX ITEMS IS EVALUATED, AND EACH REPORTS ITS OWNER. Stage 14's
// buyer-visible copy is "the specific outstanding condition and who owns it", which a
// boolean cannot say. `evaluateFundingClearance` returns every item with its state and
// its owner whether or not it passes, because the buyer surface, the admin surface and
// the blocked-notice email all need the same list and must not each derive their own.
//
// `deals.funding_cleared_at` GETS ITS FIRST WRITER HERE. It has existed since Phase 1
// and `upgrade-window.service.ts:112-115` has read it inertly since Phase 3 — "correct
// now, inert now, and live the day the clearance service ships, with no change here".
// This is that day. The write is scoped so it cannot misfire: only the deal being
// cleared, only once, under a compare-and-swap on the null.

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { DealStatus, FinancingStatus } from "@prisma/client";
import { advanceDealStatus } from "./deal.service";
import { recordFinancingCheckpoint } from "@/lib/services/financing/financing-checkpoint.service";
import { raiseException } from "@/lib/services/operations/queue-item.service";
import { enqueueTransactional } from "@/lib/services/comms/transactional-dispatcher.service";
import { PHASE_8_TEMPLATES } from "@/lib/services/comms/state-recheck-registry";
import {
  renderFinancingCompleted,
  renderFundingBlocked,
  renderFundingCleared,
  renderPremiumElectionReverted,
} from "@/lib/services/comms/phase8-email-content";

export type ClearanceOwner = "FINANCE" | "DEALERSHIP" | "BUYER" | "OPERATIONS";

export interface ClearanceItem {
  key: string;
  /** Verbatim from Stage 14's list — the wording the buyer and the dealership both see. */
  label: string;
  satisfied: boolean;
  /** Who has to act when it is not satisfied. Stage 14: "and who owns it". */
  owner: ClearanceOwner;
  /** Why it is outstanding, in a sentence a non-engineer can act on. */
  detail: string;
  /** True when the item does not apply to this deal (e.g. no trade with a lien). */
  notApplicable?: boolean;
}

export interface ClearanceEvaluation {
  items: ClearanceItem[];
  outstanding: ClearanceItem[];
  clear: boolean;
}

export class FundingClearanceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "FundingClearanceError";
  }
}

/** Financing states that satisfy Stage 14's "financing approval is current". */
const FINANCING_COMPLETE: FinancingStatus[] = [
  FinancingStatus.COMPLETED,
  FinancingStatus.NOT_REQUIRED_CASH,
];

/**
 * Evaluate all six clearance items. READ-ONLY — it never writes and never advances, so
 * the buyer's screen, the admin's screen and the blocked notice can all call it freely.
 */
export async function evaluateFundingClearance(dealId: string): Promise<ClearanceEvaluation> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      id: true,
      financingPath: true,
      downPaymentCents: true,
      feePaidAt: true,
      feeRefundedAt: true,
      financing: {
        select: {
          status: true, expiresAt: true, downPaymentCents: true, verifiedAt: true,
          lenderConditionsClearedAt: true, downPaymentMethod: true, dealerFundingConfirmedAt: true,
        },
      },
      deposit: { select: { status: true } },
      // Item 5's good-through date already lives on the recap (schema.prisma:6621) — the
      // figures both parties confirmed — so it is read there rather than duplicated.
      dealRecaps: {
        where: { supersededBy: null },
        orderBy: { version: "desc" },
        take: 1,
        select: { payoffGoodThroughDate: true },
      },
      tradeInSubmissions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { verifiedPayoffCents: true, loanBalanceCents: true },
      },
    },
  });

  if (!deal) {
    // Fail closed, loudly. An unreadable deal is not a cleared one.
    return {
      items: [],
      outstanding: [
        {
          key: "deal",
          label: "The deal record could not be read",
          satisfied: false,
          owner: "OPERATIONS",
          detail: "Funding cannot be cleared against a deal AutoLenis cannot load.",
        },
      ],
      clear: false,
    };
  }

  const fin = deal.financing;
  const trade = deal.tradeInSubmissions[0] ?? null;
  const payoffGoodThrough = deal.dealRecaps[0]?.payoffGoodThroughDate ?? null;
  const now = new Date();
  const items: ClearanceItem[] = [];

  // 1 — "Financing approval is current and unexpired."
  const financingStatus = deal.financing?.status ?? null;
  const financingComplete = financingStatus != null && FINANCING_COMPLETE.includes(financingStatus);
  const financingExpired = deal.financing?.expiresAt != null && deal.financing.expiresAt < now;
  items.push({
    key: "financing_current",
    label: "Financing approval is current and unexpired",
    satisfied: financingComplete && !financingExpired,
    owner: "FINANCE",
    detail: !financingComplete
      ? `Financing is ${financingStatus ?? "not recorded"}; completion must be recorded against the lender's evidence first.`
      : financingExpired
        ? `The approval expired on ${deal.financing?.expiresAt?.toDateString()}. A renewed approval is needed before clearance.`
        : "Recorded complete and unexpired.",
  });

  // 2 — "Every external lender condition and stipulation is satisfied."
  // Cash deals have no lender and therefore no stipulations; marking that
  // notApplicable rather than satisfied keeps the list honest about what was checked.
  const isCash = financingStatus === FinancingStatus.NOT_REQUIRED_CASH;
  items.push({
    key: "lender_conditions",
    label: "Every external lender condition and stipulation is satisfied",
    satisfied: isCash || fin?.lenderConditionsClearedAt != null,
    notApplicable: isCash,
    owner: "FINANCE",
    detail: isCash
      ? "Cash purchase — there is no lender and no stipulations."
      : fin?.lenderConditionsClearedAt != null
        ? "Recorded as cleared."
        : "The dealership has not yet confirmed that every lender stipulation is satisfied.",
  });

  // 3 — "The down-payment arrangement is complete and its method recorded by the dealership."
  // BOTH halves. An amount with no method is not a recorded arrangement — it is a number
  // nobody can reconcile against anything.
  const downCents = deal.financing?.downPaymentCents ?? deal.downPaymentCents ?? null;
  const downMethod = fin?.downPaymentMethod ?? null;
  items.push({
    key: "down_payment",
    label: "The down-payment arrangement is complete and its method recorded by the dealership",
    satisfied: downCents != null && downCents >= 0 && !!downMethod,
    owner: "DEALERSHIP",
    detail:
      downCents == null
        ? "No down-payment amount is recorded on the deal."
        : !downMethod
          ? "The amount is recorded but the dealership has not stated how it was collected."
          : `Recorded: ${(downCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} by ${downMethod}.`,
  });

  // 4 — "The dealership confirms funding or funding authorization."
  items.push({
    key: "dealer_funding",
    label: "The dealership confirms funding or funding authorization",
    satisfied: fin?.dealerFundingConfirmedAt != null,
    owner: "DEALERSHIP",
    detail:
      fin?.dealerFundingConfirmedAt != null
        ? `Confirmed ${fin.dealerFundingConfirmedAt.toDateString()}.`
        : "The dealership has not confirmed that funding, or authorization to fund, is in place.",
  });

  // 5 — "The trade payoff quote is within its good-through date, IF a trade with a lien is
  //      involved." The conditional is the point: a deal with no trade, or a trade owned
  //      outright, must not be held on an item that does not exist.
  const hasLien = trade != null && ((trade.verifiedPayoffCents ?? trade.loanBalanceCents ?? 0) > 0);
  const payoffFresh = payoffGoodThrough != null && payoffGoodThrough >= now;
  items.push({
    key: "trade_payoff",
    label: "The trade payoff quote is within its good-through date, if a trade with a lien is involved",
    satisfied: !hasLien || payoffFresh,
    notApplicable: !hasLien,
    owner: "OPERATIONS",
    detail: !hasLien
      ? "No trade with a lien on this deal."
      : payoffGoodThrough == null
        ? "A payoff quote is on file with no good-through date. A dated quote is required."
        : payoffFresh
          ? `Good through ${payoffGoodThrough.toDateString()}.`
          : `The payoff quote expired on ${payoffGoodThrough.toDateString()}. Refresh it before clearance.`,
  });

  // 6 — "No funding hold, payment dispute or chargeback exists on the $99 or the Premium fee."
  // The $99 is read from the deposit's own status; the Premium fee from the deal's refund
  // marker. A disputed deposit already closes the upgrade window through
  // settledDepositCentsForRequest — this extends the same fact to the release gate.
  const depositStatus = deal.deposit?.status ?? null;
  const depositTroubled =
    depositStatus != null && ["DISPUTED", "REFUNDED", "FAILED", "CHARGEBACK", "HELD"].includes(depositStatus);
  const feeTroubled = deal.feeRefundedAt != null;
  items.push({
    key: "no_payment_hold",
    label: "No funding hold, payment dispute or chargeback exists on the $99 or the Premium fee",
    satisfied: !depositTroubled && !feeTroubled,
    owner: "FINANCE",
    detail: depositTroubled
      ? `The $99 deposit is ${depositStatus}. Finance must resolve it before the vehicle is released.`
      : feeTroubled
        ? "The concierge fee has been refunded or reversed. Finance must resolve it before release."
        : "No hold, dispute or chargeback on either payment.",
  });

  const outstanding = items.filter((i) => !i.satisfied);
  return { items, outstanding, clear: outstanding.length === 0 };
}

/**
 * §Stage 14 checkpoint one: record financing COMPLETED against external evidence.
 *
 * Routed through `recordFinancingCheckpoint`, not written directly — that writer owns
 * §12b's transition map, the actor requirement, the ≥10-character reason and the
 * tamper-evident audit chain. Phase 7 reserved `COMPLETED` for this call and refused it
 * by name; Phase 8 opens the gate rather than going around it.
 */
export async function recordFinancingCompletion(params: {
  dealId: string;
  actorId: string;
  actorEmail?: string | null;
  reason: string;
  evidence?: Parameters<typeof recordFinancingCheckpoint>[0]["evidence"];
  now?: Date;
}): Promise<void> {
  const now = params.now ?? new Date();
  await recordFinancingCheckpoint({
    dealId: params.dealId,
    status: FinancingStatus.COMPLETED,
    actorId: params.actorId,
    actorEmail: params.actorEmail ?? null,
    actorType: "ADMIN",
    reason: params.reason,
    evidence: params.evidence,
    now,
  });

  await prisma.deal.updateMany({
    where: { id: params.dealId, financingCompletedAt: null },
    data: { financingCompletedAt: now },
  });

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    select: {
      buyerId: true,
      vehicleYear: true, vehicleMake: true, vehicleModel: true,
      buyer: { select: { user: { select: { email: true } } } },
    },
  });
  const email = deal?.buyer?.user?.email;
  if (email) {
    const vehicle = [deal?.vehicleYear, deal?.vehicleMake, deal?.vehicleModel].filter(Boolean).join(" ") || "your vehicle";
    const content = renderFinancingCompleted({ vehicle, dealId: params.dealId });
    await enqueueTransactional({
      triggerEvent: "financing_completed",
      templateKey: PHASE_8_TEMPLATES.FINANCING_COMPLETED,
      channel: "email",
      recipientKind: "buyer",
      recipientId: deal!.buyerId,
      to: email,
      payload: { email, subject: content.subject, html: content.html, text: content.text },
      dealId: params.dealId,
      idempotencyKey: `${PHASE_8_TEMPLATES.FINANCING_COMPLETED}:${params.dealId}`,
    });
  }
}

/**
 * §Stage 14 checkpoint two: clear funding.
 *
 * Refuses unless EVERY item passes. There is no partial clearance and no override — an
 * override here would be conditional delivery with a different name, which is the one
 * thing the stage forbids outright.
 *
 * On success: stamps `funding_cleared_at` (first writer), advances the Deal, closes the
 * Premium upgrade window and reverts an unpaid election.
 */
export async function clearFunding(params: {
  dealId: string;
  actorId: string;
  actorRole?: string;
  reason: string;
  now?: Date;
}): Promise<{ cleared: boolean; outstanding: ClearanceItem[] }> {
  const now = params.now ?? new Date();
  const evaluation = await evaluateFundingClearance(params.dealId);

  if (!evaluation.clear) {
    // §26 "Funding not cleared → Finance → Block release". An unresolved clearance holds
    // the Deal and opens an Operations row with an owner and a deadline — it does not
    // simply return false into a route handler and vanish.
    await raiseException({
      code: "FUNDING_NOT_CLEARED",
      dealId: params.dealId,
      detail:
        "Funding clearance was attempted and refused. Outstanding: " +
        evaluation.outstanding.map((i) => `${i.label} (owner: ${i.owner})`).join("; "),
    }).catch((err) => {
      logger.error("funding clearance: exception could not be raised", {
        dealId: params.dealId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    await notifyFundingBlocked(params.dealId, evaluation);
    return { cleared: false, outstanding: evaluation.outstanding };
  }

  // The first writer of `deals.funding_cleared_at`, and it is scoped so it cannot
  // misfire: this deal only, and only while the stamp is null. The Phase 3 reader
  // (`upgrade-window.service.ts`) matches on `vehicleRequestId` alone, so a stamp written
  // against the wrong deal would close the window for a whole request.
  const stamped = await prisma.deal.updateMany({
    where: { id: params.dealId, fundingClearedAt: null },
    data: { fundingClearedAt: now },
  });

  await advanceDealStatus(params.dealId, DealStatus.FUNDING_PENDING, {
    actorId: params.actorId,
    actorRole: params.actorRole ?? "ADMIN",
    reason: params.reason,
    expectedFrom: DealStatus.DEALER_EXECUTED,
  }).catch((err) => {
    // The stamp is the recorded fact; a deal already past this stage must not make the
    // clearance itself fail.
    logger.error("funding clearance: advance failed (stamp already recorded)", {
      dealId: params.dealId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  if (stamped.count > 0) {
    await closePremiumWindowAndRevert(params.dealId, params.actorId).catch((err) => {
      logger.error("funding clearance: premium window close failed", {
        dealId: params.dealId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    await notifyFundingCleared(params.dealId);
  }

  return { cleared: true, outstanding: [] };
}

/**
 * §Stage 14 / §23.2 — the Premium upgrade window closes at clearance, and an UNPAID
 * election reverts to Standard.
 *
 * ALL THREE STORES, not one. An election lives in `buyers.plan` + `planUpgradedAt`, in a
 * buyer-level `plan_snapshots` row, and in a request-bound snapshot with
 * `vehicle_requests.current_plan_snapshot_id` pointing at it. A half-revert is worse than
 * none: `buyers.plan` and the snapshot would disagree about what the buyer is entitled
 * to, and every surface reads a different one of them.
 *
 * PAID Premium is never touched. The predicate is an election with no settled balance —
 * §26: "Premium balance unpaid when funding clears → Buyer → Revert to Standard, which is
 * already paid, and continue without interruption."
 */
async function closePremiumWindowAndRevert(dealId: string, actorId: string): Promise<void> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      buyerId: true,
      vehicleRequestId: true,
      vehicleYear: true, vehicleMake: true, vehicleModel: true,
      buyer: { select: { plan: true, user: { select: { email: true } } } },
    },
  });
  if (!deal?.vehicleRequestId) return;

  const { entitledPlanForRequest } = await import("@/lib/services/buyer/plan-snapshot.service");
  const entitled = await entitledPlanForRequest(deal.vehicleRequestId);
  // Entitlement is derived from SETTLED money. PREMIUM here means the $400 balance
  // actually cleared, so there is nothing to revert and the window simply closed.
  if (entitled.plan === "PREMIUM") return;
  if (deal.buyer?.plan !== "PREMIUM") return; // no election to revert

  const { recordRequestPlanElection } = await import("@/lib/services/buyer/plan-snapshot.service");

  await prisma.$transaction(async (tx) => {
    // Store 1 — the buyer flag. Guarded on PREMIUM so a concurrent revert is a no-op
    // rather than a second snapshot.
    const reverted = await tx.buyer.updateMany({
      where: { id: deal.buyerId, plan: "PREMIUM" },
      data: { plan: "STANDARD", planUpgradedAt: null },
    });
    if (reverted.count === 0) return;

    // Stores 2 AND 3 — the snapshot and the request pointer that names the live one —
    // written through `recordRequestPlanElection`, which owns both. Writing the snapshot
    // directly here would have skipped `bindSnapshot`, leaving
    // `vehicle_requests.current_plan_snapshot_id` pointing at the PREMIUM election: a
    // half-revert where the buyer flag says Standard and the bound snapshot says Premium,
    // and every surface reads whichever of the two it happens to read.
    await recordRequestPlanElection(
      {
        buyerId: deal.buyerId,
        vehicleRequestId: deal.vehicleRequestId!,
        dealId,
        plan: "STANDARD",
        touchpoint: "funding_clearance_revert",
        actor: actorId,
        reason:
          "Premium election reverted at funding clearance — the $400 balance never settled, so the " +
          "buyer returns to Standard, which their $99 has already paid for in full (§23.2, §26).",
      },
      tx,
    );
  });

  const email = deal.buyer?.user?.email;
  if (email) {
    const vehicle = [deal.vehicleYear, deal.vehicleMake, deal.vehicleModel].filter(Boolean).join(" ") || "your vehicle";
    const content = renderPremiumElectionReverted({ vehicle, dealId });
    await enqueueTransactional({
      triggerEvent: "funding_cleared",
      templateKey: PHASE_8_TEMPLATES.PREMIUM_ELECTION_REVERTED,
      channel: "email",
      recipientKind: "buyer",
      recipientId: deal.buyerId,
      to: email,
      payload: { email, subject: content.subject, html: content.html, text: content.text },
      dealId,
      idempotencyKey: `${PHASE_8_TEMPLATES.PREMIUM_ELECTION_REVERTED}:${dealId}`,
    });
  }
}

async function dealVehicleAndBuyer(dealId: string) {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      buyerId: true,
      vehicleYear: true, vehicleMake: true, vehicleModel: true,
      buyer: { select: { user: { select: { email: true } } } },
      offer: {
        select: {
          externalDealerEmail: true,
          dealer: { select: { isSystemPlaceholder: true, user: { select: { email: true } } } },
        },
      },
    },
  });
  if (!deal) return null;
  return {
    buyerId: deal.buyerId,
    buyerEmail: deal.buyer?.user?.email ?? null,
    dealerEmail: deal.offer?.dealer?.isSystemPlaceholder
      ? deal.offer.externalDealerEmail
      : deal.offer?.dealer?.user?.email ?? null,
    vehicle: [deal.vehicleYear, deal.vehicleMake, deal.vehicleModel].filter(Boolean).join(" ") || "your vehicle",
  };
}

async function notifyFundingCleared(dealId: string): Promise<void> {
  const ctx = await dealVehicleAndBuyer(dealId);
  if (!ctx?.buyerEmail) return;
  const content = renderFundingCleared({ vehicle: ctx.vehicle, dealId });
  await enqueueTransactional({
    triggerEvent: "funding_cleared",
    templateKey: PHASE_8_TEMPLATES.FUNDING_CLEARED,
    channel: "email",
    recipientKind: "buyer",
    recipientId: ctx.buyerId,
    to: ctx.buyerEmail,
    payload: { email: ctx.buyerEmail, subject: content.subject, html: content.html, text: content.text },
    dealId,
    idempotencyKey: `${PHASE_8_TEMPLATES.FUNDING_CLEARED}:${dealId}`,
  });
}

/**
 * §27.1 "Funding cleared or blocked → Dealership, buyer, Operations → Release result or
 * missing requirement" — the blocked half, to both parties, each seeing only what they
 * can act on. A buyer told to chase a lender stipulation the dealership owns is a buyer
 * given an impossible task.
 */
async function notifyFundingBlocked(dealId: string, evaluation: ClearanceEvaluation): Promise<void> {
  const ctx = await dealVehicleAndBuyer(dealId);
  if (!ctx) return;
  const describe = (i: ClearanceItem) => `${i.label} — ${i.detail} (owner: ${i.owner.toLowerCase()})`;

  if (ctx.buyerEmail) {
    const content = renderFundingBlocked({
      audience: "buyer",
      vehicle: ctx.vehicle,
      outstanding: evaluation.outstanding.map(describe),
      dealId,
    });
    await enqueueTransactional({
      triggerEvent: "funding_blocked",
      templateKey: PHASE_8_TEMPLATES.FUNDING_BLOCKED,
      channel: "email",
      recipientKind: "buyer",
      recipientId: ctx.buyerId,
      to: ctx.buyerEmail,
      payload: { email: ctx.buyerEmail, subject: content.subject, html: content.html, text: content.text },
      dealId,
      // Keyed on WHICH items are outstanding, so a second attempt blocked on the same
      // items is silent while one blocked on a different item is a new message.
      idempotencyKey: `${PHASE_8_TEMPLATES.FUNDING_BLOCKED}:buyer:${dealId}:${evaluation.outstanding.map((i) => i.key).sort().join(",")}`,
    });
  }
  if (ctx.dealerEmail) {
    const content = renderFundingBlocked({
      audience: "dealer",
      vehicle: ctx.vehicle,
      outstanding: evaluation.outstanding.map(describe),
      dealId,
    });
    await enqueueTransactional({
      triggerEvent: "funding_blocked",
      templateKey: PHASE_8_TEMPLATES.FUNDING_BLOCKED,
      channel: "email",
      recipientKind: "dealer",
      recipientId: null,
      to: ctx.dealerEmail,
      payload: { email: ctx.dealerEmail, subject: content.subject, html: content.html, text: content.text },
      dealId,
      idempotencyKey: `${PHASE_8_TEMPLATES.FUNDING_BLOCKED}:dealer:${dealId}:${evaluation.outstanding.map((i) => i.key).sort().join(",")}`,
    });
  }
}

/**
 * §Stage 14's failure path — A FULL SEND-BACK, NOT A RETRY.
 *
 *   "A financing change that affects the contract sends the transaction back through
 *    recap confirmation, contract generation, Contract Shield, AND signatures. It never
 *    proceeds on a stale contract."
 *
 * So this does four things, and doing three of them would be the defect:
 *   1. voids every signature envelope — the signatures were given on numbers that have
 *      changed, and §14c already says a changed document "voids the envelope and requires
 *      fresh consent and fresh signatures";
 *   2. supersedes the approved contract version, so nothing can be signed against it;
 *   3. supersedes the recap, so the buyer re-confirms the NEW numbers rather than being
 *      asked to remember the old ones;
 *   4. returns the Deal to RECAP_PENDING, from which the existing edges carry it through
 *      FINANCING_PENDING -> FEE_PENDING -> FEE_PAID -> CONTRACT_PENDING and the whole
 *      gauntlet runs again.
 */
export async function sendBackForFinancingChange(params: {
  dealId: string;
  actorId: string;
  reason: string;
  now?: Date;
}): Promise<{ sentBack: boolean }> {
  const now = params.now ?? new Date();
  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    select: { status: true },
  });
  if (!deal) throw new FundingClearanceError("DEAL_NOT_FOUND", "Deal not found");
  const CLOSED: DealStatus[] = [DealStatus.CANCELLED, DealStatus.REFUNDED, DealStatus.COMPLETED];
  if (CLOSED.includes(deal.status)) {
    throw new FundingClearanceError(
      "DEAL_CLOSED",
      `This deal is ${deal.status}. A send-back re-opens a live transaction; a closed one is not re-opened by it.`,
    );
  }

  const { voidEnvelopeInternal } = await import("@/lib/services/esign/buyer-signing.service");
  const { requiredSignersForDeal } = await import("@/lib/services/esign/required-signers");

  // 1 — every signer's envelope, not just the buyer's.
  const signers = await requiredSignersForDeal(params.dealId);
  for (const signer of signers) {
    await voidEnvelopeInternal(
      params.dealId,
      `Financing changed after signature: ${params.reason}`,
      signer.signerKind,
    ).catch((err) => {
      logger.error("send-back: could not void envelope", {
        dealId: params.dealId,
        signerKind: signer.signerKind,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  // 2 — the approved contract is stale by definition. SUPERSEDED, not deleted: the
  // document that was signed remains evidence of what was signed.
  await prisma.contractVersion.updateMany({
    where: { dealId: params.dealId, status: { notIn: ["SUPERSEDED"] } },
    data: { status: "SUPERSEDED" },
  });

  // 3 — the recap the buyer confirmed described the old numbers.
  await prisma.dealRecap.updateMany({
    where: { dealId: params.dealId, supersededBy: null },
    data: { supersededBy: `financing-change:${now.toISOString()}` },
  });
  await prisma.deal.updateMany({
    where: { id: params.dealId },
    data: { recapConfirmedByBuyerAt: null, recapConfirmedByDealerAt: null },
  });

  // 4 — back to the head of the return path. Forced, and audit-logged as forced: this is
  // a BACKWARD move through several stages, which no forward edge describes and none
  // should — an unforced path backwards would be a way to rewind a deal quietly.
  await advanceDealStatus(params.dealId, DealStatus.RECAP_PENDING, {
    actorId: params.actorId,
    actorRole: "ADMIN",
    reason: `Financing change sends the transaction back through recap, contract, Contract Shield and signatures: ${params.reason}`,
    force: true,
  });

  await raiseException({
    code: "FINANCING_FAILS_OR_EXPIRES",
    dealId: params.dealId,
    detail:
      `A financing change sent this transaction back through recap confirmation, contract generation, ` +
      `Contract Shield and signatures. Reason: ${params.reason}`,
  }).catch((err) => {
    logger.error("send-back: exception could not be raised", {
      dealId: params.dealId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return { sentBack: true };
}
