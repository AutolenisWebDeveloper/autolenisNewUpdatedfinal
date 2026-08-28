// lib/services/deal/service-fee.service.ts — System 6
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { PREMIUM_FEE_CENTS, DEPOSIT_AMOUNT_CENTS, PREMIUM_FEE_REMAINING_CENTS } from "@/lib/constants";
import { advanceDealStatus } from "@/lib/services/deal/deal.service";
import { logger } from "@/lib/logger";
import {
  classifyPaymentConfirmation,
  wasCharged,
} from "@/lib/services/payment/payment-confirmation";

// Idempotent ServiceFeePayment row writer — the ONE place `service_fee_payments`
// is created. Keyed on `dealId` (@unique): a repeat call (webhook retry, or a
// race with recordFeePayment) returns the existing row and never double-inserts.
// Row ONLY — it does NOT advance DealStatus, so the caller keeps its own
// source-checked, no-regress fee-advance logic. Retains the gross/credit/net
// breakdown ($499 gross, $99 deposit credit, $400 net) for revenue reporting.
export async function writeServiceFeePayment(dealId: string, paymentIntentId: string) {
  const existing = await prisma.serviceFeePayment.findUnique({ where: { dealId } });
  if (existing) return existing;
  try {
    return await prisma.serviceFeePayment.create({
      data: {
        dealId,
        amountCents: PREMIUM_FEE_CENTS,
        depositCreditCents: DEPOSIT_AMOUNT_CENTS,
        netAmountCents: PREMIUM_FEE_CENTS - DEPOSIT_AMOUNT_CENTS,
        stripePaymentIntentId: paymentIntentId,
        paidAt: new Date(),
      },
    });
  } catch (err) {
    // Lost the unique(dealId) race with a concurrent writer — return the winner.
    // (The table also has a unique stripePaymentIntentId, but every concierge-fee
    // PI is created per-deal via `concierge-fee-${dealId}` and the webhook
    // resolves one PI to one deal, so a P2002 here is always the dealId
    // constraint — the dealId re-fetch returns the winning row.)
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return prisma.serviceFeePayment.findUnique({ where: { dealId } });
    }
    throw err;
  }
}

export type FeeIntentOutcome =
  /** Safe to collect payment — hand this client secret to the card form. */
  | { status: "ready"; clientSecret: string | null; paymentIntentId: string; netFeeCents: number }
  /**
   * The buyer's card has already been charged for this deal's fee (or a charge
   * is in flight) and our side has not recorded it. No new intent was created
   * and no client secret is returned: the only correct move is to tell them not
   * to pay again.
   */
  | { status: "charge_unsettled"; paymentIntentId: string; intentStatus: string };

