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
import { PICKUP_SAFE_SELECT } from "@/lib/services/pickup/pickup-select";

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
  // PHASE 9 CLOSED THE DIRECT EDGE — §8.2 defect (8). `PICKUP_SCHEDULED → COMPLETED` let a
  // dealer's scan complete a Deal on the dealership's word alone, which §Stage 19 forbids in
  // as many words: "the Deal never completes automatically on the dealer's word alone." The
  // scan now records HANDOVER, and the buyer's possession confirmation completes.
  //
  // `PICKUP_SCHEDULED → PICKUP_COMPLETE` went with it, and that one is worth naming because it
  // had no writer and looked harmless. Phase 7 paid for exactly that reasoning: an edge with no
  // domain caller is NOT unreachable while `POST /api/admin/deals/[dealId]/action`
  // (DEAL_STAGE_ADVANCED) resolves its target at runtime. Left open, it was a two-hop route
  // from a scheduled pickup to COMPLETED that skipped handover entirely.
  PICKUP_SCHEDULED: ["HANDOVER_PENDING"],
  // RETAINED, DELIBERATELY UNREACHABLE. §28.1 L1405 retires PICKUP_COMPLETE to "a
  // supporting-record fact rather than a primary state", so Phase 9 gives it no writer and no
  // inbound edge. The exit stays open so any historical row parked here can still reach
  // COMPLETED rather than being stranded by an edge that vanished. Phase 10 owns its removal.
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
  // FUNDING_PENDING reaches pickup, and this edge is BOTH halves of the rule at once.
  //
  // WHAT IT RESTORES. Closing `SIGNED → PICKUP_SCHEDULED` above removed the only inbound
  // edge PICKUP_SCHEDULED had, so pickup-coordination.service.ts's non-forced advance threw
  // for every deal and no buyer could ever confirm a pickup. That was a capability REMOVED,
  // not moved — found by the independent review, and the reason the capability map now names
  // where pickup moved TO rather than only what it moved from.
  //
  // WHAT IT ENFORCES. Pickup is now reachable ONLY from FUNDING_PENDING, which is only
  // reachable from DEALER_EXECUTED, which is only reachable from SIGNED. The rung before it
  // is the six-item clearance list. That is strictly STRONGER than what this repository had
  // before Phase 8 — a buyer's signature reached pickup directly — and it is what makes "no
  // vehicle is released on the expectation that financing will complete later" a property of
  // the graph rather than a promise in a comment.
  //
  // Phase 9 owns PICKUP_READINESS and will insert it between these two; it is deliberately
  // still `[]` below, so this phase ships no readiness path it does not own.
  // PHASE 9 INSERTED PICKUP_READINESS BETWEEN THESE TWO, which is what the comment above
  // anticipated. `FUNDING_PENDING → PICKUP_SCHEDULED` is REPLACED rather than kept alongside:
  // §Stage 16's exit is "all items true; Deal moves to scheduling" and its failure clause is
  // "nothing is scheduled while any item is unmet", so a second edge that reaches scheduling
  // without evaluating the thirteen is the rule with a hole in it. The capability MOVED — every
  // deal still reaches PICKUP_SCHEDULED, one rung later.
  FUNDING_PENDING: ["RECAP_PENDING", "PICKUP_READINESS"],
  PICKUP_READINESS: ["PICKUP_SCHEDULED"],
  HANDOVER_PENDING: ["COMPLETED"],
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

/**
 * A final-release gate other than insurance refused.
 *
 * Separate from InsuranceRequiredError because the two are told to different people: an
 * insurance gap is the buyer's to close, while an uncleared funding or a missing executed
 * contract is AutoLenis's and the dealership's. A caller that cannot tell them apart cannot
 * say who has to act, which is the whole complaint §Stage 14 makes about "funding pending".
 */
