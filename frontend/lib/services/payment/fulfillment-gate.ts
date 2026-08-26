import { prisma } from "@/lib/prisma";

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
