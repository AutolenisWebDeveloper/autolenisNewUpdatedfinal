// §Stage 16's THIRTEEN-item pickup readiness checklist.
//
// "Every item must be true, and the website shows the exact unresolved item and the party
// responsible for it." (MD §Stage 16 L882.) Exit is all thirteen true; on failure "each unmet
// item has a named owner, a buyer-visible status, a required action, and a deadline. Nothing is
// scheduled while any item is unmet." (L904.)
//
// THE SHAPE IS `funding-clearance.service.ts`'s, deliberately. Phase 8 solved "a checklist the
// buyer sees, where every row names who has to act" for Stage 14's six-item clearance list, and
// `FundingClearanceChecklist.tsx` renders it. One idiom for that problem is worth more than a
// second, cleverer one — so `ReadinessItem` is `ClearanceItem` plus the two fields Stage 16 asks
// for and Stage 14 did not: a required action and a deadline.
//
// DERIVED, NEVER STORED. Not one of the thirteen is a new column. Each reads a fact some earlier
// phase already writes — `deals.vin` (Phase 6), `funding_cleared_at` and `financing_completed_at`
// (Phase 8), `dealer_executed_contract_id` (Phase 8), `insurance_status` (Phase 8's §13-D31
// narrowing), the trade packet (Phase 7's recap) — plus four the DEALERSHIP attests on the
// Pickup row. A readiness column would be a second copy of a fact that already exists, and the
// two would disagree the first time anything was corrected. `pickups.readiness_confirmed_at` and
// `deals.pickup_ready_at` record WHEN all thirteen last held, which is a different claim from
// whether they hold now.
//
// "NOT APPLICABLE" IS A THIRD STATE, as it is in Stage 14's list. A trade packet on a deal with
// no trade is not satisfied and not outstanding: it does not apply. Rendering it green would
// claim a check that never ran; rendering it outstanding would hold a buyer on a condition that
// cannot exist.

import { prisma } from "@/lib/prisma";
import { INSURANCE_SATISFIED } from "@/lib/services/deal/deal.service";

/** Same four parties as Stage 14's clearance list — one vocabulary across both checklists. */
export type ReadinessOwner = "FINANCE" | "DEALERSHIP" | "BUYER" | "OPERATIONS";

export interface ReadinessItem {
  key: string;
  /** Verbatim from Stage 16's list — the wording the buyer and the dealership both see. */
  label: string;
  satisfied: boolean;
  /** Stage 16: "a named owner". Who has to act when it is not satisfied. */
  owner: ReadinessOwner;
  /** Stage 16: "a buyer-visible status". Why it is outstanding, in a sentence a non-engineer can act on. */
  detail: string;
  /** Stage 16: "a required action". What the owner actually has to DO — not a restatement of the gap. */
  requiredAction: string;
  /** Stage 16: "a deadline". Null when the item is satisfied or does not apply. */
  deadlineAt: Date | null;
  /** True when the item cannot apply to this deal (e.g. no trade). */
  notApplicable?: boolean;
}

export interface ReadinessEvaluation {
  items: ReadinessItem[];
  outstanding: ReadinessItem[];
  ready: boolean;
}

/**
 * How long each party has, from the moment readiness begins, before its item is overdue.
 *
 * ANCHORED TO `funding_cleared_at`, NOT TO NOW. Stage 16's entry is "contract executed,
 * financing completed, funding cleared, insurance verified", and funding clearance is the last
 * of those to land — so it is the moment the readiness clock starts. Anchoring to the evaluation
 * instead would reset every deadline on every page load, which is a deadline that never passes.
 * A deal with no clearance timestamp yet has no deadline: the clock has not started.
 */
const READINESS_SLA_HOURS: Record<ReadinessOwner, number> = {
  DEALERSHIP: 48,
  BUYER: 72,
  FINANCE: 24,
  OPERATIONS: 24,
};

