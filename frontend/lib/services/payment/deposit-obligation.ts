// lib/services/payment/deposit-obligation.ts
//
// THE ONE ANSWER TO "does this buyer already owe, or already have, a $99 on this
// Vehicle Request?" — asked of STRIPE, not of our own `Deposit.status`.
//
// §5d: "Before creating another intent, query Stripe for an existing succeeded or
// in-flight obligation. A buyer is never charged twice because local webhook state
// is stale." The emphasis is the requirement. Production has recorded webhook gaps,
// so `Deposit.status` can say PENDING for money that settled days ago; a duplicate
// guard that reads only our own column is guarding against the wrong thing.
//
// The shape here is: our rows are the INDEX (they are how we know which intents
// exist), and Stripe is the AUTHORITY on each one. Nothing decides "already paid"
// from a local column.
//
// WHY THIS MODULE EXISTS AT ALL. Four paths mint a $99 obligation — the buyer
// route, admin create-intent, admin send-link, and the reconciler's view of what is
// outstanding — and before Phase 3 they disagreed about what an existing obligation
// even was. The buyer route did a point lookup on the single newest PENDING/PAID row
// and asked Stripe about it; admin create-intent did nothing at all and always minted
// a fresh intent AND a fresh Deposit row; send-link looked only for a PENDING row, so
// a buyer who had already PAID got a second Checkout Session. Three answers to one
// question is how a buyer gets charged twice.

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { retrievePaymentIntent } from "@/lib/services/payment/stripe.service";
import { DEAD_INTENT_FROM } from "@/lib/payments/deposit-state";
import type { Deposit, Prisma } from "@prisma/client";

type Db = typeof prisma | Prisma.TransactionClient;

/** Ids we mint ourselves rather than receive from Stripe. Never ask the provider about one. */
export const SYNTHETIC_INTENT_PREFIXES = ["pi_sandbox_mock_", "pi_admin_", "pi_fee_admin_"] as const;

export function isSyntheticIntentId(id: string | null | undefined): boolean {
  return !!id && SYNTHETIC_INTENT_PREFIXES.some((p) => id.startsWith(p));
}

/**
 * What Stripe's PaymentIntent.status means for the question "is this obligation
 * still open?".
 *
 * Deliberately NOT `classifyPaymentConfirmation`. That function answers a different
 * question — what may the buyer truthfully be TOLD — and collapses every
 * non-success, non-processing status into "failed". For a duplicate-charge guard
 * that collapse is exactly wrong: `requires_payment_method` (the state a declined
 * card leaves behind) is a LIVE intent the buyer can still pay, while `canceled` is
 * a dead one. Treating them alike is what let a decline look like a closed
 * obligation and invited the second charge.
 */
export type IntentLiveness = "SETTLED" | "SETTLING" | "IN_FLIGHT" | "DEAD" | "UNKNOWN";

export function classifyIntentLiveness(status: string | null | undefined): IntentLiveness {
  switch (status) {
    case "succeeded":
      return "SETTLED";
    // `processing` is NOT reusable. The bank is confirming a charge the buyer has
    // already authorised, so the money is very likely moving; handing this intent
    // back to a card form invites a second attempt on top of it. It is separated
    // from IN_FLIGHT for that one reason, and it blocks.
    case "processing":
      return "SETTLING";
    case "requires_payment_method": // declined, or not yet supplied — retryable on this same intent
    case "requires_confirmation":
    case "requires_action":
    case "requires_capture":
      return "IN_FLIGHT";
    case "canceled":
      return "DEAD";
    default:
      return "UNKNOWN";
  }
}