// Has this deal's concierge fee already been charged?
//
// Unlike the $99 deposit — whose PENDING row carries `stripePaymentIntentId`
// from the moment the intent is created — the fee persists NO reference before
// settlement. `Deal.stripeFeePIId` is not available as a "pending" marker: it is
// read elsewhere as PROOF OF PAYMENT (app/buyer/billing filters paid deals by
// it; the admin refund route issues refunds against it), so writing it at
// creation time would manufacture exactly the fake-paid state this remediation
// exists to remove. `ServiceFeePayment` is no better — it is the settlement
// ledger, unique on dealId, and an unpaid row there would make
// writeServiceFeePayment return early and never stamp `paidAt`.
//
// So we ask the authority. Stripe knows what it charged; we do not. The PI
// carries `dealId` in metadata (the same field the webhook resolves on), which
// makes this answerable without inventing storage or a migration.
//
// Caveat, and why this is not the only guard: Stripe search is eventually
// consistent — a charge made seconds ago can be invisible for up to a minute.
// That window is covered by the post-create check in createFeePaymentIntent,
// which is strictly consistent for 24h via the idempotency key.
async function findSettledFeeIntent(
  stripe: ReturnType<typeof getStripe>,
  dealId: string,
): Promise<{ id: string; status: string } | null> {
  // dealId reaches here only after the route has matched it to a row owned by
  // this buyer, so it is a stored id rather than free text — but it is still
  // being interpolated into a query language, so escape rather than trust.
  const safeDealId = dealId.replace(/[\\"]/g, "\\$&");
  const query = `metadata["dealId"]:"${safeDealId}" AND metadata["type"]:"concierge_fee"`;
  // Matches admin-initiated fee intents too (they carry the same dealId and
  // type): if an admin link was already paid, the self-service form must not
  // charge the buyer a second time for the same fee.
  const found = await stripe.paymentIntents.search({ query, limit: 20 });
  for (const pi of found.data) {
    // One rule for "the buyer has been charged", shared with the deposit and
    // both confirmation pages — never a second interpretation of Stripe status.
    const outcome = classifyPaymentConfirmation({ intentStatus: pi.status, recordedStatus: null });
    if (wasCharged(outcome) || outcome === "processing") return { id: pi.id, status: pi.status };
  }
  return null;
}

export async function createFeePaymentIntent(
  dealId: string,
  buyerId: string,
): Promise<FeeIntentOutcome> {
  const stripe = getStripe();
  const netFee = PREMIUM_FEE_CENTS - DEPOSIT_AMOUNT_CENTS; // $400 net

  // DUPLICATE-CHARGE GUARD (P0 #4), the fee sibling of the deposit guard in
  // app/api/buyer/deposit/create-intent.
  //
  // The caller's only duplicate check is `deal.feePaidAt`, and that column is
  // written by exactly one path — recordFeePayment, reached only from the Stripe
  // webhook. No webhook has ever been delivered in production, so a buyer who
  // really paid still has feePaidAt === null and passes it. Nothing downstream
  // stopped a second charge either: Stripe retains idempotency keys for only
  // 24h, so the day after a real payment `concierge-fee-${dealId}` no longer
  // dedupes and a fresh $400 intent is minted for someone already charged.
  try {
    const charged = await findSettledFeeIntent(stripe, dealId);
    if (charged) {
      logger.warn(
        `[service-fee] blocked duplicate fee intent for deal ${dealId}: ` +
          `PI ${charged.id} is ${charged.status} with no recorded settlement`,
      );
      return { status: "charge_unsettled", paymentIntentId: charged.id, intentStatus: charged.status };
    }
  } catch (err) {
    // Deliberately fail OPEN on a lookup outage. Failing closed would block
    // every legitimate first-time fee payment platform-wide to guard against a
    // condition the post-create check below still catches for 24h — the wrong
    // trade. Loud, because a persistent failure here silently widens the window.
    logger.error(`[service-fee] fee-charge lookup failed for deal ${dealId}; falling through:`, err);
  }

  // Idempotency key scoped to the deal so concurrent buyer clicks reuse the
  // same Stripe PaymentIntent instead of spawning duplicates.
  const pi = await stripe.paymentIntents.create(
    {
      amount: netFee,
      currency: "usd",
      metadata: { dealId, buyerId, type: "concierge_fee" },
    },
    { idempotencyKey: `concierge-fee-${dealId}` },
  );

  // Strictly-consistent backstop for the search-lag window above. Within 24h the
  // idempotency key replays the ORIGINAL intent, so a `succeeded` status here
  // means this buyer already paid — handing back its client secret would put a
  // card form in front of them again. `recordedStatus` is null because the
  // caller has already established that no settlement is recorded (it returns
  // ALREADY_PAID, with a clearer message, when feePaidAt is set).
  const outcome = classifyPaymentConfirmation({ intentStatus: pi.status, recordedStatus: null });
  if (wasCharged(outcome) || outcome === "processing") {
    logger.warn(
      `[service-fee] idempotency key replayed a ${pi.status} intent for deal ${dealId}; ` +
        `withholding client secret (PI ${pi.id})`,
    );
    return { status: "charge_unsettled", paymentIntentId: pi.id, intentStatus: pi.status };
  }

  return {
    status: "ready",
    clientSecret: pi.client_secret,
    paymentIntentId: pi.id,
    netFeeCents: netFee,
  };
}

export async function recordFeePayment(dealId: string, paymentIntentId: string) {
  const existing = await prisma.serviceFeePayment.findUnique({ where: { dealId } });
  if (existing) return existing;
  const payment = await writeServiceFeePayment(dealId, paymentIntentId);
  // Route through the guarded seam: FEE_PENDING → FEE_PAID → INSURANCE_PENDING.
  // force is used because fee receipt is an authoritative payment fact; the
  // two-step keeps the lifecycle (and DealStatusHistory) consistent.
  await advanceDealStatus(dealId, "FEE_PAID", {
    actorRole: "SYSTEM",
    force: true,
    // feeAmountCents = amount actually charged for the fee (net of the $99
    // deposit credit). ServiceFeePayment above retains the gross/credit/net
    // breakdown; the deal ledger field is the captured charge so revenue
    // reports (which sum deposits + fees) never double-count the deposit.
    data: { feePaidAt: new Date(), feeAmountCents: PREMIUM_FEE_REMAINING_CENTS, stripeFeePIId: paymentIntentId },
  });
  await advanceDealStatus(dealId, "INSURANCE_PENDING", { actorRole: "SYSTEM", force: true });
  return payment;
}
