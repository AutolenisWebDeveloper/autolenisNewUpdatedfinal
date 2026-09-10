// lib/services/payment/fulfillment-hold.service.ts
//
// §5d / §26 — "Dispute or refund places fulfillment on hold and stops all unsent
// outreach." Exception row: "Payment disputed or refunded | Finance | Hold fulfillment;
// stop unsent outreach."
//
// WHAT EXISTED BEFORE PHASE 3: nothing. `charge.dispute.created` wrote an
// `AdminAuditLog` row and stopped — best-effort, with `.catch(() => log)`, so even that
// was not guaranteed. No deposit status changed, no outreach was stopped, no exception
// was raised, and sourcing carried on spending money on a charge the buyer was
// contesting. `charge.refunded` flipped the deposit and emailed the buyer, and likewise
// stopped no outreach.
//
// THREE THINGS HAVE TO HAPPEN TOGETHER, and the order matters:
//
//   1. the deposit records the dispute — a state that is neither FAILED (retryable) nor
//      REFUNDED (money returned), which is why Phase 3's one migration adds DISPUTED;
//   2. every unsent message for this buyer stops, because the worst outcome here is a
//      cheerful "your auction is live!" landing while Finance is contesting the charge;
//   3. Finance is told, on the one exception rail, with the provider reference.
//
// THE HOLD ITSELF IS DERIVED, NOT STORED. The Phase 1 wave's own comment rules it:
// `disputed_at IS NOT NULL AND hold_released_at IS NULL`. A fourth stored column would
// be a second spelling of the same fact and could disagree with it.

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";
import { DISPUTE_FROM, DISPUTE_WON_FROM, REFUND_FROM } from "@/lib/payments/deposit-state";
import {
  raiseException,
  resolve as resolveQueueItem,
  OPEN_QUEUE_STATUSES,
  QueueItemConcurrencyError,
} from "@/lib/services/operations/queue-item.service";
import { cancelByKey } from "@/lib/services/comms/transactional-dispatcher.service";
// The cancel handle is the PRODUCER's to define — one builder, so a key that
// cancels nothing is impossible rather than merely unlikely.
import { depositReminderCancelKey } from "@/lib/services/payment/deposit-reminder.service";

type Db = typeof prisma | Prisma.TransactionClient;

/**
 * The §26 Finance exception for this provider reference.
 *
 * Built in ONE place because two call sites depend on it agreeing: `applyFulfillmentHold`
 * raises it, and `releaseFulfillmentHold` closes that same row when Stripe rules in our
 * favour. A key that drifted between them would leave the queue asserting a hold that no
 * longer exists — the one failure the dedup index cannot catch, because both rows would
 * be individually valid.
 */
export function disputeExceptionKey(providerRef: string): string {
  return `PAYMENT_DISPUTED_OR_REFUNDED:${providerRef}`;
}

export type HoldTrigger = "dispute" | "refund";

export interface ApplyHoldInput {
  depositId: string;
  buyerId: string;
  vehicleRequestId: string | null;
  trigger: HoldTrigger;
  /** The Stripe dispute or refund id — what Finance needs to find it. */
  providerRef: string;
  /** Stripe's own reason, when it gave one. */
  reason?: string | null;
  /**
   * Who caused this. The §26 row is read by a person, and "Stripe reported a refund"
   * is false for a refund an admin deliberately issued from the operations surface.
   */
  initiatedBy?: "provider" | "admin";
}

export interface ApplyHoldResult {
  /** True when THIS call moved the deposit to DISPUTED. */
  disputed: boolean;
  /** Unsent lifecycle touches stopped. */
  touchesCancelled: number;
  /** Unsent outbox messages stopped. */
  outboxCancelled: number;
}

/**
 * Put fulfilment on hold and stop everything unsent.
 *
 * NOT transactional with the caller, and deliberately so. The status write and the
 * cancellations are what matter and are done first; the exception and the audit trail
 * follow best-effort, because a webhook that fails after stopping outreach would be
 * retried by Stripe and would stop it again — whereas a webhook that fails BEFORE
 * stopping outreach leaves the messages going out. Ordering beats atomicity here.
 */
