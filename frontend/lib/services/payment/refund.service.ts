// lib/services/payment/refund.service.ts
//
// THE ONE PRIMITIVE THAT REFUNDS A $99 DEPOSIT.
//
// Before Phase 3 there were three, and they disagreed about the things that matter:
//
//   • `refundDepositCharge` — the good one, but its "is there a real charge?" test
//     knew only about `pi_admin_` ids, so a `pi_sandbox_mock_` id was treated as a
//     real charge and sent to Stripe;
//   • `processRefund` — a near-copy used by the AI action-intent command, which did
//     NOT handle `charge_already_refunded` (so an out-of-band refund made it throw
//     and report failure for money that had already gone back) and sent its own
//     buyer notification, so the same event produced different messaging depending
//     on which path an operator happened to take;
//   • the admin refund route — a third inline copy, and the only one that checked the
//     PaymentIntent was actually `succeeded` before issuing a refund.
//
// Consolidating is not "pick one and delete the others". Each carried a safety check
// the others lacked, so the primitive below is the UNION of all three, and the other
// two now call it. §22.1 governs: refunds are reviewed manually, execution is
// idempotency-keyed, and a no-charge record is NEVER labelled as money refunded.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { refundPaymentIntent, retrievePaymentIntent } from "./stripe.service";
import { isSyntheticIntentId } from "./deposit-obligation";
import { REFUND_FROM } from "@/lib/payments/deposit-state";
import { DEPOSIT_AMOUNT_USD } from "@/lib/constants";

export type DepositRefundOutcome =
  /** Money was returned (or had already been returned out of band) and our row now says so. */
  | "REFUNDED"
  /** A concurrent path won the status flip. The money moved exactly once. */
  | "ALREADY_REFUNDED"
  /**
   * There is nothing to return. The deposit carries no PaymentIntent, or one we minted
   * ourselves (`pi_admin_`, `pi_sandbox_mock_`, `pi_fee_admin_`) that Stripe never saw.
   * Callers MUST NOT tell the buyer a refund is on the way on this outcome — that is a
   * fake success, and §22.1 forbids labelling a no-charge record as money refunded.
   */
  | "NO_CHARGE"
  /**
   * Stripe holds the intent but says it never succeeded, so there is no captured money
   * to return. Refunding it would 4xx at the provider; flipping our row to REFUNDED
   * without that would record a refund that never happened. Absorbed from the admin
   * route, which was the only one of the three that checked.
   */
  | "NOT_SUCCEEDED";

export interface DepositRefundResult {
  outcome: DepositRefundOutcome;
  /**
   * The Stripe `re_...` id, when this call created one. Null for every outcome that
   * moved no money, and also for `charge_already_refunded` — where the refund exists
   * at Stripe but was created by something else, so claiming its id here would be a
   * guess. Recorded in the admin audit log so an operator can find the refund object
   * without reconstructing it from the PaymentIntent.
   */
  stripeRefundId: string | null;
}

export interface RefundDepositInput {
  id: string;
  stripePaymentIntentId: string | null;
}

/**
 * Refund a deposit's real charge, once.
 *
 * Idempotency-keyed on the DEPOSIT, so every path that refunds the same deposit
 * collapses to a single Stripe refund even when two operators act at the same moment.
 * The status flip is scoped by the transition matrix rather than read-then-written, so
 * a concurrent writer loses the race cleanly instead of double-writing.
 */