function deadlineFor(owner: ReadinessOwner, clockStartedAt: Date | null): Date | null {
  if (!clockStartedAt) return null;
  return new Date(clockStartedAt.getTime() + READINESS_SLA_HOURS[owner] * 60 * 60 * 1000);
}

/** The dealer's four attested facts live in one JSON column; these are its keys. */
export const DEALER_READINESS_KEYS = {
  accessories: "accessoriesPresent",
  documents: "deliveryDocumentsReady",
} as const;

function dealerAttests(checklist: unknown, key: string): boolean {
  if (!checklist || typeof checklist !== "object" || Array.isArray(checklist)) return false;
  return (checklist as Record<string, unknown>)[key] === true;
}

/**
 * Evaluate all thirteen items for one deal.
 *
 * FAILS CLOSED, LOUDLY. An unreadable deal is not a ready one — the same posture as
 * `evaluateFundingClearance`. A thrown error here would surface as a 500 on the buyer's pickup
 * page; an empty "ready: true" would schedule a handover on a deal nobody could read.
 */
export async function evaluatePickupReadiness(dealId: string): Promise<ReadinessEvaluation> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      id: true,
      status: true,
      vin: true,
      vehicleYear: true,
      vehicleMake: true,
      vehicleModel: true,
      vehicleHoldUntil: true,
      dealerExecutedContractId: true,
      financingCompletedAt: true,
      fundingClearedAt: true,
      insuranceStatus: true,
      downPaymentCents: true,
      holdReason: true,
      frozenAt: true,
      financing: { select: { downPaymentMethod: true } },
      pickup: {
        select: {
          vehiclePreparedAt: true,
          dealerReadinessChecklist: true,
          dueBillItems: true,
        },
      },
      tradeInSubmissions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { titleInHand: true, payoffGoodThroughDate: true, verifiedPayoffCents: true },
      },
      queueItems: {
        where: { status: "OPEN" },
        select: { id: true, exceptionCode: true },
      },
    },
  });

  if (!deal) {
    const item: ReadinessItem = {
      key: "deal",
      label: "The deal record could not be read",
      satisfied: false,
      owner: "OPERATIONS",
      detail: "Pickup readiness cannot be evaluated against a deal AutoLenis cannot load.",
      requiredAction: "Investigate the missing deal record before any handover is scheduled.",
      deadlineAt: null,
    };
    return { items: [item], outstanding: [item], ready: false };
  }

  const clock = deal.fundingClearedAt;
  const trade = deal.tradeInSubmissions[0] ?? null;
  const now = new Date();

  const mk = (
    key: string,
    label: string,
    owner: ReadinessOwner,
    satisfied: boolean,
    detail: string,
    requiredAction: string,
    notApplicable = false,
  ): ReadinessItem => ({
    key,
    label,
    satisfied: satisfied || notApplicable,
    owner,
    detail,
    requiredAction,
    deadlineAt: satisfied || notApplicable ? null : deadlineFor(owner, clock),
    ...(notApplicable ? { notApplicable: true } : {}),
  });

  const items: ReadinessItem[] = [
    // 1
    mk("VEHICLE_VIN_CONFIRMED", "Correct vehicle and VIN confirmed", "DEALERSHIP",
      Boolean(deal.vin && deal.vehicleYear && deal.vehicleMake && deal.vehicleModel),
      deal.vin ? "The vehicle is identified but its year, make or model is incomplete."
               : "No VIN is bound to this deal yet.",
      "The dealership confirms the exact VIN and vehicle description on the executed contract."),

    // 2 — a hold that has lapsed is not a vehicle that is gone, but it is no longer a vehicle
    //     anyone has promised to keep. Stage 16 asks whether it REMAINS available.
    mk("VEHICLE_AVAILABLE", "Vehicle remains available", "DEALERSHIP",
      !deal.vehicleHoldUntil || deal.vehicleHoldUntil > now,
      "The dealership's hold on this vehicle has lapsed and has not been re-confirmed.",
      "The dealership re-confirms the vehicle is still on the lot and extends the hold."),

    // 3
    mk("CONTRACT_EXECUTED", "Final contract fully executed and stored", "DEALERSHIP",
      Boolean(deal.dealerExecutedContractId),
      "The dealership's fully executed copy is not on file.",
      "The dealership uploads the countersigned contract."),

    // 4
    mk("FINANCING_COMPLETE", "Financing completed or cash confirmed", "FINANCE",
      Boolean(deal.financingCompletedAt),
      "Financing has not been recorded as completed, and cash has not been confirmed.",
      "AutoLenis Finance records the completed financing, or confirms the cash purchase."),

    // 5
    mk("FUNDING_CLEARED", "Funding cleared", "FINANCE",
      Boolean(deal.fundingClearedAt),
      "Funding clearance has not been recorded. No vehicle is released before it is.",
      "AutoLenis Finance completes the six-item funding clearance."),

    // 6 — either an arranged method on the financing record, or an explicit zero. A null down
    //     payment is unknown, not zero: "no money down" is a decision somebody made.
    mk("DOWN_PAYMENT_ARRANGED", "Down-payment arrangement confirmed", "BUYER",
      Boolean(deal.financing?.downPaymentMethod) || deal.downPaymentCents === 0,
      "How the down payment will be paid at the dealership has not been agreed.",
      "Confirm the down-payment amount and the method you will use at the dealership."),

    // 7
    mk("INSURANCE_VERIFIED", "Insurance verified or policy bound", "BUYER",
      INSURANCE_SATISFIED.includes(deal.insuranceStatus),
      "Proof of insurance has not been verified. An upload is not approval.",
      "Upload proof of insurance, or bind a policy, and wait for the review to clear."),

    // 8 — NOT APPLICABLE when there is no trade. A stale payoff quote is Stage 16's named
    //     failure ("with title and payoff status current"), not merely a missing one.
    mk("TRADE_PACKET_READY", "Trade packet ready for the dealership's inspection, with title and payoff status current", "BUYER",
      Boolean(trade && trade.titleInHand && trade.payoffGoodThroughDate && trade.payoffGoodThroughDate > now),
      !trade ? "" :
        !trade.titleInHand ? "The trade's title is not yet in hand."
        : !trade.payoffGoodThroughDate ? "The trade payoff has no good-through date."
        : "The trade payoff quote has expired and must be refreshed before clearance.",
      "Bring the trade title, both keys and the payoff letter; refresh the payoff quote if it has expired.",
      !trade),

    // 9 — a hold, a freeze, or an open exception. Stage 16 names disputes and cancellations;
    //     `queue_items` is where every §26 exception lands, so an OPEN one is "other hold".
    mk("NO_BLOCKING_HOLD", "No payment dispute, cancellation, or other hold", "OPERATIONS",
      !deal.holdReason && !deal.frozenAt && deal.queueItems.length === 0,
      deal.frozenAt ? "This deal is frozen pending release."
        : deal.holdReason ? `A hold is recorded on this deal: ${deal.holdReason}`
        : `${deal.queueItems.length} open exception(s) must be resolved before handover.`,
      "AutoLenis Operations resolves the open exception or lifts the hold."),

    // 10
    mk("VEHICLE_PREPARED", "Dealership confirms vehicle preparation is complete", "DEALERSHIP",
      Boolean(deal.pickup?.vehiclePreparedAt),
      "The dealership has not confirmed the vehicle is prepared for delivery.",
      "The dealership completes its preparation and marks the vehicle ready."),

    // 11
    mk("ACCESSORIES_PRESENT", "Promised equipment, keys, and accessories are present", "DEALERSHIP",
      dealerAttests(deal.pickup?.dealerReadinessChecklist, DEALER_READINESS_KEYS.accessories),
      "The dealership has not confirmed the promised equipment, keys and accessories are on hand.",
      "The dealership confirms every promised item, including the second key, is present."),

    // 12 — DOCUMENTED, not completed. An empty list is a documented list; a null is an
    //      unanswered question, and the two must not read alike.
    mk("DUE_BILL_DOCUMENTED", "Promised repairs and due-bill items are documented", "DEALERSHIP",
      deal.pickup?.dueBillItems !== null && deal.pickup?.dueBillItems !== undefined,
      "Promised repairs and due-bill items have not been written down. An empty list is an answer; silence is not.",
      "The dealership records every promised repair and due-bill item, or records that there are none."),

    // 13
    mk("DELIVERY_DOCUMENTS_READY", "Dealership delivery documents are ready", "DEALERSHIP",
      dealerAttests(deal.pickup?.dealerReadinessChecklist, DEALER_READINESS_KEYS.documents),
      "The dealership has not confirmed its delivery paperwork is ready.",
      "The dealership assembles the delivery documents for the appointment."),
  ];

  const outstanding = items.filter((i) => !i.satisfied && !i.notApplicable);
  return { items, outstanding, ready: outstanding.length === 0 };
}