export async function applyFulfillmentHold(
  input: ApplyHoldInput,
  db: Db = prisma,
): Promise<ApplyHoldResult> {
  const holdReason =
    input.trigger === "dispute"
      ? `dispute ${input.providerRef}${input.reason ? ` (${input.reason})` : ""}`
      : `refund ${input.providerRef}${input.reason ? ` (${input.reason})` : ""}`;

  // 1. RECORD THE HOLD.
  //
  // A dispute moves the status to DISPUTED; a refund does not (the refund handler owns
  // that transition, and REFUNDED is where it lands). Both stamp `disputed_at` and
  // `hold_reason`, because both put fulfilment on hold — §5d treats them together and
  // the derived predicate reads `disputed_at`, not the status.
  let disputed = false;
  if (input.trigger === "dispute") {
    const flipped = await db.deposit.updateMany({
      where: { id: input.depositId, status: { in: [...DISPUTE_FROM] } },
      // `hold_released_at` is CLEARED, and that is not tidiness.
      //
      // Found by the independent review. Stripe retries a failed `charge.dispute.created`
      // for days, so it can arrive AFTER a `charge.dispute.closed{won}` was processed.
      // `DISPUTE_FROM` includes PAID, so the row correctly flips back to DISPUTED — and
      // if the release stamp survived, the status would say DISPUTED while
      // `depositNotOnHold()` said "not on hold". Worse, `settledDepositCentsForRequest`
      // requires PAID, so the Premium credit would vanish and the upgrade window shut
      // permanently, with no further `dispute.closed` coming to undo it.
      //
      // A hold is being APPLIED, so the fact that a previous one was released is no
      // longer true. Clearing it keeps the stored state and the derived predicate saying
      // the same thing.
      data: {
        status: "DISPUTED",
        disputedAt: new Date(),
        holdReason: holdReason,
        holdReleasedAt: null,
      },
    });
    disputed = flipped.count > 0;
  } else {
    // A REFUND ALWAYS PUTS THE HOLD BACK ON, even on a row that has been disputed before.
    //
    // This was guarded on `disputedAt: null`, so after a dispute the platform WON —
    // `disputed_at` set, `hold_released_at` stamped — a later admin refund matched
    // nothing: the release stamp stayed, and `hold_reason` still named the old dispute.
    // The stored state then said "not on hold" for a deposit whose money had gone back.
    //
    // Two writes rather than one, because `disputed_at` is SET-ONCE. It is the record
    // that a hold first began, and overwriting it on every refund would lose when. The
    // second write is unconditional and carries what changed.
    await db.deposit.updateMany({
      where: { id: input.depositId, disputedAt: null },
      data: { disputedAt: new Date() },
    });
    await db.deposit.updateMany({
      where: { id: input.depositId },
      data: { holdReason: holdReason, holdReleasedAt: null },
    });
  }

  // 2. STOP EVERYTHING UNSENT. Both rails, because the six-touch series still runs on
  // `lifecycle_touch_schedule` and the Phase 2 transactional messages run on
  // `comms_outbox`. Missing either would let a message go out under a contested charge.
  let touchesCancelled = 0;
  let outboxCancelled = 0;
  try {
    // DYNAMIC, and the reason is a load-time one rather than a preference. The touch
    // drain reaches Supabase through `lib/supabase-service.ts`, which begins with
    // `import "server-only"` — a module that THROWS the moment it is loaded outside a
    // server bundle. A static import here would put it in the module graph of every
    // caller of this service, the Stripe webhook route among them, and that route is
    // exercised by four unit-test files that load it directly. The webhook route
    // already imports the same module this way, for the same reason; this follows the
    // convention rather than inventing one. Caught by the existing webhook suites when
    // the first cut imported it statically.
    const { cancelDepositReminderTouches } = await import(
      "@/lib/services/crm/lifecycle-touch-drain.service"
    );
    const touches = await cancelDepositReminderTouches(input.buyerId, { reason: holdReason });
    touchesCancelled = touches.canceled;
  } catch (err) {
    logger.error(`[fulfillment-hold] touch cancellation failed for deposit ${input.depositId}:`, err);
  }
  if (input.vehicleRequestId) {
    try {
      const res = await cancelByKey(depositReminderCancelKey(input.vehicleRequestId), holdReason, db);
      outboxCancelled = res.cancelled;
    } catch (err) {
      logger.error(`[fulfillment-hold] outbox cancellation failed for deposit ${input.depositId}:`, err);
    }
  }

  // 3. TELL FINANCE. The one rail (§13-D12), with the provider reference, keyed on it so
  // a Stripe redelivery collapses onto one row rather than filling the queue.
  try {
    await raiseException({
      code: "PAYMENT_DISPUTED_OR_REFUNDED",
      buyerId: input.buyerId,
      depositId: input.depositId,
      vehicleRequestId: input.vehicleRequestId ?? null,
      idempotencyKey: disputeExceptionKey(input.providerRef),
      detail:
        `${input.initiatedBy === "admin" ? "An administrator issued" : "Stripe reported"} a ${input.trigger} ` +
        `(${input.providerRef}) against deposit ${input.depositId}` +
        `${input.reason ? `, reason "${input.reason}"` : ""}. Fulfilment is on hold and ` +
        `${touchesCancelled + outboxCancelled} unsent message(s) were cancelled. Sourcing must not ` +
        `resume until this is resolved. Refunds are reviewed manually (§22.1) — this exception is the ` +
        `review, not a request to issue one.`,
    });
  } catch (err) {
    // Best-effort at the CALL SITE, deliberately: alerting must never fail an
    // already-acknowledged webhook, or Stripe retries a delivery that DID have an
    // effect — the hold and the cancellations above have already happened.
    logger.error(`[fulfillment-hold] exception raise failed for deposit ${input.depositId}:`, err);
  }

  return { disputed, touchesCancelled, outboxCancelled };
}