export async function refundDepositCharge(
  deposit: RefundDepositInput,
  reason = "admin refund",
): Promise<DepositRefundResult> {
  const intentId = deposit.stripePaymentIntentId;
  if (!intentId || isSyntheticIntentId(intentId)) return { outcome: "NO_CHARGE", stripeRefundId: null };

  // Ask the provider before moving money. This is the admin route's check, promoted:
  // refunding a non-succeeded intent is an error Stripe returns 4xx for, and catching
  // the divergence here is what stops our row saying REFUNDED while the money never
  // left. A provider we cannot reach is NOT treated as "not succeeded" — it throws, so
  // the caller reports a failure rather than recording a refund that did not happen.
  const intent = await retrievePaymentIntent(intentId);
  if (intent.status !== "succeeded") {
    logger.warn(
      `[refund] refusing to refund deposit ${deposit.id}: PaymentIntent ${intentId} is ` +
        `"${intent.status}", not "succeeded" — there is no captured money to return`,
    );
    return { outcome: "NOT_SUCCEEDED", stripeRefundId: null };
  }

  let stripeRefundId: string | null = null;
  try {
    const refund = await refundPaymentIntent(intentId, reason, `refund-deposit-${deposit.id}`);
    stripeRefundId = refund?.id ?? null;
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    // Money already left Stripe out of band — safe to sync our DB state.
    // Anything else means the refund did NOT happen; do not flip.
    if (code !== "charge_already_refunded") throw err;
    logger.warn("[refund] charge already refunded out-of-band — syncing DB only:", { depositId: deposit.id });
  }

  // `REFUND_FROM` is PAID or DISPUTED. DISPUTED is included because a dispute the
  // platform loses returns the funds and Stripe reports the charge as refunded; the
  // row must be able to follow that. It is still matrix-scoped, so a REFUNDED or
  // PENDING row is untouched.
  const flipped = await prisma.deposit.updateMany({
    where: { id: deposit.id, status: { in: [...REFUND_FROM] } },
    data: { status: "REFUNDED", refundedAt: new Date() },
  });

  // §5d / §26 — THE HOLD BELONGS HERE, not only on the webhook.
  //
  // Found by the independent review, and the reasoning is worth keeping: this primitive
  // flips the row to REFUNDED itself, so by the time Stripe delivers `charge.refunded`
  // the webhook's own matrix-scoped flip matches ZERO rows, `refundApplied` is false,
  // and its `applyFulfillmentHold` call is skipped. The result was that §26's "hold
  // fulfillment; stop unsent outreach" was honoured for provider-initiated refunds and
  // silently skipped for every ADMIN refund — which is the common path. No hold stamped,
  // no outreach cancelled, and no Finance exception raised at all.
  //
  // Applying it here makes the two paths converge instead of racing: whichever runs
  // first stamps the hold and cancels the rails, and the other finds the work done —
  // `applyFulfillmentHold` guards its stamp on `disputedAt: null`, `cancelByKey` only
  // touches unsent rows, and the exception is keyed on the provider reference.
  //
  // Best-effort by design: a refund that MOVED MONEY must be reported as REFUNDED even
  // if the hold write fails. The failure is loud, and the webhook's own call is the
  // second chance.
  if (flipped.count > 0) {
    try {
      const row = await prisma.deposit.findUnique({
        where: { id: deposit.id },
        select: { buyerId: true, vehicleRequestId: true },
      });
      if (row) {
        const { applyFulfillmentHold } = await import("@/lib/services/payment/fulfillment-hold.service");
        await applyFulfillmentHold({
          depositId: deposit.id,
          buyerId: row.buyerId,
          vehicleRequestId: row.vehicleRequestId,
          trigger: "refund",
          providerRef: stripeRefundId ?? intentId,
          reason,
        });
      }
    } catch (err) {
      logger.error(`[refund] fulfilment hold failed after refunding deposit ${deposit.id}:`, err);
    }
  }

  return { outcome: flipped.count > 0 ? "REFUNDED" : "ALREADY_REFUNDED", stripeRefundId };
}

/**
 * The AI action-intent command's entry point. Kept as a named export because
 * `lib/services/ai/action-intent/catalog.ts` records it as the canonical service for
 * the `refund_deposit` intent, and that registry is what the guardrails check against.
 *
 * It is now a thin adapter over the one primitive rather than a second implementation.
 * The behaviour change worth stating: it used to throw on `charge_already_refunded`
 * and report failure for money that had ALREADY gone back to the buyer. It now
 * reports success for that case, which is what actually happened.
 */
export async function processRefund(depositId: string, reason: string): Promise<boolean> {
  const deposit = await prisma.deposit.findUnique({
    where: { id: depositId },
    select: { id: true, buyerId: true, status: true, stripePaymentIntentId: true },
  });
  if (!deposit) return false;

  const { outcome } = await refundDepositCharge(deposit, reason);
  if (outcome !== "REFUNDED") return false;

  await prisma.notification.create({
    data: {
      buyerId: deposit.buyerId,
      type: "DEAL_STAGE_CHANGED",
      title: "Refund processed",
      body: `Your ${DEPOSIT_AMOUNT_USD} deposit refund has been processed. Allow 3-5 business days.`,
    },
  }).catch(() => {});

  return true;
}
