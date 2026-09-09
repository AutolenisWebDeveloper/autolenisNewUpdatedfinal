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
// 2. AN EXCLUSION LIST, configured in the environment. It defaulted non-empty
//    with one production customer's UUID compiled in; Phase 3 emptied that on
//    §13-D12's instruction and the run now announces an empty list rather than
//    carrying a hard-coded one. Safety still rests on property 1: the sweep is
//    off until an owner turns it on, and D12 orders the exclusion set first.
// 3. NO FABRICATED PROVIDER EVENTS. `payment_provider_events` means "a provider
//    event was received". This polled. Writing one would forge the audit trail
//    and destroy the same non-fabrication guarantee the admin override keeps.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { SETTLE_FROM } from "@/lib/payments/deposit-state";
import {
  retrievePaymentIntent,
  searchPaymentIntentsByDepositId,
} from "@/lib/services/payment/stripe.service";
import { classifyPaymentConfirmation, wasCharged } from "@/lib/services/payment/payment-confirmation";

export const DEPOSIT_SETTLEMENT_FLAG = "DEPOSIT_SETTLEMENT_RECONCILE_ENABLED";
export const DEPOSIT_SETTLEMENT_EXCLUDED_FLAG = "DEPOSIT_SETTLEMENT_EXCLUDED_DEPOSIT_IDS";

/**
 * Deposits this reconciler must never touch, even when it is switched on.
 *
 * EMPTIED IN PHASE 3, on §13-D12's instruction: "the reconciler also carries a
 * hard-coded excluded production deposit id (`:69-71`) that Phase 3 removes."
 *
 * What was here was a real production customer's UUID, compiled into the binary
 * and shipped to every environment. That is the defect, not the exclusion: the
 * standing instruction it encoded is real and still stands, but the place to
 * express it is the environment, alongside the flag that enables the sweep at
 * all — both are runtime decisions the owner makes together, and neither should
 * need a deploy.
 *
 * Nothing is weakened by emptying it, because the sweep is still OFF by default.
 * D12's own preconditions are explicit that the enable comes AFTER the excluded
 * deposit is resolved by hand, and `assertExclusionsConfigured` below refuses to
 * let that be forgotten silently.
 *
 * Set `DEPOSIT_SETTLEMENT_EXCLUDED_DEPOSIT_IDS` to exclude a row.
 */
export const DEFAULT_EXCLUDED_DEPOSIT_IDS: readonly string[] = [];

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

/**
 * Say so, loudly, when the sweep is enabled with no exclusions configured.
 *
 * The compiled-in default that used to make this impossible is gone (see above), so
 * the failure mode it prevented — enabling the flag and acting on a row that was
 * under investigation — is now prevented by the owner following §13-D12's order
 * instead. An order nobody is reminded of is one that gets skipped, so the run says
 * plainly what it is about to do. It does not refuse: an empty list is the correct
 * steady state once the investigation closes, and a reconciler that cannot run
 * without a dummy exclusion would be worse than one that announces itself.
 */
function assertExclusionsConfigured(excluded: string[]): void {
  if (excluded.length === 0) {
    logger.warn(
      `[deposit-settlement] enabled with NO excluded deposit ids. Every eligible row will be settled. ` +
        `If a deposit is under investigation, set ${DEPOSIT_SETTLEMENT_EXCLUDED_FLAG} before this runs again ` +
        `(§13-D12).`,
    );
  }
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

  const excluded = excludedDepositIds();
  assertExclusionsConfigured(excluded);

  // PAY-34: the sweep is widened to the two classes that escaped it.
  //
  // (1) `status: "PENDING"` → `SETTLE_FROM` (PENDING or FAILED). A row the
  //     pre-Phase-3 behaviour pushed to FAILED on a card decline still has a live
  //     PaymentIntent at Stripe, and if the buyer retried successfully the money is
  //     already gone from their account. Those are precisely the buyers this
  //     reconciler exists for, and the old filter could not see a single one of them.
  //
  // (2) `stripePaymentIntentId: { not: null }` is GONE. An admin send-link deposit
  //     carries no intent until the Checkout Session produces one, so a session that
  //     was paid while the webhook was down leaves a paid buyer on a null-intent row
  //     that nothing could ever find. Those rows are resolved below by asking Stripe
  //     for intents stamped with this deposit's id, rather than by having none.
  //
  // The exclusion stays in the QUERY, so a row we must not act on is never loaded,
  // let alone looked up at the provider.
  const candidates = await prisma.deposit.findMany({
    where: {
      status: { in: [...SETTLE_FROM] },
      refundedAt: null,
      createdAt: { lt: cutoff },
      id: { notIn: excluded },
    },
    select: { id: true, stripePaymentIntentId: true, status: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let settled = 0;
  let unsettled = 0;
  let errors = 0;

  for (const deposit of candidates) {
    let intentId = deposit.stripePaymentIntentId;

    // A sandbox mock id never existed at Stripe; retrieving it would just throw.
    if (intentId?.startsWith(MOCK_INTENT_PREFIX)) {
      unsettled += 1;
      continue;
    }

    try {
      // PAY-34 class (2): no intent on the row. This is the admin send-link shape —
      // the Checkout Session mints the intent and the webhook writes it back, so a
      // missed webhook leaves a paid buyer pointing at nothing. Ask Stripe for the
      // intents stamped with this deposit's id and adopt a succeeded one.
      //
      // Only a SUCCEEDED intent is adopted. A live or dead one tells us nothing that
      // this reconciler acts on, and writing a live intent id onto the row here would
      // race the webhook that is about to write the same thing.
      if (!intentId) {
        const found = await searchPaymentIntentsByDepositId(deposit.id);
        const succeeded = found.find((pi) => pi.status === "succeeded");
        if (!succeeded) {
          unsettled += 1;
          continue;
        }
        // Attach it, guarded: `stripePaymentIntentId` is @unique and the webhook may
        // be writing the same value concurrently. `updateMany` scoped to the still-null
        // row makes losing that race a no-op rather than a P2002.
        await prisma.deposit.updateMany({
          where: { id: deposit.id, stripePaymentIntentId: null },
          data: { stripePaymentIntentId: succeeded.id },
        });
        intentId = succeeded.id;
        logger.warn(
          `[deposit-settlement] adopted PaymentIntent ${succeeded.id} for deposit ${deposit.id} ` +
            `from provider metadata — the row carried no intent, which is the admin send-link shape`,
        );
      }

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
      // `SETTLE_FROM` rather than `allowedPredecessors("PAID")`: the matrix also
      // permits DISPUTED -> PAID, and a reconciler must never clear a live dispute.
      // That edge belongs to `charge.dispute.closed` alone.
      const updated = await prisma.deposit.updateMany({
        where: { id: deposit.id, status: { in: [...SETTLE_FROM] } },
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
