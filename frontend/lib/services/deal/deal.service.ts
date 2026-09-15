// lib/services/deal/deal.service.ts
// System 5 — Deal state machine
// Contract Shield IS a workflow gate:
// CONTRACT_PENDING → CONTRACT_REVIEW → CONTRACT_APPROVED → SIGNING_PENDING

import { prisma } from "@/lib/prisma";
import { DealStatus, InsuranceStatus, Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { emitDealStatusComms } from "../notifications/acquisition-comms";
import { emitDealCompletionEvent } from "./deal-completion-event.service";
import { buyerEnvelopeSelect } from "@/lib/services/esign/esign-schema-gate";

// Valid forward state transitions. CANCELLED/REFUNDED are handled separately in
// canTransition() because they are reachable from (almost) any state.
const TRANSITIONS: Record<DealStatus, DealStatus[]> = {
  PENDING: ["ACTIVE"],
  ACTIVE: ["FINANCING_PENDING"],
  FINANCING_PENDING: ["FEE_PENDING"],
  FEE_PENDING: ["FEE_PAID"],
  // §13-D28 (ruled 2026-09-15). Insurance is a PARALLEL track, requested AT the
  // contract request and never a gate on contract preparation — Stage 15: "Insurance
  // never blocks contract preparation; it blocks the vehicle leaving the lot."
  // The direct edge is the live path. INSURANCE_PENDING is retained so the deals
  // that were parked there before this phase are not stranded behind an edge that
  // vanished, and so a revert leaves every in-flight Deal in a legal state.
  FEE_PAID: ["CONTRACT_PENDING", "INSURANCE_PENDING"],
  INSURANCE_PENDING: ["CONTRACT_PENDING"],
  CONTRACT_PENDING: ["CONTRACT_REVIEW"],
  CONTRACT_REVIEW: ["CONTRACT_APPROVED", "CONTRACT_PENDING"], // Can re-submit
  CONTRACT_APPROVED: ["SIGNING_PENDING"],
  SIGNING_PENDING: ["SIGNED"],
  // §13-D29 (ruled 2026-09-15). "The transaction is not contract-executed merely
  // because the buyer signed" (Stage 13/14d). The buyer's signature no longer reaches
  // pickup: the dealership's fully executed copy must be stored first, which is what
  // DEALER_EXECUTED records. Closing this edge is the structural half of the
  // no-conditional-delivery rule — `force: true` still overrides it, and still says so
  // in DealStatusHistory, which is the difference between an override and a gap.
  SIGNED: ["DEALER_EXECUTED"],
  // A scheduled pickup may be marked complete directly (dealer QR scan / admin
  // override) or step through the intermediate PICKUP_COMPLETE state.
  PICKUP_SCHEDULED: ["PICKUP_COMPLETE", "COMPLETED"],
  PICKUP_COMPLETE: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: ["REFUNDED"],
  REFUNDED: [],
  // Phase 1 transaction spine (20261106000000). These seven states exist in the enum but
  // nothing in Phase 1 writes them and no transition INTO them is defined, so no transition
  // OUT of them is defined either. An empty list is fail-closed: canTransition() refuses to
  // leave a state whose exits have not been designed. The phases that own each state (the
  // deal-lifecycle waves) replace these with the real edges.
  // §13-D41, ruled 2026-09-13. Phase 6 creates every new Deal here, so leaving the exit list empty
  // would make each one stuck by construction: `canTransition` refuses to leave a state with no
  // edges, and only CANCELLED/REFUNDED are reachable from anywhere.
  //
  // PHASE 7 REPLACED THE DIRECT EDGE. Phase 6 wrote `DEALER_CONFIRMATION: ["FINANCING_PENDING"]`
  // with no domain caller and recorded that deliberately (§8.1f). Reading it at the start of
  // Phase 7 found it was NOT unreachable: `POST /api/admin/deals/[dealId]/action` with
  // `DEAL_STAGE_ADVANCED` resolves the target at runtime and reaches `advanceDealStatus`
  // NON-FORCED (`action/route.ts:65-79`), and two admin dropdowns offered `FINANCING_PENDING` as
  // the next stage for a `DEALER_CONFIRMATION` deal. An operations admin could therefore move a
  // deal past reaffirmation, the vehicle hold and the condition disclosure with an ordinary,
  // fully-legal transition — the gate Phase 7 exists to build, skippable by the surface most
  // likely to skip it.
  //
  // The path now runs through the two stages the document describes:
  //   Stage 10  DEALER_CONFIRMATION -> RECAP_PENDING   (dealer-reaffirmation.service)
  //   Stage 11  RECAP_PENDING       -> FINANCING_PENDING (deal-recap.service)
  // `force: true` still overrides both, and still audit-logs that it did — which is the whole
  // difference between an override and a gap.
  //
  // REVERT SAFETY IS UNCHANGED. `FINANCING_PENDING` stays reachable from the legacy entry
  // (`ACTIVE`, for deals created before Phase 6), so reverting Phase 7 leaves any in-flight Deal
  // in a legal state rather than stranded behind an edge that vanished.
  DEALER_CONFIRMATION: ["RECAP_PENDING"],
  RECAP_PENDING: ["FINANCING_PENDING"],
  DEALER_EXECUTED: ["FUNDING_PENDING"],
  // Stage 14's failure path is a FULL SEND-BACK, not a retry: "A financing change that
  // affects the contract sends the transaction back through recap confirmation, contract
  // generation, Contract Shield, and signatures. It never proceeds on a stale contract."
  // RECAP_PENDING is the head of that return path — from there the existing edges carry
  // the deal through FINANCING_PENDING -> FEE_PENDING -> FEE_PAID -> CONTRACT_PENDING and
  // the whole gauntlet runs again on the new numbers.
  //
  // There is deliberately NO edge to PICKUP_READINESS here. Phase 8 ends at "financing
  // completed and funding cleared" (Stage 14 Exit), recorded on the Deal as
  // `financing_completed_at` + `funding_cleared_at` — exactly what Stage 14's "Recorded"
  // list names. Moving a deal INTO readiness is Phase 9's checklist evaluation, and
  // Phase 7 already paid for the alternative: Phase 6 opened an edge with no domain
  // caller, and `POST /api/admin/deals/[dealId]/action` (DEAL_STAGE_ADVANCED) resolves
  // its target at runtime, so an ops admin could take the edge non-forced and skip the
  // gate it was waiting on. Phase 9 opens this edge together with the driver that guards it.
  FUNDING_PENDING: ["RECAP_PENDING"],
  PICKUP_READINESS: [],
  HANDOVER_PENDING: [],
  FROZEN_PENDING_RELEASE: [],
};

const TERMINAL: DealStatus[] = [DealStatus.COMPLETED, DealStatus.CANCELLED, DealStatus.REFUNDED];

// Insurance proof states that satisfy the RELEASE gate — the vehicle leaving the lot.
// Must stay in sync with the UI "satisfied" set (AdminBuyerCommandCenter.tsx and
// app/buyer/insurance/page.tsx).
//
// §13-D31 (ruled 2026-09-15). EXTERNAL_UPLOADED was in this list, so an upload was
// treated as approval: it satisfied the gate, advanced the Deal automatically, and
// passed release. Stage 15 is explicit — "An upload is not approval" — and names the
// only two states that permit release. An upload now means UNDER_REVIEW and waits for
// an Operations decision.
//
// Deals that already passed release on EXTERNAL_UPLOADED are NOT re-gated: the decision
// was acted on, and re-gating would mean telling a buyer whose vehicle was released that
// the release is now under review. They stand as history with an admin follow-up row.
export const INSURANCE_SATISFIED: InsuranceStatus[] = [
  InsuranceStatus.VERIFIED,
  InsuranceStatus.POLICY_BOUND,
];

// Insurance states that mean "the buyer has given us something and Operations owes a
// decision". EXTERNAL_UPLOADED is read as UNDER_REVIEW rather than migrated, so no
// historical row is rewritten (§13-D31).
export const INSURANCE_AWAITING_REVIEW: InsuranceStatus[] = [
  InsuranceStatus.EXTERNAL_UPLOADED,
  InsuranceStatus.UNDER_REVIEW,
];

// Terminal insurance failures. Either blocks release until corrected (Stage 15 fail path).
export const INSURANCE_BLOCKED: InsuranceStatus[] = [
  InsuranceStatus.REJECTED,
  InsuranceStatus.EXPIRED,
  InsuranceStatus.FAILED,
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
  // The arrival hooks below STILL run: `data` can carry the very fact they key on
  // (mark-paid writes feePaidAt on a deal an admin already parked at FEE_PAID).
  // Returning early here wrote the fact and never settled the ladder, stranding the
  // deal. Both hooks are themselves guarded and idempotent, so re-running them on a
  // no-op is free.
  if (deal.status === newStatus) {
    if (opts.data) await prisma.deal.update({ where: { id: dealId }, data: opts.data });
    await runArrivalHooks(dealId, newStatus, opts);
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
    // Another writer moved the deal between our read and our write. The winner's
    // arrival hooks can carry it SEVERAL hops (fee ladder → insurance gate), so the
    // target may no longer be reachable from where the deal now sits. That is not an
    // error — the work we wanted done was done by someone else — so report "did not
    // move" rather than throwing a DealTransitionError that would surface as a 500
    // on, say, a buyer double-clicking Continue. A genuinely illegal FIRST call
    // still throws at the guard above; only this lost-race path is forgiving.
    const fresh = await prisma.deal.findUnique({ where: { id: dealId }, select: { status: true } });
    if (!fresh) return false;
    if (fresh.status === newStatus) return false;
    if (!opts.force && !canTransition(fresh.status, newStatus)) return false;
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
  await runArrivalHooks(dealId, newStatus, opts);
  return true;
}

/**
 * Hooks that run when a deal ARRIVES on a stage whose gating fact may already be
 * satisfied. Each is narrow, guarded and idempotent, and the hook graph is acyclic
 * (FEE_PENDING → FEE_PAID → CONTRACT_PENDING, and the legacy INSURANCE_PENDING →
 * CONTRACT_PENDING for deals parked there before §13-D28), so the cascade terminates.
 * CONTRACT_PENDING drives no further transition — it dispatches requests — so it is the
 * terminus. `force` is deliberately NOT propagated: an admin override of one hop must
 * not silently force the rest of the ladder.
 */
async function runArrivalHooks(dealId: string, newStatus: DealStatus, opts: AdvanceOptions): Promise<void> {
  const actor = { actorId: opts.actorId, actorRole: opts.actorRole };
  if (newStatus === DealStatus.INSURANCE_PENDING) {
    await advanceOnInsuranceSatisfied(dealId, actor);
  }
  // Fee ladder, settled ON ARRIVAL. The only driver of FEE_PAID → INSURANCE_PENDING
  // was the Stripe webhook, so an admin "mark fee paid" stranded the deal at
  // FEE_PAID forever; and a fee paid while the deal was still BEFORE the fee stage
  // was banked (feePaidAt is also the duplicate-charge guard) but never advanced,
  // wedging the deal. Settling here means every driver — webhook, admin override,
  // repair route — completes the ladder identically. Each hop is a real recorded
  // transition rather than a forced skip. Bounded: FEE_PENDING → FEE_PAID →
  // INSURANCE_PENDING, and INSURANCE_PENDING cannot re-enter this branch.
  if (newStatus === DealStatus.FEE_PENDING || newStatus === DealStatus.FEE_PAID) {
    await settleFeeLadderIfPaid(dealId, actor);
  }
  // §Stage 11's recap is built ON ARRIVAL at RECAP_PENDING, for the same reason the fee ladder
  // settles here: the stage is reachable from the reaffirmation flow, from an admin correction and
  // from a `force` override, and a recap built at only one of those leaves the other two on a
  // stage with nothing to confirm. `buildRecap` is idempotent — a deal that already has a live
  // version returns it — so re-arrival is free. Dynamic import keeps the recap service out of the
  // deal service's module graph, which the outbox drain also loads.
  // Stage 13/14a: the contract request is "dispatched durably from the central transition
  // into contract-pending — not from an administrator's manual action". This is that
  // transition. Before this phase the ONLY thing that asked a dealership for a contract was
  // an admin typing CONTRACT_PENDING into `POST /api/admin/deals/[dealId]/action`, which sent
  // a deadline-free email; every other route into the stage — the fee ladder, the insurance
  // driver, the buyer's own upload — told the dealership nothing at all.
  //
  // Insurance is requested at the SAME moment (Stage 15 Entry: "Contract requested — insurance
  // is requested at the same moment so the buyer has time to bind"), which is the whole reason
  // §13-D28 took insurance off the contract-entry path: asking earlier and waiting later.
  //
  // Idempotent on re-arrival: CONTRACT_REVIEW → CONTRACT_PENDING is a legal edge (contract
  // re-submit), so a deal can arrive here more than once, and openContractRequest is keyed so
  // the second arrival neither duplicates the request nor restarts the 24-hour clock.
  if (newStatus === DealStatus.CONTRACT_PENDING) {
    try {
      const { openContractRequest } = await import("./contract-request.service");
      await openContractRequest({ dealId, actorId: opts.actorId, actorRole: opts.actorRole });
    } catch (err) {
      // Never throws onward: the transition is committed. A request that failed to dispatch is
      // repairable and is reported, not swallowed — and the overdue sweep will not invent one,
      // so this log is the only signal that a dealership was never asked.
      logger.error("arrival hook: contract request dispatch failed at CONTRACT_PENDING", {
        dealId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (newStatus === DealStatus.RECAP_PENDING) {
    try {
      const { buildRecap } = await import("./deal-recap.service");
      await buildRecap({ dealId });
    } catch (err) {
      // Never throws onward: the transition is committed and a recap that failed to build is a
      // repairable condition, not a reason to unwind the stage. Reported rather than swallowed.
      logger.error("arrival hook: recap build failed at RECAP_PENDING", {
        dealId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Fee-ladder driver: once the concierge fee is recorded as paid, carry the deal
 * from FEE_PENDING through FEE_PAID to CONTRACT_PENDING.
 *
 * §13-D28 changed the ladder's last rung. It used to end at INSURANCE_PENDING, and
 * insurance then gated entry to CONTRACT_PENDING — which Stage 15 forbids in as many
 * words: "Insurance never blocks contract preparation; it blocks the vehicle leaving
 * the lot." Insurance is now REQUESTED at CONTRACT_PENDING, in parallel, so the buyer
 * has the whole contract-and-signing window to bind coverage instead of the contract
 * waiting on them.
 *
 * `feePaidAt` is the authoritative "fee received" fact (written by the verified
 * Stripe webhook or by the audited admin override) and doubles as the
 * duplicate-charge guard — so a deal carrying it must never sit on an unpaid-fee
 * stage. Narrow and idempotent: acts only from FEE_PENDING/FEE_PAID, only when
 * feePaidAt is set, and each hop is guarded by expectedFrom so a concurrent writer
 * that moved the deal on is never dragged backwards. Never throws.
 */
export async function settleFeeLadderIfPaid(
  dealId: string,
  opts: { actorId?: string; actorRole?: string } = {},
): Promise<boolean> {
  try {
    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
      select: { status: true, feePaidAt: true, feeRefundedAt: true },
    });
    // A refunded fee is not a paid fee. The refund route deliberately leaves
    // feePaidAt set, so without this an ops user could never park a refunded deal
    // back on FEE_PENDING to re-collect — the ladder would instantly re-advance it.
    if (!deal?.feePaidAt || deal.feeRefundedAt) return false;

    const actor = { actorId: opts.actorId, actorRole: opts.actorRole ?? "SYSTEM", reason: "Concierge fee received" };
    let moved = false;

    if (deal.status === DealStatus.FEE_PENDING) {
      moved = await advanceDealStatus(dealId, DealStatus.FEE_PAID, { ...actor, expectedFrom: DealStatus.FEE_PENDING });
      // FEE_PAID re-enters this driver via the seam, which carries it to
      // CONTRACT_PENDING — so there is nothing further to do here.
      return moved;
    }
    if (deal.status === DealStatus.FEE_PAID) {
      moved = await advanceDealStatus(dealId, DealStatus.CONTRACT_PENDING, { ...actor, expectedFrom: DealStatus.FEE_PAID });
    }
    return moved;
  } catch (err) {
    logger.error("[deal] fee-ladder settle failed (non-fatal):", err);
    return false;
  }
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
    // Buyer-facing: the envelope is projected to the buyer allow-list, never the
    // full forensic record (§11 — see esign-schema-gate.BUYER_SAFE_ENVELOPE_SELECT).
    return prisma.deal.findFirst({
      where: { id: dealId, buyerId },
      include: { offer: { include: { dealer: true } }, contractScans: { orderBy: { scannedAt: "desc" }, take: 1 }, eSignEnvelopes: { select: buyerEnvelopeSelect() }, coBuyer: { select: { isRequiredSigner: true } }, pickup: true },
    });
  }
  return prisma.deal.findFirst({
    where: { buyerId, status: { notIn: [DealStatus.COMPLETED, DealStatus.CANCELLED, DealStatus.REFUNDED] } },
    include: { offer: { include: { dealer: true } }, contractScans: { orderBy: { scannedAt: "desc" }, take: 1 }, eSignEnvelopes: { select: buyerEnvelopeSelect() }, coBuyer: { select: { isRequiredSigner: true } }, pickup: true },
    orderBy: { createdAt: "desc" },
  });
}

/** Who cancelled. Defaults to SYSTEM so automated callers read unchanged. */
export interface CancelActor {
  actorId?: string | null;
  actorRole?: string | null;
}

/**
 * The ONE terminal cancellation path. Every cancel — automated or admin — goes
 * through here so a deal's status has exactly one writer.
 *
 * `force` bypasses only canTransition and the insurance hard-gate; the
 * compare-and-swap in advanceDealStatus runs regardless, so the guard that makes
 * this worth routing is retained. What force alone does NOT cover is the
 * lost-race branch: without a from-guard it re-resolves and would cancel a deal
 * that had just been completed by a concurrent writer, silently undoing a
 * finished purchase. `expectedFrom` pins the advance to the state actually
 * observed here, so losing the race declines instead of clobbering the winner.
 *
 * Returns whether the deal was actually cancelled, so a caller cannot report a
 * cancellation that a concurrent writer prevented.
 */
export async function cancelDeal(
  dealId: string,
  reason: string,
  actor: CancelActor = {},
): Promise<boolean> {
  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) throw new Error("Deal not found");

  const cancelled = await advanceDealStatus(dealId, DealStatus.CANCELLED, {
    reason,
    actorId: actor.actorId ?? undefined,
    actorRole: actor.actorRole ?? "SYSTEM",
    force: true,
    expectedFrom: deal.status,
  });

  // Nothing moved: the deal was already terminal, or another writer carried it
  // elsewhere between the read above and the swap. Announcing a cancellation that
  // did not happen is worse than staying quiet.
  if (!cancelled) return false;

  await prisma.buyerActivityEvent.create({
    data: { buyerId: deal.buyerId, eventType: "DEAL_CANCELLED", title: "Deal cancelled", metadata: { reason } },
  }).catch(() => {});
  return true;
}
