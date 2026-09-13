import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { retrievePaymentIntent } from "@/lib/services/payment/stripe.service";
import { depositNotOnHold } from "@/lib/payments/deposit-state";

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
// to PAID (never a client-reported status, never a PENDING intent) AND which is not
// under a dispute/refund hold.
//
// `lib/qstash/state.hasPaidDeposit` reads a SIMILAR fact and is deliberately left
// alone. It answers a different question — "has this buyer converted, so stop
// chasing them?" — and for a disputed deposit the right answer to that is still
// YES, stop chasing. Folding it onto this gate would make the reminder series start
// dunning a buyer whose payment is under dispute, which is the opposite of what the
// hold exists to do. Two predicates that agree today on every row but one are not
// duplicates; they are two questions.
//
// Cost-free internal processing that uses data AutoLenis already owns (e.g.
// dealer DISCOVERY writing prospect rows) is allowed pre-payment; only the
// progression into paid enrichment / outreach / invitation / auction execution
// is gated here.
// ---------------------------------------------------------------------------

/**
 * True iff the buyer has an authoritative PAID $99 deposit that is NOT ON HOLD —
 * the boundary that unlocks cost-bearing / dealer-facing fulfillment. A missing
 * buyer id (e.g. an anonymous lead that cannot have paid) is never unlocked.
 *
 * THE HOLD CLAUSE IS WHAT MAKES §26's DISPUTE ROW MEAN ANYTHING (PAY-38b). Before
 * Phase 3 this predicate read `status: "PAID"` alone. A deposit could carry
 * `disputed_at` — set by the refund trigger, or left behind by a status flip that
 * lost its race — and still answer "unlocked", so dealer outreach, paid enrichment
 * and the AI action gate would all keep spending against a charge the buyer was
 * contesting. The hold is derived (`disputed_at IS NOT NULL AND hold_released_at
 * IS NULL`) and `depositNotOnHold()` is its negation, defined once in
 * `lib/payments/deposit-state.ts` so the gate cannot drift from the writer.
 *
 * A dispute the platform WINS releases the hold (`hold_released_at` is stamped and
 * the status returns to PAID), and this predicate then answers true again.
 *
 * NOT scoped to a Vehicle Request. PAY-30 would narrow it to
 * `(vehicleRequestId, PAID, unrefunded, undisputed)` — correct, and deliberately
 * NOT done here, because no caller at Phase 3 has a Vehicle Request to pass: the
 * three consumers (post-intake outreach, dealer-opportunity fan-out, the AI action
 * policy) hold a buyer id only, and `BuyerOpportunity` has a one-to-MANY relation
 * to requests rather than a single link. Adding a parameter nothing supplies would
 * ship a narrowing that never narrows, which is worse than not having it: the next
 * reader cannot tell whether it is enforced. The VR-bearing callers arrive with
 * Phase 5's sourcing-case and invitation services (PAY-40), and that is where the
 * scoping belongs. Reported, not silently skipped.
 */
export async function isFulfillmentUnlocked(
  buyerId: string | null | undefined,
): Promise<boolean> {
  if (!buyerId) return false;
  const paid = await prisma.deposit.findFirst({
    where: { buyerId, status: "PAID", ...depositNotOnHold() },
    select: { id: true },
  });
  return paid !== null;
}

/**
 * PAY-30 / PAY-40 / §10.6 S7-01b — the REQUEST-SCOPED gate the comment above deferred.
 *
 * "The VR-bearing callers arrive with Phase 5's sourcing-case and invitation services
 * (PAY-40), and that is where the scoping belongs." They have arrived, so it is scoped
 * here rather than in a second module: the sourcing ladder and the launch-readiness
 * checklist both hold a Vehicle Request, and §Stage 6's entry is "settled, undisputed
 * payment ATTACHED TO THE REQUEST".
 *
 * WHY A SEPARATE FUNCTION RATHER THAN A PARAMETER. The buyer-scoped predicate still has
 * three legitimate callers that hold no request (post-intake outreach, the
 * dealer-opportunity fan-out, the AI action policy), and the deferral note was explicit
 * that adding a parameter nothing supplies ships a narrowing that never narrows. Two
 * named predicates say which question is being asked; one predicate with an optional
 * argument does not.
 *
 * THE DIFFERENCE FROM THE BUYER-SCOPED VERSION IS NOT COSMETIC. A buyer with two requests
 * and one deposit passes the buyer-scoped gate for BOTH. §Stage 6 requires the payment be
 * attached to THIS request, and §33 step 29's "one deposit buys one invitation budget" is
 * meaningless if a second request can spend the first one's deposit. `deposits.vehicle_request_id`
 * is the Phase 1 column that makes the question answerable at all.
 *
 * Returns false — never throws — for a missing id, which is the same shape as its sibling.
 * A database failure propagates: a gate that answers "locked" because a query failed is
 * indistinguishable from one that answered on the facts.
 */
export async function isRequestFulfillmentUnlocked(
  vehicleRequestId: string | null | undefined,
): Promise<boolean> {
  if (!vehicleRequestId) return false;
  const paid = await prisma.deposit.findFirst({
    where: {
      vehicleRequestId,
      status: "PAID",
      refundedAt: null,
      ...depositNotOnHold(),
    },
    select: { id: true },
  });
  return paid !== null;
}

/**
 * The settled deposit bound to this request, or null. Same predicate as
 * `isRequestFulfillmentUnlocked`, returning the id because launch readiness must write
 * `auctions.deposit_id` (S7-17: "`auctions` linked to the Vehicle Request AND the
 * deposit") and the paid-enrichment gate records which deposit authorised a spend.
 */
export async function settledDepositForRequest(
  vehicleRequestId: string | null | undefined,
): Promise<{ id: string } | null> {
  if (!vehicleRequestId) return null;
  return prisma.deposit.findFirst({
    where: {
      vehicleRequestId,
      status: "PAID",
      refundedAt: null,
      ...depositNotOnHold(),
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
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