export type DepositObligation =
  /** Stripe says a charge for this obligation SUCCEEDED. Never mint another. */
  | { kind: "SETTLED"; deposit: Deposit; paymentIntentId: string; intentStatus: string }
  /** The bank is confirming. Money is probably moving; do not offer a second attempt. */
  | { kind: "SETTLING"; deposit: Deposit; paymentIntentId: string; intentStatus: string }
  /**
   * Our row says PAID and the provider does not agree — either because it reports that
   * intent as unpaid, or because there is no provider reference to check at all.
   *
   * Neither may be acted on silently. Minting charges a buyer whose own record says
   * they have already paid; reusing lets a "settled" deposit be paid a second time.
   * Both producers are real and both come from the same place — the admin paths:
   * `deposit/override` writes PAID with no PaymentIntent, and the old create-intent
   * fallback wrote a synthetic `pi_admin_` id Stripe never issued.
   *
   * `paymentIntentId`/`intentStatus` are null in the unverifiable case. That is the
   * distinction, and it is kept rather than flattened because "Stripe says unpaid" and
   * "there is nothing to ask Stripe about" need different handling by Finance.
   */
  | {
      kind: "CONTRADICTION";
      deposit: Deposit;
      paymentIntentId: string | null;
      intentStatus: string | null;
      reason: string;
    }
  /** A live intent exists. Reuse it — do not create a parallel one. */
  | { kind: "IN_FLIGHT"; deposit: Deposit; paymentIntentId: string; intentStatus: string }
  /**
   * A row exists but carries no provider reference we can check (an admin-minted
   * synthetic id, or a send-link row whose session never produced an intent). It is
   * reusable as a record but proves nothing about the money, so callers must attach
   * a real intent to THIS row rather than inserting another.
   */
  | { kind: "UNVERIFIABLE"; deposit: Deposit; reason: string }
  /**
   * Stripe could not be reached for a row that has a real intent id. FAIL CLOSED:
   * the caller must refuse to mint rather than risk a second charge. "The provider
   * was down" is not evidence that nothing is owed.
   */
  | { kind: "PROVIDER_UNREACHABLE"; deposit: Deposit; paymentIntentId: string }
  /**
   * Nothing outstanding. The caller may mint.
   *
   * `deadDepositIds` are rows whose PaymentIntent Stripe reports as `canceled`. They
   * are handed back rather than discarded because this is the only place that learns
   * the fact, and a caller about to mint is the only place it is worth acting on: the
   * row should be retired to FAILED so it stops being re-examined (a Stripe round-trip
   * per call) and stops drawing deposit-reminder touches for money that can no longer
   * be paid. `payment_intent.canceled` normally does this; these are the rows whose
   * event was missed, which is the same webhook gap the rest of this phase is about.
   */
  | { kind: "NONE"; deadDepositIds: string[] };

/**
 * Statuses that can still carry an obligation. `REFUNDED` is excluded and is the only
 * exclusion: the money went back, so the buyer owes it again if they want to proceed
 * (§22.1 — "a refunded or charged-back $99 cannot be used as the Premium credit",
 * which only makes sense if the obligation itself reopened).
 *
 * `FAILED` is INCLUDED, and that is the point of money-path defect 1: a row the old
 * behaviour pushed there on a decline still has a live intent at Stripe, and minting
 * a second intent for it is precisely the double-charge this module prevents.
 *
 * ─── THIS ARRAY IS A DEPLOY-ORDER CONSTRAINT. READ BEFORE ADDING A LABEL. ───
 *
 * Every string here is sent to PostgreSQL as an enum literal, in a READ predicate, on a
 * path that runs for every buyer who opens checkout (see `findExistingDepositObligation`
 * below and its three callers). A label that the deployed database's `DepositStatus`
 * type does not yet contain makes that query raise `22P02 invalid_text_representation`
 * — and because the predicate is unconditional, the failure is not scoped to rows in
 * the new state. It is every checkout, immediately, for everyone.
 *
 * So adding a label here couples the application deploy to a migration: the migration
 * must land FIRST, always, with no exceptions and no "it is additive so either order is
 * fine". That reasoning is about writes. This is a read.
 *
 * `DISPUTED` is the worked example. Its migration
 * (`prisma/migrations/20261111000000_deposit_status_disputed/`) originally documented
 * itself as "additive and safe in either order" because its author reasoned only about
 * which code writes the label. This line is why that was wrong; the correction and the
 * full reasoning are in that directory's `ORDERING.md`.
 *
 * NOTHING CATCHES THIS FOR YOU. CI's migration job applies the chain to an EMPTY
 * database, so the label always exists by the time any query runs there. The mismatch
 * exists only in the window between a production deploy and a production migration,
 * which is exactly the window no automated check in this repository looks at.
 */
