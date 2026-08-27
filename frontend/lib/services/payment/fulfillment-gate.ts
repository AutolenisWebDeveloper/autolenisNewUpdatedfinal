import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { retrievePaymentIntent } from "@/lib/services/payment/stripe.service";

// ---------------------------------------------------------------------------
// $99 PRE-ACTIVATION COST GATE — the single authoritative predicate.
//
// Invariant: NO PAID $99 = NO cost-bearing or dealer-facing fulfillment.
// Before an authoritative Stripe-confirmed $99 deposit, the system must NOT
// purchase/reveal paid Apollo contact data, send dealer recruitment/outreach,
// send dealer invitations, activate a competitive auction, or trigger bidding.
//
// This is the ONE shared gate used by pre-payment cost guards. "Paid" means the
// buyer has a Deposit whose status the Stripe webhook has authoritatively flipped
// to PAID (never a client-reported status, never a PENDING intent). It is the
// same fact `lib/qstash/state.hasPaidDeposit` reads; this module is the canonical
// name for the invariant so guards read as intent, not as an ad-hoc query.
//
// Cost-free internal processing that uses data AutoLenis already owns (e.g.
// dealer DISCOVERY writing prospect rows) is allowed pre-payment; only the
// progression into paid enrichment / outreach / invitation / auction execution
// is gated here.
// ---------------------------------------------------------------------------

/**
 * True iff the buyer has an authoritative PAID $99 deposit — the boundary that
 * unlocks cost-bearing / dealer-facing fulfillment. A missing buyer id (e.g. an
 * anonymous lead that cannot have paid) is never unlocked.
 */
export async function isFulfillmentUnlocked(
  buyerId: string | null | undefined,
): Promise<boolean> {
  if (!buyerId) return false;
  const paid = await prisma.deposit.findFirst({
    where: { buyerId, status: "PAID" },
    select: { id: true },
  });
  return paid !== null;
}

// ---------------------------------------------------------------------------
// WHICH fulfillment a settled $99 belongs to.
//
// Two tracks share the Deposit table and the same $99 amount:
//   • standard  — competitive: a LIVE auction is launched and dealers are invited.
//   • concierge — a CLOSED auction whose Offers are converted from an
//                 admin-curated review; dealers are NEVER invited to compete.
//
// The Deposit row carries no discriminator, so the authoritative signal is the
// SAME one the Stripe webhook branches on: `pi.metadata.type`, stamped at intent
// creation by every path that mints a deposit intent (buyer self-service, admin
// create-intent, admin send-link Checkout Session). Reading it here — rather
// than inferring a track from surrounding rows — keeps the admin/reconciler
// paths in literal parity with the webhook instead of guessing.
//
// Callers must FAIL CLOSED on "unknown": an indeterminate track may never be
// treated as standard, because running the competitive cascade on a concierge
// deposit invites dealers to bid on a deal that was never competitive.
// ---------------------------------------------------------------------------

export type DepositFulfillmentTrack = "standard" | "concierge" | "unknown";

/** Sandbox short-circuit intents (create-intent, non-production) — never real Stripe. */
const SANDBOX_INTENT_PREFIX = "pi_sandbox_mock_";

/**
 * Resolve the fulfillment track of a deposit. READ-ONLY: never writes a deposit,
 * an auction, or a PaymentProviderEvent.
 *
 * A deposit with no PaymentIntent is admin-minted and therefore standard by
 * construction — every concierge deposit is created through the buyer
 * create-intent path with a real PI stamped `type: "concierge_deposit"`.
 */
export async function resolveDepositFulfillmentTrack(
  depositId: string,
): Promise<DepositFulfillmentTrack> {
  const deposit = await prisma.deposit.findUnique({
    where: { id: depositId },
    select: { stripePaymentIntentId: true },
  });
  if (!deposit) return "unknown";

  const pi = deposit.stripePaymentIntentId;
  if (!pi || pi.startsWith(SANDBOX_INTENT_PREFIX)) return "standard";

  try {
    const intent = await retrievePaymentIntent(pi);
    const type = intent?.metadata?.type;
    if (type === "concierge_deposit") return "concierge";
    if (type === "deposit") return "standard";
    logger.warn(
      `[fulfillment-gate] deposit ${depositId} intent ${pi} carries no recognised metadata.type ` +
        `(${type ?? "absent"}) — track indeterminate, callers fail closed`,
    );
    return "unknown";
  } catch (err) {
    // A provider outage must not be read as "standard" — that is the optimistic
    // answer, and the optimistic answer is the one that invites dealers to a
    // concierge deal.
    logger.warn(`[fulfillment-gate] could not resolve track for deposit ${depositId} from ${pi}:`, err);
    return "unknown";
  }
}
