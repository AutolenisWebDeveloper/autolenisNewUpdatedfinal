// lib/services/deal/deal.service.ts
// System 5 — Deal state machine
// Contract Shield IS a workflow gate:
// CONTRACT_PENDING → CONTRACT_REVIEW → CONTRACT_APPROVED → SIGNING_PENDING

import { prisma } from "@/lib/prisma";
import { DealStatus, InsuranceStatus, Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
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
  /**
   * Only advance when the deal is in THIS state; otherwise no-op.
   *
   * Without it a caller that observed state X and then called in is re-resolved
   * against whatever the deal became — and if that new state also legally reaches
   * `newStatus`, the deal is written BACKWARDS. Concretely: an insurance-gate
   * driver that observed INSURANCE_PENDING could pull a deal that had already
   * reached CONTRACT_REVIEW back to CONTRACT_PENDING, because contract re-submit
   * makes that transition legal. Set this whenever the advance is only correct
   * from a specific observed state.
   */
  expectedFrom?: DealStatus;
}

/**
 * Single guarded seam for every deal lifecycle transition.
 * - Rejects illegal transitions with DealTransitionError unless `force` is set.
 * - Enforces the insurance hard-gate before COMPLETED unless `force` is set.
 * - Writes DealStatusHistory + a buyer activity event.
 *
 * Resolves to TRUE only when this call performed the transition; FALSE on every
 * no-op path (already in the target state, or `expectedFrom` did not match). Most
 * callers can ignore it; drivers that report whether they advanced must not.
 */
export async function advanceDealStatus(
  dealId: string,
  newStatus: DealStatus,
  opts: AdvanceOptions = {},
): Promise<boolean> {
  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) throw new Error("Deal not found");

  // Idempotent no-op when already in the target state (still merge extra data).
  if (deal.status === newStatus) {
    if (opts.data) await prisma.deal.update({ where: { id: dealId }, data: opts.data });
    return false;
  }

  // From-guard: the caller asserted this advance is only correct out of a specific
  // state. Checked here AND on the post-race re-resolve below, so a deal that moved
  // on under us is never dragged backwards into `newStatus`.
  if (opts.expectedFrom && deal.status !== opts.expectedFrom) return false;

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

  // Insurance gate, re-checked ON ARRIVAL. upload-proof has no deal-status check, so
  // a buyer can submit proof before the deal ever reaches INSURANCE_PENDING — at
  // which point the gate driver no-ops. Without this the deal then parks at
  // INSURANCE_PENDING with proof already on file: exactly the stall the driver
  // exists to prevent. Checked here rather than at each caller because the drivers
  // of this edge (service-fee, the Stripe webhook, admin repair) are easy to add to
  // and easy to forget. Bounded: the follow-on advance targets CONTRACT_PENDING, so
  // it cannot re-enter this branch.
  if (newStatus === DealStatus.INSURANCE_PENDING) {
    await advanceOnInsuranceSatisfied(dealId, { actorId: opts.actorId, actorRole: opts.actorRole });
  }
  return true;
}

/**
 * Insurance-gate driver: once proof of insurance is on file, release the deal from
 * INSURANCE_PENDING into CONTRACT_PENDING — the stage where the dealer is asked to
 * upload the purchase contract.
 *
 * This edge previously had no automatic driver. The admin repair route set
 * insuranceStatus and advanced explicitly, but the only buyer-facing insurance path
 * (POST /api/buyer/insurance/upload-proof) wrote insuranceStatus directly and never
 * advanced — so every self-service deal stalled at INSURANCE_PENDING until a human
 * noticed. This is the seam that closes that gap.
 *
 * Deliberately narrow and self-healing:
 *  • advances ONLY from INSURANCE_PENDING (never skips a stage, never rewinds one),
 *  • only when insuranceStatus is in INSURANCE_SATISFIED (the gate still holds),
 *  • routed through advanceDealStatus, so the CAS, history, and comms all apply,
 *  • idempotent — a second call is a no-op,
 *  • never throws: capturing the buyer's insurance proof must not fail because the
 *    follow-on advance did. Safe to call after any insurance write and on any later
 *    read, so a deal that reached a satisfied state by another path still converges.
 *
 * Returns true only when THIS call performed the advance.
 */
export async function advanceOnInsuranceSatisfied(
  dealId: string,
  opts: { actorId?: string; actorRole?: string } = {},
): Promise<boolean> {
  try {
    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
      select: { status: true, insuranceStatus: true },
    });
    if (!deal) return false;
    if (deal.status !== DealStatus.INSURANCE_PENDING) return false;
    if (!INSURANCE_SATISFIED.includes(deal.insuranceStatus)) return false;

    const advanced = await advanceDealStatus(dealId, DealStatus.CONTRACT_PENDING, {
      actorId: opts.actorId,
      actorRole: opts.actorRole ?? "SYSTEM",
      reason: `Insurance proof on file (${deal.insuranceStatus})`,
      // Only out of INSURANCE_PENDING. CONTRACT_REVIEW → CONTRACT_PENDING is also
      // legal (contract re-submit), so without this a concurrent writer that had
      // already carried the deal into review would see it dragged back here.
      expectedFrom: DealStatus.INSURANCE_PENDING,
    });
    // Report what actually happened: the from-guard may have declined the advance
    // because a concurrent writer already carried the deal forward.
    return advanced;
  } catch (err) {
    logger.error("[deal] insurance-gate advance failed (non-fatal):", err);
    return false;
  }
}

export async function getDealForBuyer(buyerId: string, dealId?: string) {
  if (dealId) {
    return prisma.deal.findFirst({
      where: { id: dealId, buyerId },
      include: { offer: { include: { dealer: true } }, contractScans: { orderBy: { scannedAt: "desc" }, take: 1 }, eSignEnvelope: true, pickup: true },
    });
  }
  return prisma.deal.findFirst({
    where: { buyerId, status: { notIn: [DealStatus.COMPLETED, DealStatus.CANCELLED, DealStatus.REFUNDED] } },
    include: { offer: { include: { dealer: true } }, contractScans: { orderBy: { scannedAt: "desc" }, take: 1 }, eSignEnvelope: true, pickup: true },
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
