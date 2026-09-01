// lib/services/deal/service-fee.service.ts — System 6
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { PREMIUM_FEE_CENTS, DEPOSIT_AMOUNT_CENTS, PREMIUM_FEE_REMAINING_CENTS } from "@/lib/constants";
import { advanceDealStatus } from "@/lib/services/deal/deal.service";

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

export async function createFeePaymentIntent(dealId: string, buyerId: string) {
  const stripe = getStripe();
  const netFee = PREMIUM_FEE_CENTS - DEPOSIT_AMOUNT_CENTS; // $400 net
  // Idempotency key scoped to the deal so concurrent buyer clicks reuse the
  // same Stripe PaymentIntent instead of spawning duplicates. Stripe retains
  // idempotency keys for 24h; on the rare case of a buyer returning a day
  // later we fall through to a fresh PI, which is the correct behavior.
  const pi = await stripe.paymentIntents.create(
    {
      amount: netFee,
      currency: "usd",
      metadata: { dealId, buyerId, type: "concierge_fee" },
    },
    { idempotencyKey: `concierge-fee-${dealId}` },
  );
  return { clientSecret: pi.client_secret, paymentIntentId: pi.id, netFeeCents: netFee };
}

export async function recordFeePayment(dealId: string, paymentIntentId: string) {
  const existing = await prisma.serviceFeePayment.findUnique({ where: { dealId } });
  if (existing) return existing;
  const payment = await writeServiceFeePayment(dealId, paymentIntentId);
  // Route through the guarded seam. Recording FEE_PAID is enough: the seam settles
  // the rest of the ladder on arrival (→ INSURANCE_PENDING, and on into the
  // insurance gate when proof is already on file). force is used because fee
  // receipt is an authoritative payment fact.
  await advanceDealStatus(dealId, "FEE_PAID", {
    actorRole: "SYSTEM",
    force: true,
    // feeAmountCents = amount actually charged for the fee (net of the $99
    // deposit credit). ServiceFeePayment above retains the gross/credit/net
    // breakdown; the deal ledger field is the captured charge so revenue
    // reports (which sum deposits + fees) never double-count the deposit.
    data: { feePaidAt: new Date(), feeAmountCents: PREMIUM_FEE_REMAINING_CENTS, stripeFeePIId: paymentIntentId },
  });
  return payment;
}