/**
 * Close the §26 Finance exception this provider reference opened.
 *
 * Best-effort and NARROW: it closes the one row keyed on this dispute, and only while
 * that row is still open. A human who already worked it wins — `resolve` refuses a
 * compare-and-swap that matches nothing, and that refusal is the correct answer here
 * rather than an error to retry.
 *
 * Auto-closing is defensible for THIS code because the condition it describes ("hold
 * fulfilment while the dispute is open") is settled by the provider, not by judgement:
 * Stripe has ruled. The buyer-visible line the row carries — "Your payment is under
 * review. Sourcing is on hold until it clears." — would otherwise keep saying that for
 * as long as it took someone to notice the dispute had closed.
 */
async function closeDisputeException(
  providerRef: string,
  resolution: string,
  db: Db,
): Promise<boolean> {
  try {
    const open = await db.queueItem.findFirst({
      where: { idempotencyKey: disputeExceptionKey(providerRef), status: { in: [...OPEN_QUEUE_STATUSES] } },
      select: { id: true },
    });
    if (!open) return false;
    await resolveQueueItem(
      { queueItemId: open.id, resolution, resolvedBy: "stripe-webhook", status: "RESOLVED" },
      db,
    );
    return true;
  } catch (err) {
    if (err instanceof QueueItemConcurrencyError) return false; // someone else worked it first
    logger.error(`[fulfillment-hold] could not close the exception for ${providerRef}:`, err);
    return false;
  }
}

/**
 * Lift the hold when a dispute is resolved in the platform's favour.
 *
 * `charge.dispute.closed` with `status: "won"` means the charge stands, so the deposit
 * returns to PAID and `hold_released_at` is stamped — which is what makes the derived
 * predicate (`disputed_at IS NOT NULL AND hold_released_at IS NULL`) read "not on hold"
 * again. `disputed_at` is deliberately LEFT SET: it is the record that a dispute
 * happened, and clearing it would erase that from the row entirely.
 *
 * A dispute LOST is `recordDisputeLost`, not this function.
 *
 * The outreach is NOT restarted. A buyer whose payment was contested for weeks should
 * not suddenly receive the rest of a reminder series written for someone who had just
 * left checkout; re-enrolling them is a decision for a person.
 */
