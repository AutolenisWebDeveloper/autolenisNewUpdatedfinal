// lib/services/payment/deposit-settlement.service.ts — P0 #2.
//
// THE MISSING STAGE
// -----------------
// Nothing in AutoLenis converted a succeeded Stripe PaymentIntent into a PAID
// Deposit. The Stripe webhook is the only writer of that transition, and no
// webhook has ever been delivered in production — `payment_provider_events` and
// `webhook_events` are both empty.
//
// `reconcileStuckActivations` (lib/services/auction/deposit-activation.service)
// cannot cover for it, and was never meant to: its sweep filters
// `status: 'PAID'`, so it reconciles auction ACTIVATION for deposits that are
// already settled. A buyer whose $99 genuinely left their card stayed PENDING
// forever and got no auction — the whole product, unpurchasable.
//
// This module is the one stage that was absent, and nothing more:
//
//     PENDING deposit + Stripe says succeeded  →  PAID
//
// Everything downstream already exists. Once a deposit is PAID with no auction,
// the activation reconciler creates it, launches it, invites dealers, and fails
// closed on a concierge track. So this settles and hands off; it deliberately
// does not create auctions, send email, or decide fulfilment.
//
// WHY POLLING IS LEGITIMATE HERE
// ------------------------------
// Stripe is authoritative about the money; our row is not. That is the same
// principle the deposit and fee duplicate-charge guards apply, and it is applied
// through the same pure rule (classifyPaymentConfirmation) so "the buyer has
// been charged" keeps one definition across the codebase.
//
// It is a BACKSTOP, not a replacement for the webhook. A settlement found here
// means the webhook did not arrive, which is an operational failure worth
// surfacing — so each one raises a SYSTEM_ALERT.
//
// THREE SAFETY PROPERTIES
// -----------------------
// 1. OFF BY DEFAULT. This writes money state; deploying the code must change
//    nothing until an owner turns it on (the CRM_INAPP_ENGINE_ENABLED /
//    ESIGN_EXECUTED_ARTIFACT_ENABLED cutover pattern).
// 2. AN EXCLUSION LIST THAT DEFAULTS NON-EMPTY. See below — today the only
//    candidate in production is a deposit under owner investigation.
// 3. NO FABRICATED PROVIDER EVENTS. `payment_provider_events` means "a provider
//    event was received". This polled. Writing one would forge the audit trail
//    and destroy the same non-fabrication guarantee the admin override keeps.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { allowedPredecessors } from "@/lib/payments/deposit-state";
import { retrievePaymentIntent } from "@/lib/services/payment/stripe.service";
import { classifyPaymentConfirmation, wasCharged } from "@/lib/services/payment/payment-confirmation";

export const DEPOSIT_SETTLEMENT_FLAG = "DEPOSIT_SETTLEMENT_RECONCILE_ENABLED";
export const DEPOSIT_SETTLEMENT_EXCLUDED_FLAG = "DEPOSIT_SETTLEMENT_EXCLUDED_DEPOSIT_IDS";

/**
 * Deposits this reconciler must never touch, even when it is switched on.
 *
 * `77934f10-…` is under active owner investigation with a standing instruction
 * not to act on it. It is also, at the time of writing, the ONLY PENDING deposit
 * in production carrying a PaymentIntent — so without this default the very
 * first enabled run would act on precisely the row that must be left alone.
 *
 * The default is non-empty on purpose: an unset env var must not be able to
 * revoke a standing instruction. Remove this entry (or override the list via
 * DEPOSIT_SETTLEMENT_EXCLUDED_DEPOSIT_IDS) once the owner closes the
 * investigation.
 */
export const DEFAULT_EXCLUDED_DEPOSIT_IDS: readonly string[] = [
  "77934f10-8c13-44b9-9a4a-1a5d7b0e99d6",
];

/** Strict opt-in: anything but the exact string "true" leaves this off. */
export function isDepositSettlementReconcilerEnabled(): boolean {
  return process.env[DEPOSIT_SETTLEMENT_FLAG] === "true";
}

/** Env list REPLACES the default when set, so an owner can widen or retarget it. */
export function excludedDepositIds(): string[] {
  const raw = process.env[DEPOSIT_SETTLEMENT_EXCLUDED_FLAG];
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  }
  return [...DEFAULT_EXCLUDED_DEPOSIT_IDS];
}

// A sandbox mock id never existed at Stripe; retrieving it would just throw.
const MOCK_INTENT_PREFIX = "pi_sandbox_mock_";

// Don't race the webhook's own delivery on a payment made moments ago.
const SETTLEMENT_GRACE_MINUTES = 15;

export interface SettlementSweepResult {
  scanned: number;
  settled: number;
  /** Charged but still awaiting the bank, or a non-success status. */
  unsettled: number;
  /** Provider lookups that threw; the sweep continues past them. */
  errors: number;
  /** Set when the reconciler is switched off — nothing was examined. */
  skipped?: string;
}