const OBLIGATION_BEARING = ["PENDING", "PAID", "FAILED", "DISPUTED"] as const;

export interface FindObligationInput {
  buyerId: string;
  /**
   * When given, scopes the answer to one Vehicle Request. Plan is elected PER request
   * (§23.1 — "a new request means a new $99"), so a deposit already attached to a
   * DIFFERENT request is a different transaction and is ignored here.
   *
   * Rows with a NULL `vehicleRequestId` are adopted into this request rather than
   * ignored or treated as ambiguous. That is safe because of an invariant the schema
   * enforces: `vehicle_requests_one_open_per_buyer_key` permits a buyer at most one
   * open request, so an unattached deposit for this buyer can only belong to the one
   * they have. Adopting it is what stops a second charge.
   *
   * Adopting is a READ-scoping decision only. Nothing here writes the link back: §3
   * forbids a service stamping a parent id onto an existing row, and R1b's eight-row
   * backfill stays owner-run.
   */
  vehicleRequestId?: string | null;
  db?: Db;
}

export async function findExistingDepositObligation(
  input: FindObligationInput,
): Promise<DepositObligation> {
  const db = input.db ?? prisma;

  const candidates = await db.deposit.findMany({
    where: {
      buyerId: input.buyerId,
      status: { in: [...OBLIGATION_BEARING] },
      ...(input.vehicleRequestId
        ? { OR: [{ vehicleRequestId: input.vehicleRequestId }, { vehicleRequestId: null }] }
        : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  if (candidates.length === 0) return { kind: "NONE", deadDepositIds: [] };

  // Ask the provider about every candidate, not just the newest. The newest-row
  // shortcut is what let a settled older row hide behind a fresher PENDING one.
  const deadDepositIds: string[] = [];
  let settling: DepositObligation | null = null;
  let inFlight: DepositObligation | null = null;
  let unverifiable: DepositObligation | null = null;
  let unreachable: DepositObligation | null = null;

  for (const deposit of candidates) {
    const intentId = deposit.stripePaymentIntentId;

    if (!intentId || isSyntheticIntentId(intentId)) {
      const why = intentId
        ? `deposit ${deposit.id} carries the locally-minted id ${intentId}, which Stripe has never seen`
        : `deposit ${deposit.id} has no PaymentIntent attached`;

      // A row that CLAIMS to be paid and cannot be checked is not a reusable record —
      // it is a disagreement we must not resolve by charging the buyer again. This is
      // the admin `deposit/override` shape (PAID, no PaymentIntent), and before this
      // branch existed the row fell through to the mint path.
      if (deposit.status === "PAID") {
        logger.error(
          `[deposit-obligation] ${why}, yet the row is PAID. Refusing to mint or reuse; this needs Finance.`,
        );
        return {
          kind: "CONTRADICTION",
          deposit,
          paymentIntentId: intentId ?? null,
          intentStatus: null,
          reason: why,
        };
      }

      unverifiable ??= { kind: "UNVERIFIABLE", deposit, reason: why };
      continue;
    }

    let liveness: IntentLiveness;
    let intentStatus: string;
    try {
      const pi = await retrievePaymentIntent(intentId);
      intentStatus = String(pi.status ?? "");
      liveness = classifyIntentLiveness(pi.status);
    } catch (err) {
      logger.error(
        `[deposit-obligation] Stripe lookup failed for ${intentId} (deposit ${deposit.id}) — failing closed`,
        err,
      );
      unreachable ??= { kind: "PROVIDER_UNREACHABLE", deposit, paymentIntentId: intentId };
      continue;
    }

    // A settled obligation ends the search immediately: nothing outranks "the buyer
    // has already paid this".
    if (liveness === "SETTLED") {
      return { kind: "SETTLED", deposit, paymentIntentId: intentId, intentStatus };
    }
    // Our record says the money arrived; the provider says that intent never took it.
    // Neither may be acted on silently — see the CONTRADICTION docs above.
    if (deposit.status === "PAID" && (liveness === "IN_FLIGHT" || liveness === "DEAD")) {
      logger.error(
        `[deposit-obligation] deposit ${deposit.id} is PAID locally but Stripe reports intent ` +
          `${intentId} as "${intentStatus}". Refusing to mint or reuse; this needs Finance.`,
      );
      return {
        kind: "CONTRADICTION",
        deposit,
        paymentIntentId: intentId,
        intentStatus,
        reason: `deposit ${deposit.id} is PAID locally but Stripe reports intent ${intentId} as "${intentStatus}"`,
      };
    }
    if (liveness === "SETTLING") {
      settling ??= { kind: "SETTLING", deposit, paymentIntentId: intentId, intentStatus };
    }
    if (liveness === "IN_FLIGHT") {
      inFlight ??= { kind: "IN_FLIGHT", deposit, paymentIntentId: intentId, intentStatus };
    }
    if (liveness === "DEAD") deadDepositIds.push(deposit.id);
    // DEAD and UNKNOWN carry no obligation. UNKNOWN is a status Stripe added since
    // this was written; it is logged so it is noticed, and treated as no obligation
    // because inventing one would block a legitimate payment.
    if (liveness === "UNKNOWN") {
      logger.warn(
        `[deposit-obligation] unrecognised PaymentIntent status for ${intentId} (deposit ${deposit.id}) — ` +
          `treated as carrying no obligation; add it to classifyIntentLiveness`,
      );
    }
  }

  // Ordering is a safety ranking, not a preference: an unreachable provider must
  // outrank a reusable row, because "we could not check" has to stop the mint.
  return unreachable ?? settling ?? inFlight ?? unverifiable ?? { kind: "NONE", deadDepositIds };
}

/**
 * The one place that decides whether an obligation forbids minting a NEW intent.
 * `SETTLED` and `PROVIDER_UNREACHABLE` both do — the first because the money moved,
 * the second because we cannot show that it did not.
 */
/**
 * Retire rows whose intent Stripe reports cancelled. Matrix-guarded, so a row a
 * concurrent webhook has just settled is left alone (count 0), and best-effort: this
 * is bookkeeping, and failing it must never stop a buyer paying.
 */
export async function retireDeadDeposits(depositIds: string[], db: Db = prisma): Promise<number> {
  if (depositIds.length === 0) return 0;
  try {
    const { count } = await db.deposit.updateMany({
      where: { id: { in: depositIds }, status: { in: [...DEAD_INTENT_FROM] } },
      data: { status: "FAILED" },
    });
    if (count > 0) {
      logger.info(`[deposit-obligation] retired ${count} deposit row(s) whose PaymentIntent was cancelled`);
    }
    return count;
  } catch (err) {
    logger.error("[deposit-obligation] failed to retire dead deposit rows:", err);
    return 0;
  }
}

export function blocksNewIntent(o: DepositObligation): o is Extract<
  DepositObligation,
  { kind: "SETTLED" | "SETTLING" | "CONTRADICTION" | "PROVIDER_UNREACHABLE" }
> {
  return (
    o.kind === "SETTLED" ||
    // The bank is confirming an authorised charge. Offering a card form on top of
    // that is how a buyer pays twice for one obligation.
    o.kind === "SETTLING" ||
    // Our record and the provider disagree about whether money moved. Acting either
    // way picks a side silently.
    o.kind === "CONTRADICTION" ||
    o.kind === "PROVIDER_UNREACHABLE"
  );
}
