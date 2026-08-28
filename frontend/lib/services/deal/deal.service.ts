// lib/services/deal/deal.service.ts
// System 5 — Deal state machine
// Contract Shield IS a workflow gate:
// CONTRACT_PENDING → CONTRACT_REVIEW → CONTRACT_APPROVED → SIGNING_PENDING

import { prisma } from "@/lib/prisma";
import { esignEnvelopeSelect } from "@/lib/services/esign/envelope-schema";
import { DealStatus, InsuranceStatus, Prisma } from "@prisma/client";
import { emitDealStatusComms } from "../notifications/acquisition-comms";
import { emitDealCompletionEvent } from "./deal-completion-event.service";

// Valid forward state transitions. CANCELLED/REFUNDED are handled separately in
// canTransition() because they are reachable from (almost) any state.
const TRANSITIONS: Record<DealStatus, DealStatus[]> = {
  PENDING: ["ACTIVE"],
  ACTIVE: ["FINANCING_PENDING"],
  FINANCING_PENDING: ["FEE_PENDING"],
  FEE_PENDING: ["FEE_PAID"],
  FEE_PAID: ["INSURANCE_PENDING"],
  INSURANCE_PENDING: ["CONTRACT_PENDING"],
  CONTRACT_PENDING: ["CONTRACT_REVIEW"],
  CONTRACT_REVIEW: ["CONTRACT_APPROVED", "CONTRACT_PENDING"], // Can re-submit
  CONTRACT_APPROVED: ["SIGNING_PENDING"],
  SIGNING_PENDING: ["SIGNED"],
  SIGNED: ["PICKUP_SCHEDULED"],
  // A scheduled pickup may be marked complete directly (dealer QR scan / admin
  // override) or step through the intermediate PICKUP_COMPLETE state.
  PICKUP_SCHEDULED: ["PICKUP_COMPLETE", "COMPLETED"],
  PICKUP_COMPLETE: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: ["REFUNDED"],
  REFUNDED: [],
};

const TERMINAL: DealStatus[] = [DealStatus.COMPLETED, DealStatus.CANCELLED, DealStatus.REFUNDED];

// Insurance proof states that satisfy the final-release gate. Must stay in sync
// with the UI "satisfied" set (components/.../AdminBuyerCommandCenter.tsx and
// app/buyer/insurance/page.tsx). EXTERNAL_UPLOADED is the buyer's own-policy fallback.
export const INSURANCE_SATISFIED: InsuranceStatus[] = [
  InsuranceStatus.VERIFIED,
  InsuranceStatus.POLICY_BOUND,
  InsuranceStatus.EXTERNAL_UPLOADED,
];

export class DealTransitionError extends Error {
  code = "INVALID_TRANSITION";
  constructor(public readonly from: DealStatus, public readonly to: DealStatus) {
    super(`Invalid transition: ${from} → ${to}`);
    this.name = "DealTransitionError";
  }
}

export class InsuranceRequiredError extends Error {
  code = "INSURANCE_REQUIRED";
  constructor() {
    super("Insurance proof is required before the deal can be completed");
    this.name = "InsuranceRequiredError";
  }
}

export function canTransition(from: DealStatus, to: DealStatus): boolean {
  if (from === to) return false;
  // Cancellation is allowed from any non-terminal state.
  if (to === DealStatus.CANCELLED) return !TERMINAL.includes(from);
  // Refund is allowed from CANCELLED, or directly from any non-terminal state.
  if (to === DealStatus.REFUNDED) return from === DealStatus.CANCELLED || !TERMINAL.includes(from);
  return TRANSITIONS[from]?.includes(to) ?? false;
}

interface AdvanceOptions {
  actorId?: string;
  actorRole?: string;
  reason?: string;
  /** Bypass the transition + insurance guards (intentional admin override). Still audit-logged. */
  force?: boolean;
  /** Extra deal fields to write atomically alongside the status change. */
  data?: Prisma.DealUpdateInput;
}

/**
 * Single guarded seam for every deal lifecycle transition.
 * - Rejects illegal transitions with DealTransitionError unless `force` is set.
 * - Enforces the insurance hard-gate before COMPLETED unless `force` is set.
 * - Writes DealStatusHistory + a buyer activity event.
 */