/** Stage 16's count, asserted rather than trusted — a checklist that silently loses an item
 *  is a checklist that passes more deals than it should. */
export const STAGE_16_ITEM_COUNT = 13;


/**
 * Move a deal into §Stage 16's readiness state when, and only when, all thirteen hold.
 *
 * THIS IS THE DRIVER PHASE 8 REQUIRED BEFORE THE EDGE COULD OPEN. Its comment on
 * `FUNDING_PENDING` said so: "Phase 9 opens this edge together with the driver that guards it",
 * because Phase 7 had already paid for the alternative — Phase 6 opened an edge with no domain
 * caller, and `POST /api/admin/deals/[dealId]/action` (DEAL_STAGE_ADVANCED) resolves its target
 * at runtime, so an ops admin could take it non-forced and skip the gate it was waiting on.
 *
 * IDEMPOTENT AND NON-THROWING ON THE COMMON PATHS. A deal already at PICKUP_READINESS or beyond
 * is reported ready-to-schedule without a write; a deal that is not yet at FUNDING_PENDING is
 * simply not there yet, which is not an error.
 */
export async function enterPickupReadiness(
  dealId: string,
  actor: { actorId?: string | null; actorRole?: string } = {},
): Promise<{ evaluation: ReadinessEvaluation; entered: boolean; schedulable: boolean }> {
  const evaluation = await evaluatePickupReadiness(dealId);

  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { status: true } });
  if (!deal) return { evaluation, entered: false, schedulable: false };

  // Already past the gate. Re-evaluating is a read for display and not a reason to MOVE anything —
  // but it IS a reason to refuse scheduling, which this branch used to get wrong.
  //
  // It returned `schedulable: true` unconditionally, so an item that became false AFTER the deal
  // entered readiness — an exception raised, the dealership's vehicle hold lapsing — did not stop
  // the handover being booked. §Stage 16 says "Nothing is scheduled while any item is unmet", and
  // the state the deal happens to be in is not one of the thirteen items. Found by the Phase 9
  // adversarial review.
  if (deal.status === "PICKUP_READINESS") {
    return { evaluation, entered: false, schedulable: evaluation.ready };
  }
  if (deal.status === "PICKUP_SCHEDULED" || deal.status === "HANDOVER_PENDING" || deal.status === "COMPLETED") {
    return { evaluation, entered: false, schedulable: true };
  }
  if (deal.status !== "FUNDING_PENDING") return { evaluation, entered: false, schedulable: false };

  // §Stage 16 exit: "All items true; Deal moves to scheduling." Nothing moves while one is unmet.
  if (!evaluation.ready) return { evaluation, entered: false, schedulable: false };

  const { advanceDealStatus } = await import("@/lib/services/deal/deal.service");
  const moved = await advanceDealStatus(dealId, "PICKUP_READINESS", {
    actorId: actor.actorId ?? undefined,
    actorRole: actor.actorRole ?? "SYSTEM",
    reason: "All thirteen §Stage 16 readiness items satisfied",
    data: { pickupReadyAt: new Date() },
  });
  return { evaluation, entered: moved, schedulable: true };
}
