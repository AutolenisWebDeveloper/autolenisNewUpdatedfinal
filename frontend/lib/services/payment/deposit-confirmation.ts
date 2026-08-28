// lib/services/payment/deposit-confirmation.ts
//
// The ONE decision that turns "what Stripe says about this PaymentIntent" plus
// "what our Deposit row says" into what the buyer may truthfully be told.
//
// Why this is a module and not an inline branch on the page: the $99 deposit
// page previously made its claim from CLIENT state — `stripe.confirmPayment`
// resolving without an error rendered "Auction activated! Your private 48-hour
// auction is now live. Dealers are being invited." That resolution proves only
// that Stripe accepted the confirmation; it is not evidence that the money
// settled, that our Deposit flipped to PAID, or that any dealer was invited.
// Production has recorded ZERO Stripe webhook events, so the claim was false
// for every buyer who saw it. Extracting the decision here makes the honest
// mapping explicit, unit-testable, and impossible to satisfy from the client.
//
// It is a PURE function: no Prisma, no Stripe, no IO. Callers gather the two
// facts and pass them in.

/** Stripe PaymentIntent.status values this decision distinguishes. */
export type PaymentIntentStatusInput = string | null | undefined;

/** Deposit.status as stored by us; null when no Deposit row matches the intent. */
export type DepositStatusInput = string | null | undefined;

export type DepositConfirmationOutcome =
  /** Stripe settled AND our Deposit is PAID. The only state that may claim success. */
  | "settled"
  /** The bank is still confirming. Nothing was promised; nothing has failed. */
  | "processing"
  /**
   * Stripe says succeeded but our side has not recorded settlement — the Deposit
   * is still PENDING, or no Deposit row exists for this intent at all. The buyer
   * HAS been charged. This must never be presented as a failure, and must never
   * offer "return to payment": that invites a duplicate $99 charge for a payment
   * that already went through. It is the state a non-delivering webhook produces,
   * which is the live production condition.
   */
  | "charged_unsettled"
  /** Stripe reports a non-success, non-processing terminal status. */
  | "failed"
  /** No payment reference to check, or the provider could not be reached. */
  | "unknown";

export interface DepositConfirmationFacts {
  /** Stripe's PaymentIntent.status, or null if no reference / lookup failed. */
  intentStatus: PaymentIntentStatusInput;
  /** Our Deposit.status for that intent, or null when no row matched. */
  depositStatus: DepositStatusInput;
  /** False when there was no payment reference or the provider lookup threw. */
  providerReachable?: boolean;
}

/**
 * Decide what may truthfully be shown for a deposit confirmation.
 *
 * The asymmetry is deliberate: "settled" requires BOTH the provider and our own
 * record to agree, while "charged_unsettled" needs only the provider — because
 * a charge the buyer really paid must be acknowledged even when our bookkeeping
 * is behind. Optimism is allowed about the buyer's money, never about our
 * fulfillment.
 */
export function classifyDepositConfirmation(
  facts: DepositConfirmationFacts,
): DepositConfirmationOutcome {
  if (facts.providerReachable === false) return "unknown";
  if (!facts.intentStatus) return "unknown";

  if (facts.intentStatus === "succeeded") {
    return facts.depositStatus === "PAID" ? "settled" : "charged_unsettled";
  }
  if (facts.intentStatus === "processing") return "processing";
  return "failed";
}

/**
 * True when the outcome means the buyer's card was charged. Used to guarantee no
 * surface offers a re-payment CTA for money that already moved.
 */
export function wasCharged(outcome: DepositConfirmationOutcome): boolean {
  return outcome === "settled" || outcome === "charged_unsettled";
}

/**
 * True only when a surface may assert that the deposit is complete and
 * fulfillment has begun. Nothing else in the codebase may make that claim.
 */
export function mayClaimActivation(outcome: DepositConfirmationOutcome): boolean {
  return outcome === "settled";
}
