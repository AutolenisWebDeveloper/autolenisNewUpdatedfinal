// lib/services/deal/transition-authority.ts
//
// §28.3 #1 (authorization) and the §24 execution boundary, as two small pure
// decisions the deal seam can ask rather than assume.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
//
// `AdvanceOptions.actorRole` was an unconstrained optional `string` written
// straight into `deal_status_history.actor_role`. Two consequences, one of them
// already live:
//
//   1. THE AUDIT TRAIL HAD ALREADY DRIFTED. A repository-wide count found eleven
//      call sites passing `"BUYER"` and one passing `"buyer"`
//      (`app/api/public/request-vehicle/complete/route.ts`). §28.3 #6 requires the
//      actor to be recorded; a column that holds two spellings of the same actor
//      cannot be grouped, so the record exists and cannot be read.
//   2. NOTHING CHECKED WHETHER THE ACTOR MAY DRIVE THE TRANSITION AT ALL. The
//      transition table says which moves are legal; it never said who may make
//      them. §Stage 19 states the rule the table cannot express — "the Deal never
//      completes automatically on the dealer's word alone" — and that rule lived
//      only in the absence of an edge, which is why Phase 9 had to close the same
//      hole twice (the scan's direct edge, then the admin route's runtime target).
//
// The matrix below states it once, positively, so the next surface that resolves a
// target at runtime is checked by construction rather than by whoever remembers.
//
// ── THE EXECUTION BOUNDARY IS A FACT, NOT A STATUS ──────────────────────────
//
// §24: "After the dealership contract is fully executed, AutoLenis cannot
// unilaterally void it." Keying that on a STATUS list would be wrong twice over:
// `RECAP_PENDING` is reachable both before execution (Stage 11) and after it (a
// recap revision at funding), so no status list can separate the two; and a status
// is a claim about where a deal sits, while execution is a claim about the world.
//
// `Deal.dealerExecutedContractId` is that fact. `recordDealerExecution` sets it
// conditionally (`where: { id, dealerExecutedContractId: null }`,
// `dealer-execution.service.ts:199-201`) in the same flow that stores the executed
// copy and its hash. It is non-null exactly when a fully executed dealership
// contract exists — which is the sentence §24 is written about.
//
// This is the same distinction the owner drew on 2026-09-15 about `force`: an
// override may skip an ORDERING constraint, never a FACT. A cancellation after
// execution is not an ordering question.

import { DealStatus } from "@prisma/client";

/**
 * Who can be recorded as driving a deal transition.
 *
 * Deliberately NOT the admin `AdminRole` enum, and not `QueueOwnerRole`: this is
 * the party acting on the transaction, at the granularity
 * `deal_status_history.actor_role` has always stored. Narrowing to these four is
 * what makes the column groupable.
 */
export const TRANSACTION_ACTOR_ROLES = ["ADMIN", "BUYER", "DEALER", "SYSTEM"] as const;

export type TransactionActorRole = (typeof TRANSACTION_ACTOR_ROLES)[number];

export function isTransactionActorRole(value: unknown): value is TransactionActorRole {
  return typeof value === "string" && (TRANSACTION_ACTOR_ROLES as readonly string[]).includes(value);
}

/**
 * Normalise a legacy free-form actor role.
 *
 * Existing history rows hold whatever string was passed, and this function does
 * NOT rewrite them — settled history is never rewritten. It exists so a caller
 * migrating to the typed option can hand over what it had and get a typed value
 * or a refusal, rather than silently writing a third spelling.
 */
export function normaliseActorRole(value: string | null | undefined): TransactionActorRole | null {
  if (!value) return null;
  const upper = value.trim().toUpperCase();
  return isTransactionActorRole(upper) ? upper : null;
}

const ALL: readonly TransactionActorRole[] = TRANSACTION_ACTOR_ROLES;
/** The platform and an operator can drive any ordinary forward step. */
const AUTOMATED: readonly TransactionActorRole[] = ["SYSTEM", "ADMIN"];

/**
 * Which actors may move a Deal INTO each status. §28.3 #1.
 *
 * Read as "who is entitled to assert that this has happened". A dealership may
 * assert that it executed the contract, because it did; it may not assert that the
 * buyer took possession, because that is not its fact to state.
 *
 * `SYSTEM` covers webhooks, crons and reconcilers. `ADMIN` is present on every row
 * because an operator correcting a stuck transaction is the recovery path §28.3 #8
 * requires — and every admin route already carries its own role gate, a reason, and
 * an audit row on top of this.
 */
