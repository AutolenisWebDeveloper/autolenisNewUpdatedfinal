// lib/services/deal/service-fee.service.ts — System 6
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { PREMIUM_FEE_CENTS, DEPOSIT_AMOUNT_CENTS } from "@/lib/constants";
import { advanceDealStatus } from "@/lib/services/deal/deal.service";

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
  const payment = await prisma.serviceFeePayment.create({
    data: { dealId, amountCents: PREMIUM_FEE_CENTS, depositCreditCents: DEPOSIT_AMOUNT_CENTS, netAmountCents: PREMIUM_FEE_CENTS - DEPOSIT_AMOUNT_CENTS, stripePaymentIntentId: paymentIntentId, paidAt: new Date() },
  });
  // Route through the guarded seam: FEE_PENDING → FEE_PAID → INSURANCE_PENDING.
  // force is used because fee receipt is an authoritative payment fact; the
  // two-step keeps the lifecycle (and DealStatusHistory) consistent.
  await advanceDealStatus(dealId, "FEE_PAID", {
    actorRole: "SYSTEM",
    force: true,
    data: { feePaidAt: new Date(), feeAmountCents: PREMIUM_FEE_CENTS, stripeFeePIId: paymentIntentId },
  });
  await advanceDealStatus(dealId, "INSURANCE_PENDING", { actorRole: "SYSTEM", force: true });
  return payment;
}