export async function advanceDealStatus(
  dealId: string,
  newStatus: DealStatus,
  opts: AdvanceOptions = {},
): Promise<void> {
  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) throw new Error("Deal not found");

  // Idempotent no-op when already in the target state (still merge extra data).
  if (deal.status === newStatus) {
    if (opts.data) await prisma.deal.update({ where: { id: dealId }, data: opts.data });
    return;
  }

  if (!opts.force && !canTransition(deal.status, newStatus)) {
    throw new DealTransitionError(deal.status, newStatus);
  }

  // Insurance hard-gate: final release requires proof on file (or explicit override).
  if (newStatus === DealStatus.COMPLETED && !opts.force) {
    if (!INSURANCE_SATISFIED.includes(deal.insuranceStatus)) {
      throw new InsuranceRequiredError();
    }
  }

  // Compare-and-swap: advance ONLY while the deal is still in the state we read
  // and guarded against. This serializes concurrent transitions without a row
  // lock (the same optimistic CAS the pickup-coordination and deposit-state
  // machines use). The loser of a race matches 0 rows and re-resolves once from
  // the fresh state — so everything below (history, comms, the exactly-once
  // completion event) runs for the WINNING transition only. Autopilot fires the
  // same transition from a webhook, a cron reconciler, and an admin action; this
  // is what keeps "COMPLETED" (and every other advance) idempotent under replay.
  const swap = await prisma.deal.updateMany({
    where: { id: dealId, status: deal.status },
    data: { status: newStatus, ...(opts.data ?? {}) },
  });
  if (swap.count === 0) {
    // Another writer moved the deal between our read and our write. Re-resolve
    // against the fresh state: if it already reached the target this collapses to
    // the idempotent no-op at the top; otherwise the guard re-checks legality.
    return advanceDealStatus(dealId, newStatus, opts);
  }

  await prisma.dealStatusHistory.create({
    data: {
      dealId,
      fromStatus: deal.status,
      toStatus: newStatus,
      actorId: opts.actorId ?? null,
      actorRole: opts.actorRole ?? null,
      reason: opts.reason ?? (opts.force ? "force override" : null),
    },
  }).catch(() => {});

  // Log activity
  await prisma.buyerActivityEvent.create({
    data: {
      buyerId: deal.buyerId,
      eventType: "DEAL_STAGE_CHANGED",
      title: `Deal moved to ${newStatus.replace(/_/g, " ").toLowerCase()}`,
      metadata: { from: deal.status, to: newStatus },
    },
  }).catch(() => {});

  // Proactive, consent-aware customer communication for this transition. This is
  // the single seam that keeps the buyer informed across the entire post-acceptance
  // lifecycle (financing → fee → insurance → contract → signing → pickup →
  // completion / refund). Best-effort and idempotent: emitDealStatusComms never
  // throws and de-dupes per (deal, status, buyer), so a retried or concurrent
  // transition cannot double-message the customer.
  await emitDealStatusComms(dealId, newStatus);

  // Canonical completion condition — emitted EXACTLY ONCE, here at the seam, the
  // moment a deal enters COMPLETED. The CAS above guarantees only the winning
  // transition reaches this line, so a replay/concurrent completion cannot
  // double-emit. This is the single completion event Program 5 (Affiliate Growth
  // + Settlement) consumes; individual completion routes no longer emit it.
  // Best-effort: emitDealCompletionEvent never throws (the deal is committed).
  if (newStatus === DealStatus.COMPLETED) {
    await emitDealCompletionEvent(dealId);
  }
}

export async function getDealForBuyer(buyerId: string, dealId?: string) {
  if (dealId) {
    return prisma.deal.findFirst({
      where: { id: dealId, buyerId },
      include: { offer: { include: { dealer: true } }, contractScans: { orderBy: { scannedAt: "desc" }, take: 1 }, eSignEnvelope: { select: esignEnvelopeSelect() }, pickup: true },
    });
  }
  return prisma.deal.findFirst({
    where: { buyerId, status: { notIn: [DealStatus.COMPLETED, DealStatus.CANCELLED, DealStatus.REFUNDED] } },
    include: { offer: { include: { dealer: true } }, contractScans: { orderBy: { scannedAt: "desc" }, take: 1 }, eSignEnvelope: { select: esignEnvelopeSelect() }, pickup: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function cancelDeal(dealId: string, reason: string): Promise<void> {
  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) throw new Error("Deal not found");

  // Route the status change through the guarded seam (records DealStatusHistory).
  // Force is used so an already-cancelled/terminal deal does not throw here.
  await advanceDealStatus(dealId, DealStatus.CANCELLED, { reason, actorRole: "SYSTEM", force: true });

  await prisma.buyerActivityEvent.create({
    data: { buyerId: deal.buyerId, eventType: "DEAL_CANCELLED", title: "Deal cancelled", metadata: { reason } },
  }).catch(() => {});
}