export async function releaseFulfillmentHold(
  depositId: string,
  providerRef: string,
  db: Db = prisma,
): Promise<boolean> {
  const { count } = await db.deposit.updateMany({
    where: { id: depositId, status: { in: [...DISPUTE_WON_FROM] } },
    data: { status: "PAID", holdReleasedAt: new Date() },
  });
  if (count > 0) {
    logger.info(
      `[fulfillment-hold] dispute ${providerRef} resolved in our favour — deposit ${depositId} back to PAID`,
    );
    await closeDisputeException(
      providerRef,
      `Stripe closed dispute ${providerRef} in the platform's favour. The charge stands, the deposit is PAID ` +
        `and the fulfilment hold is released. Unsent outreach cancelled during the hold was NOT re-enrolled — ` +
        `re-enrolling a buyer into a reminder series after weeks of silence is a decision for a person.`,
      db,
    );
  }
  return count > 0;
}

export interface DisputeLostInput {
  depositId: string;
  buyerId: string;
  vehicleRequestId: string | null;
  /** The Stripe dispute id. */
  providerRef: string;
}

/**
 * Record a dispute the platform LOST. The money is gone.
 *
 * THE HOLD STAYS ON. `hold_released_at` is left null deliberately: the derived predicate
 * must keep reading "on hold", because there is now no settled $99 behind this request
 * and nothing costly may run for it. Only a won dispute releases a hold.
 *
 * The status becomes REFUNDED because that is what the money did — it went back to the
 * cardholder — and `REFUND_FROM` already admits `DISPUTED`. `refund_reason` is left NULL:
 * the `RefundReason` enum has four labels (NO_OFFERS, BUYER_REQUEST, FRAUD,
 * ADMIN_DECISION) and none of them means "chargeback". Writing FRAUD would assert an
 * investigation nobody performed, and ADMIN_DECISION would credit a decision no admin
 * made. The fact is recorded in `hold_reason`, which is free text, and the absent
 * chargeback label is reported rather than migrated — this phase ships one migration.
 *
 * NO PLAN CHANGE. PAY-84: "$99 charged back after Premium settled → Finance exception;
 * entitlement holds; never silent downgrade." Nothing here touches a plan.
 */
export async function recordDisputeLost(
  input: DisputeLostInput,
  db: Db = prisma,
): Promise<boolean> {
  const holdReason = `chargeback — dispute ${input.providerRef} closed against the platform`;
  const { count } = await db.deposit.updateMany({
    where: { id: input.depositId, status: { in: [...REFUND_FROM] } },
    data: { status: "REFUNDED", refundedAt: new Date(), holdReason },
  });

  // A SECOND, distinct exception rather than a redelivery of the first. The row raised at
  // `charge.dispute.created` says "hold fulfilment while this is open"; this one says the
  // money is gone and is not coming back, which is a different instruction to a different
  // reader. Keyed on `:lost` so it is one row per lost dispute, not one per redelivery.
  try {
    await raiseException({
      code: "PAYMENT_DISPUTED_OR_REFUNDED",
      buyerId: input.buyerId,
      depositId: input.depositId,
      vehicleRequestId: input.vehicleRequestId,
      idempotencyKey: `${disputeExceptionKey(input.providerRef)}:lost`,
      detail:
        `Stripe closed dispute ${input.providerRef} AGAINST the platform. The $99 has been withdrawn and the ` +
        `deposit is REFUNDED${count === 0 ? " (or was already in a terminal state — this call changed nothing)" : ""}. ` +
        `Fulfilment REMAINS on hold: hold_released_at is deliberately not stamped, because there is no settled ` +
        `deposit behind this request any more. Any plan entitlement is UNCHANGED and must not be downgraded ` +
        `silently (§23.4/PAY-84) — if it should change, a person decides that. Note: refund_reason is null because ` +
        `the RefundReason enum has no chargeback label.`,
    });
  } catch (err) {
    logger.error(`[fulfillment-hold] lost-dispute exception raise failed for ${input.providerRef}:`, err);
  }

  return count > 0;
}