// Ops-only alert. Reuses the SYSTEM_ALERT Notification rail the deposit-activation
// reconciler already uses (surfaced on /admin/operations), rather than inventing an
// exception store. NO buyerId: the buyer is never told a cron rescued their payment.
// Best-effort — it must never roll back a settlement that already committed.
async function raiseWebhookGapAlert(depositId: string, intentId: string): Promise<void> {
  const title = `Deposit settled by reconciler (webhook gap): ${depositId}`;
  try {
    // Same dedupe key and destination the deposit-activation reconciler uses for
    // its own operator exceptions, so both land on one operations queue.
    const existing = await prisma.notification.findFirst({
      where: { title, type: "SYSTEM_ALERT" },
      select: { id: true },
    });
    if (existing) return;
    await prisma.notification.create({
      data: {
        buyerId: null,
        type: "SYSTEM_ALERT",
        actionUrl: "/admin/operations",
        title,
        body:
          `Deposit ${depositId} was flipped PENDING → PAID by the settlement reconciler after ` +
          `Stripe reported PaymentIntent ${intentId} as succeeded. The money moved, so the deposit ` +
          `is now correct — but this transition is the Stripe webhook's job, and the webhook did ` +
          `not deliver it. Treat this as a webhook outage: check the endpoint and signing secret. ` +
          `No PaymentProviderEvent was written, because none was received.`,
      },
    });
  } catch (err) {
    logger.error(`[deposit-settlement] ops alert failed for deposit ${depositId}:`, err);
  }
}

/**
 * Sweep PENDING deposits whose PaymentIntent already succeeded and settle them.
 *
 * Idempotent and concurrency-safe without a separate lock: the write is an
 * `updateMany` scoped by `allowedPredecessors("PAID")`, so the database itself
 * enforces the transition matrix. A second run (or a concurrent one, or a webhook
 * that finally arrives) matches zero rows and changes nothing — and an already
 * PAID or REFUNDED deposit can never be resurrected by a late poll.
 */
export async function reconcileDepositSettlements(opts?: {
  graceMinutes?: number;
  limit?: number;
}): Promise<SettlementSweepResult> {
  if (!isDepositSettlementReconcilerEnabled()) {
    return {
      scanned: 0,
      settled: 0,
      unsettled: 0,
      errors: 0,
      skipped: "deposit_settlement_reconciler_disabled",
    };
  }

  const graceMin = opts?.graceMinutes ?? SETTLEMENT_GRACE_MINUTES;
  const limit = opts?.limit ?? 100;
  const cutoff = new Date(Date.now() - graceMin * 60000);

  const candidates = await prisma.deposit.findMany({
    where: {
      status: "PENDING",
      refundedAt: null,
      stripePaymentIntentId: { not: null },
      createdAt: { lt: cutoff },
      // Excluded ids are filtered in the QUERY, so a deposit we must not act on
      // is never even loaded, let alone looked up at the provider.
      id: { notIn: excludedDepositIds() },
    },
    select: { id: true, stripePaymentIntentId: true, status: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let settled = 0;
  let unsettled = 0;
  let errors = 0;

  for (const deposit of candidates) {
    const intentId = deposit.stripePaymentIntentId;
    if (!intentId || intentId.startsWith(MOCK_INTENT_PREFIX)) {
      unsettled += 1;
      continue;
    }

    try {
      const intent = await retrievePaymentIntent(intentId);
      // The shared rule, not a local reading of Stripe's statuses. recordedStatus
      // is this deposit's own status: PENDING here, so a succeeded intent
      // classifies as charged-but-unrecorded — exactly what we are here to fix.
      const outcome = classifyPaymentConfirmation({
        intentStatus: intent.status,
        recordedStatus: deposit.status,
      });

      if (!wasCharged(outcome)) {
        unsettled += 1;
        continue;
      }

      // The database enforces the transition matrix; this is the atomic guard.
      const updated = await prisma.deposit.updateMany({
        where: { id: deposit.id, status: { in: allowedPredecessors("PAID") } },
        data: { status: "PAID" },
      });

      if (updated.count === 0) {
        // Someone else settled it between the read and the write. Not an error.
        unsettled += 1;
        continue;
      }

      settled += 1;
      logger.warn(
        `[deposit-settlement] settled deposit ${deposit.id} from PaymentIntent ${intentId} ` +
          `(${intent.status}) — the webhook did not deliver this`,
      );
      await raiseWebhookGapAlert(deposit.id, intentId);
    } catch (err) {
      // One unreachable intent must not strand every other paid buyer in the sweep.
      errors += 1;
      logger.error(`[deposit-settlement] lookup failed for deposit ${deposit.id} (${intentId}):`, err);
    }
  }

  return { scanned: candidates.length, settled, unsettled, errors };
}
