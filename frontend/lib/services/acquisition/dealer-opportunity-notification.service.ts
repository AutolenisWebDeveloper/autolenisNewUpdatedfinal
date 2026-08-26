// lib/services/acquisition/dealer-opportunity-notification.service.ts
//
// Notifies already-onboarded ACTIVE marketplace dealers that a new buyer
// opportunity exists (a link to /dealer/opportunities). This is DEALER-FACING
// fulfillment, so it is subject to the $99 pre-activation cost gate: it must NOT
// fire before an authoritative PAID $99 deposit for the buyer behind the request.
//
// A public request submission stands up a buyer identity for CRM linking, but
// that buyer has not paid — so isFulfillmentUnlocked() is false and the fan-out
// is held. Once the $99 is paid, the deposit -> auction webhook performs the
// scored, targeted dealer invitation (inviteDealersToAuction); this broadcast is
// the pre-payment case, and the gate keeps it off until the boundary is crossed.
//
// Extracted from app/api/public/request-vehicle/route.ts (thin-route rule) so the
// gate is applied in one place and is unit-testable.

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { sendDealerNewBuyerOpportunityEmail } from "@/lib/services/email/resend.service";
import { isFulfillmentUnlocked } from "@/lib/services/payment/fulfillment-gate";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();
const MAX_DEALERS = 20;

export interface NotifyActiveDealersInput {
  /** Buyer behind the request (null for an unresolved/anonymous lead → never unlocked). */
  buyerId: string | null;
  /** Opportunity/notification id used for the email idempotency key + deep link. */
  opportunityId: string;
  vehicleInterest: string;
  buyerCity?: string | null;
  buyerState?: string | null;
}

export interface NotifyActiveDealersResult {
  notified: number;
  /** True when the $99 gate held the fan-out (no PAID deposit). */
  gated: boolean;
}

// Fan out the new-buyer-opportunity notification to ACTIVE dealers — but only
// after the $99 boundary is crossed. Never throws (per-dealer sends are
// best-effort; a dealer-lookup failure degrades to zero).
export async function notifyActiveDealersOfOpportunity(
  input: NotifyActiveDealersInput,
): Promise<NotifyActiveDealersResult> {
  // $99 PRE-ACTIVATION COST GATE — dealer-facing fulfillment must not precede
  // an authoritative PAID deposit.
  if (!(await isFulfillmentUnlocked(input.buyerId))) {
    logger.info(
      `[dealer-opportunity-notify] gated — awaiting $99 deposit (opportunity ${input.opportunityId})`,
    );
    return { notified: 0, gated: true };
  }

  const activeDealers = await prisma.dealer
    .findMany({
      where: { status: "ACTIVE" },
      include: { user: { select: { email: true } } },
      take: MAX_DEALERS,
    })
    .catch(() => [] as Array<{ dealershipName: string; user: { email: string } | null }>);

  let notified = 0;
  for (const dealer of activeDealers) {
    if (!dealer.user?.email) continue;
    await sendDealerNewBuyerOpportunityEmail({
      to: dealer.user.email,
      contactName: dealer.dealershipName,
      vehicleInterest: input.vehicleInterest,
      buyerCity: input.buyerCity ?? "",
      buyerState: input.buyerState ?? "",
      opportunityUrl: `${APP_URL}/dealer/opportunities`,
      opportunityId: input.opportunityId,
    }).catch(() => {
      /* silent per-dealer — one bad address never blocks the rest */
    });
    notified++;
  }
  return { notified, gated: false };
}