export class ReleaseNotClearedError extends Error {
  constructor(public readonly detail: string) {
    super(`This deal is not cleared for release: ${detail}.`);
    this.name = "ReleaseNotClearedError";
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
/**
 * The statuses a Deal may not ENTER without all three release facts.
 *
 * PHASE 8 GATED ONLY `COMPLETED`, AND THAT WAS ONE OF THREE. Parity row C-40 specified the
 * preconditions belong "inside `advanceDealStatus` for PICKUP_READINESS/PICKUP_SCHEDULED/
 * COMPLETED"; Phase 8 implemented `COMPLETED` alone and its §8.1h record called the rule
 * structural. It was structural at the last rung only. Nothing read `funding_cleared_at` when a
 * deal LEFT `FUNDING_PENDING`, so a deal whose funding had never cleared could legally reach
 * `PICKUP_SCHEDULED` — the state whose entire meaning is that a vehicle is about to be handed
 * over — and be stopped only at the final write.
 *
 * `HANDOVER_PENDING` is added to C-40's three because Phase 9 created it, and it is the rung
 * where the vehicle PHYSICALLY MOVES. Gating completion but not handover would gate the
 * paperwork and not the car.
 *
 * §Stage 16's entry condition is these three facts verbatim — "contract executed, financing
 * completed, funding cleared, insurance verified" — so gating `PICKUP_READINESS` on them is not
 * an extra rule, it is Stage 16's own entry, enforced where it cannot be skipped.
 */
export const RELEASE_GATED_STATUSES: DealStatus[] = [
  DealStatus.PICKUP_READINESS,
  DealStatus.PICKUP_SCHEDULED,
  DealStatus.HANDOVER_PENDING,
  DealStatus.COMPLETED,
];

/**
 * The three hard release gates, checked against the row AS READ.
 *
 * Exported so the one completion writer enforces the SAME check inside its transaction rather
 * than a second copy that can drift. Throws; never returns false.
 */
export function assertReleaseGates(deal: {
  insuranceStatus: InsuranceStatus;
  dealerExecutedContractId: string | null;
  fundingClearedAt: Date | null;
}): void {
  if (!INSURANCE_SATISFIED.includes(deal.insuranceStatus)) {
    throw new InsuranceRequiredError();
  }
  // §14d — the dealership's fully executed copy must exist. A buyer's signature is not
  // execution, and a vehicle is not released against a contract only one party signed.
  if (!deal.dealerExecutedContractId) {
    throw new ReleaseNotClearedError("the dealership's fully executed contract is not on file");
  }
  // §Stage 14 — THE HARD RULE. No conditional delivery, no spot delivery. Funding is cleared
  // against evidence before the vehicle moves, never on the expectation that it will complete
  // later.
  if (!deal.fundingClearedAt) {
    throw new ReleaseNotClearedError("funding has not been cleared for this deal");
  }
}

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

  // Final-release hard gates. Insurance was the only one, and that was the defect: the
  // dealer QR scan advances straight to COMPLETED, so a deal that reached PICKUP_SCHEDULED
  // by any means could be released with financing still IN_PROGRESS and funding never
  // cleared. The transition map alone could not stop it, because `force: true` exists and
  // `schedulePickup` used it. These three run at WRITE time, on the row as read, so they
  // hold whatever route got the deal here.
  if (RELEASE_GATED_STATUSES.includes(newStatus) && !opts.force) {
    assertReleaseGates(deal);
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
  // §27.1 "Buyer signatures completed → Dealership → Dealer execution request". Driven from
  // the ARRIVAL at SIGNED rather than from the signing route, for the same reason the contract
  // request is driven from CONTRACT_PENDING: SIGNED is reachable from the buyer's ceremony, the
  // co-buyer's, an admin correction and a `force` override, and a request sent from only one of
  // them leaves the other three with a dealership that was never asked to execute.
  //
  // After §13-D30, arriving at SIGNED already means EVERY required signer completed —
  // `ensureDealSigned` will not advance otherwise — so this cannot fire on a half-signed deal.
  if (newStatus === DealStatus.SIGNED) {
    try {
      const { requestDealerExecution } = await import("./dealer-execution.service");
      await requestDealerExecution(dealId);
    } catch (err) {
      logger.error("arrival hook: dealer execution request failed at SIGNED", {
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
      include: { offer: { include: { dealer: true } }, contractScans: { orderBy: { scannedAt: "desc" }, take: 1 }, eSignEnvelopes: { select: buyerEnvelopeSelect() }, coBuyer: { select: { isRequiredSigner: true } }, pickup: { select: PICKUP_SAFE_SELECT } },
    });
  }
  return prisma.deal.findFirst({
    where: { buyerId, status: { notIn: [DealStatus.COMPLETED, DealStatus.CANCELLED, DealStatus.REFUNDED] } },
    include: { offer: { include: { dealer: true } }, contractScans: { orderBy: { scannedAt: "desc" }, take: 1 }, eSignEnvelopes: { select: buyerEnvelopeSelect() }, coBuyer: { select: { isRequiredSigner: true } }, pickup: { select: PICKUP_SAFE_SELECT } },
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