export const DEAL_TRANSITION_ACTORS: Record<DealStatus, readonly TransactionActorRole[]> = {
  PENDING: AUTOMATED,
  ACTIVE: AUTOMATED,
  // Stage 11's exit — `confirmRecap` passes `params.actor`, which is BUYER or DEALER.
  // Distinct from FUNDING_PENDING below, and that near-collision is exactly how the
  // first correction missed it: FUNDING_PENDING was fixed and this was not. The
  // caller-derived gate caught the half-fix.
  FINANCING_PENDING: ALL,
  // Money states are settled by Stripe through the webhook, never by a portal user.
  FEE_PENDING: AUTOMATED,
  FEE_PAID: AUTOMATED,
  INSURANCE_PENDING: AUTOMATED,
  CONTRACT_PENDING: AUTOMATED,
  CONTRACT_REVIEW: AUTOMATED,
  CONTRACT_APPROVED: AUTOMATED,
  // The buyer opening their envelope is what puts the deal into signing —
  // `buyer-signing.service.ts:587` and `app/api/buyer/esign/[dealId]/route.ts:170`
  // both drive this as BUYER, and they are right to.
  SIGNING_PENDING: ["SYSTEM", "ADMIN", "BUYER"],
  // The buyer's own signature completes signing.
  SIGNED: ["SYSTEM", "ADMIN", "BUYER"],
  // Stage 10 — the dealership reaffirms; Stage 14d — the dealership executes.
  DEALER_CONFIRMATION: ["SYSTEM", "ADMIN", "DEALER"],
  // JOINT-CONFIRMATION EDGES — both parties, and this is the correction the first
  // independent review caught.
  //
  // These three were `AUTOMATED` on the reasoning that a platform driver moves them.
  // That reasoning was wrong about this repository, and the matrix is a statement about
  // this repository. Stage 10's exit fires when the dealership reaffirms AND the buyer
  // acknowledges the disclosure — EITHER party's action can be the one that completes
  // it, so `advanceIfExitSatisfied` is called with "DEALER" (`:692`) and with the
  // buyer's id defaulting to "BUYER" (`:816`, `:880`). Stage 11's exit is the same
  // shape: `confirmRecap` passes `params.actor`, which is BUYER or DEALER. Stage 16's
  // readiness is entered from the pickup coordination path, which carries whichever
  // party acted.
  //
  // Refusing them broke the spine outright: no deal could leave DEALER_CONFIRMATION or
  // RECAP_PENDING at all, and the throw was unguarded so every reaffirmation would have
  // 500'd. `advance-deal-status-actor-callers.test.ts` now derives the required actors
  // from the CALL SITES so a matrix that contradicts the code cannot ship again.
  RECAP_PENDING: ALL,
  DEALER_EXECUTED: ["SYSTEM", "ADMIN", "DEALER"],
  FUNDING_PENDING: ALL,
  PICKUP_READINESS: ALL,
  // Scheduling is a negotiation: either party can land the confirmed appointment.
  PICKUP_SCHEDULED: ALL,
  // The dealership's scan records the handover — that much IS its fact to state.
  HANDOVER_PENDING: ["SYSTEM", "ADMIN", "DEALER"],
  // Retained but unreachable (§28.1 L1405); no writer, so no actor.
  PICKUP_COMPLETE: AUTOMATED,
  // §Stage 19: "the Deal never completes automatically on the dealer's word alone."
  // DEALER is absent BY RULE, not by oversight — this is the line Phase 9 closed
  // twice by removing edges, stated here so the third surface cannot reopen it.
  COMPLETED: ["SYSTEM", "ADMIN", "BUYER"],
  // A buyer may cancel their own transaction; a dealership may never cancel someone
  // else's. §24's "authorized actor".
  CANCELLED: ["SYSTEM", "ADMIN", "BUYER"],
  // Money out is Finance's, through the refund service.
  REFUNDED: AUTOMATED,
  // §24's coordination state. Entered by the orchestration or an operator, never by
  // a portal user — a buyer cannot place their own deal into a coordinated unwind.
  FROZEN_PENDING_RELEASE: AUTOMATED,
};

export class TransitionActorError extends Error {
  code = "ACTOR_NOT_PERMITTED";
  constructor(
    public readonly actorRole: TransactionActorRole,
    public readonly to: DealStatus,
  ) {
    super(
      `A ${actorRole} actor may not move a deal to ${to}. Permitted: ${DEAL_TRANSITION_ACTORS[to].join(", ")}.`,
    );
    this.name = "TransitionActorError";
  }
}

/** True when `actorRole` may drive a deal into `to`. */
export function actorMayDrive(actorRole: TransactionActorRole, to: DealStatus): boolean {
  return DEAL_TRANSITION_ACTORS[to].includes(actorRole);
}

/**
 * Refuse a transition the actor is not entitled to make.
 *
 * `force` does NOT relax this, and that asymmetry is deliberate. `force` overrides
 * the ORDER of the transition table — a judgement that a step may be skipped. Who
 * is entitled to act is not an ordering question, and a forced completion driven by
 * a dealership would be exactly the thing §Stage 19 forbids, arrived at through the
 * override instead of through the edge.
 */
export function assertActorMayDrive(actorRole: TransactionActorRole, to: DealStatus): void {
  if (!actorMayDrive(actorRole, to)) throw new TransitionActorError(actorRole, to);
}

/** The subset of a Deal the execution boundary is decided from. */
export interface ExecutionFacts {
  readonly dealerExecutedContractId: string | null;
}

/**
 * §24's boundary: has the dealership contract been fully executed?
 *
 * One fact, one reader, so "after execution" means the same thing everywhere.
 */
export function isContractExecuted(deal: ExecutionFacts): boolean {
  return deal.dealerExecutedContractId !== null;
}

/**
 * Where a cancellation request lands for this deal.
 *
 * Before execution a transaction can be cancelled. After it, §24 is explicit that
 * AutoLenis "cannot unilaterally void it" — the deal moves to
 * `FROZEN_PENDING_RELEASE` while the release is coordinated. That is a coordination
 * state, not a cancellation, and the difference is visible to the buyer, the
 * dealership and Operations alike.
 */
export function cancellationTargetFor(
  deal: ExecutionFacts,
): typeof DealStatus.CANCELLED | typeof DealStatus.FROZEN_PENDING_RELEASE {
  return isContractExecuted(deal) ? DealStatus.FROZEN_PENDING_RELEASE : DealStatus.CANCELLED;
}
