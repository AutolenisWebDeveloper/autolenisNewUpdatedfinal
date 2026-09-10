// lib/services/deal/service-fee.service.ts — System 6
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { PREMIUM_FEE_CENTS, PREMIUM_FEE_REMAINING_CENTS } from "@/lib/constants";
import { quotePremiumBalance, type PremiumQuote } from "@/lib/services/plan/upgrade-window.service";
import { advanceDealStatus } from "@/lib/services/deal/deal.service";
import { logger } from "@/lib/logger";
import {
  classifyPaymentConfirmation,
  wasCharged,
} from "@/lib/services/payment/payment-confirmation";

/**
 * The vehicle request a deal belongs to. Null for a deal that predates the link.
 *
 * The plan rules are all per REQUEST (§23.1), and the fee is per DEAL, so every call
 * here has to cross that one join. Returning null rather than throwing lets the callers
 * fall back to the constant with a named reason instead of failing a payment.
 */
async function requestIdForDeal(dealId: string): Promise<string | null> {
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { vehicleRequestId: true } });
  return deal?.vehicleRequestId ?? null;
}

/**
 * The quote for a deal, or the constant when the deal carries no request link.
 *
 * The fallback is the pre-Phase-3 answer and is labelled as such. A deal with no
 * request predates `deals.vehicle_request_id`; refusing to price it would break a
 * payment for a data shape the buyer had no part in.
 */
async function quoteForDeal(dealId: string): Promise<PremiumQuote> {
  const requestId = await requestIdForDeal(dealId);
  if (!requestId) {
    logger.warn(
      `[service-fee] deal ${dealId} carries no vehicle_request_id; pricing Premium at the ` +
        `constant $400 balance. Pre-Phase-3 shape — the credit could not be verified against the ledger.`,
    );
    return {
      grossCents: PREMIUM_FEE_CENTS,
      creditCents: PREMIUM_FEE_CENTS - PREMIUM_FEE_REMAINING_CENTS,
      dueCents: PREMIUM_FEE_REMAINING_CENTS,
      creditBasis: "settled_deposit",
      explanation: "priced from the constant: this deal carries no vehicle request to reconcile against",
    };
  }
  return quotePremiumBalance(requestId);
}

// Idempotent ServiceFeePayment row writer — the ONE place `service_fee_payments`
// is created. Keyed on `dealId` (@unique): a repeat call (webhook retry, or a
// race with recordFeePayment) returns the existing row and never double-inserts.
// Row ONLY — it does NOT advance DealStatus, so the caller keeps its own
// source-checked, no-regress fee-advance logic. Retains the gross/credit/net
// breakdown for revenue reporting.
//
// PAY-52 — THE CREDIT IS COMPUTED, NOT ASSUMED. This wrote
// `depositCreditCents: DEPOSIT_AMOUNT_CENTS` unconditionally, with no deposit lookup at
// all. So for a buyer whose $99 was refunded or charged back, the settlement ledger
// asserted a $99 credit that did not exist and recorded $400 net against a $499 gross
// that had only ever been $400 of real money. §22.1 and §23.2 both rule the opposite:
// "Where it was refunded or charged back there is no credit, and Premium is $499
// gross." The DISPLAY side had already been corrected to look up a real PAID deposit;
// the LEDGER had not, so the two disagreed and the ledger was the one that was wrong.
export async function writeServiceFeePayment(dealId: string, paymentIntentId: string) {
  const existing = await prisma.serviceFeePayment.findUnique({ where: { dealId } });
  if (existing) return existing;
  const quote = await quoteForDeal(dealId);
  try {
    return await prisma.serviceFeePayment.create({
      data: {
        dealId,
        amountCents: quote.grossCents,
        depositCreditCents: quote.creditCents,
        netAmountCents: quote.dueCents,
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
  // PAY-52 / PAY-60 / PAY-61. The amount is the LEDGER's answer, not a constant: $499
  // less whatever $99 actually settled and was not refunded, disputed or charged back.
  // For a buyer with a broken credit basis that is $499 gross, which is what §23.2 says
  // it must be — and what this charged $400 for, silently, before.
  const quote = await quoteForDeal(dealId);
  const netFee = quote.dueCents;

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
    // THE KEY CARRIES THE AMOUNT. Stripe holds an idempotency key for 24 hours and
    // rejects a replay whose parameters differ, so a key scoped to the deal alone would
    // fail outright for a buyer whose $99 was charged back between two attempts — the
    // one case where the price legitimately changes. Including the amount means the
    // same price still de-duplicates concurrent clicks, and a changed price mints a new
    // intent instead of erroring.
    { idempotencyKey: `concierge-fee-${dealId}-${netFee}` },
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
  // THE AMOUNT ACTUALLY CHARGED, from the row that just recorded it.
  //
  // Found by the independent review: this stamped the $400 CONSTANT while the charge
  // became variable in this phase. For a buyer whose $99 was refunded or charged back
  // the credit basis is broken, `quotePremiumBalance` prices Premium at $499 gross and
  // Stripe takes $499 — and `deals.fee_amount_cents` still said 40000. The two ledgers
  // then disagreed by $99 on exactly the deals where the deposit contributed nothing,
  // so a revenue report summing deposits plus this column under-counted by the same $99
  // twice over.
  const chargedCents = payment?.netAmountCents ?? PREMIUM_FEE_REMAINING_CENTS;
  // Route through the guarded seam. Recording FEE_PAID is enough: the seam settles
  // the rest of the ladder on arrival (→ INSURANCE_PENDING, and on into the
  // insurance gate when proof is already on file). force is used because fee
  // receipt is an authoritative payment fact.
  await advanceDealStatus(dealId, "FEE_PAID", {
    actorRole: "SYSTEM",
    force: true,
    // feeAmountCents = amount actually charged for the fee, which is the gross less
    // whatever $99 genuinely settled — $400 in the ordinary case and $499 where the
    // credit basis is broken. `ServiceFeePayment` above retains the full
    // gross/credit/net breakdown; this column is the captured charge, so revenue
    // reports (which sum deposits + fees) never double-count the deposit and never
    // under-count a deal whose deposit went back.
    data: { feePaidAt: new Date(), feeAmountCents: chargedCents, stripeFeePIId: paymentIntentId },
  });
  return payment;
}
