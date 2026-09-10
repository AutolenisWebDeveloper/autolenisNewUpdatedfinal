import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { limitPaymentIntent, clientIpKey } from "@/lib/security/rate-limit";
import { logger } from "@/lib/logger";

interface Props { params: Promise<{ dealId: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  // Card-testing guard: throttle intent creation per buyer and per source IP.
  // Fails CLOSED on limiter-store outage (see lib/security/rate-limit.ts).
  for (const key of [`fee:buyer:${buyer.id}`, `fee:ip:${clientIpKey(request.headers)}`]) {
    const rl = await limitPaymentIntent(key);
    if (!rl.ok) return errorResponse("RATE_LIMITED", rl.message, rl.status);
  }
  const deal = await prisma.deal.findFirst({ where: { id: dealId, buyerId: buyer.id } });
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);
  // Guard against duplicate charges: if the concierge fee has already been
  // recorded as paid we must not return a fresh client secret. The PI
  // service is idempotent at Stripe's layer, but this is the user-visible
  // backstop that prevents a "Pay" CTA from appearing post-payment.
  if (deal.feePaidAt) {
    return errorResponse("ALREADY_PAID", "Concierge fee already paid for this deal", 400);
  }
  // §23.2 / PAY-58 — THE UPGRADE WINDOW, and the gate this route did not have.
  //
  // This route had no plan check of any kind. Both admin twins refuse a non-Premium
  // buyer (`concierge-fee/create-intent`, `concierge-fee/send-link`), and only the UI
  // kept a Standard buyer away from here — so a Standard buyer who POSTed directly
  // received a $400 client secret for a plan they had not elected and a window that had
  // never opened.
  //
  // The window is the right gate rather than a plan-flag check, and it is stricter in
  // both directions: it requires a settled, unrefunded, undisputed $99 (the credit basis
  // §23.2 says must be true), it refuses once the balance has already settled, and it
  // will refuse after funding clears the moment Phase 8 writes that column. A
  // `buyers.plan` check would have allowed all three.
  //
  // A deal with no request link predates `deals.vehicle_request_id`. It is let through
  // with the reason logged rather than refused: the buyer had no part in that data
  // shape, and the duplicate-charge guards below still apply.
  if (deal.vehicleRequestId) {
    const { isUpgradeWindowOpen } = await import("@/lib/services/plan/upgrade-window.service");
    const window = await isUpgradeWindowOpen(deal.vehicleRequestId);
    if (!window.open) {
      return errorResponse("UPGRADE_WINDOW_CLOSED", window.detail, 400, { reason: window.reason });
    }
  } else {
    logger.warn(
      `[fee/create-intent] deal ${dealId} carries no vehicle_request_id — the §23.2 window ` +
        `could not be checked. Pre-Phase-3 shape.`,
    );
  }

  const { createFeePaymentIntent } = await import("@/lib/services/deal/service-fee.service");
  const intent = await createFeePaymentIntent(dealId, buyer.id);

  // `feePaidAt` above only catches a fee our own side has RECORDED, and the sole
  // writer of that column is the Stripe webhook, which has never been delivered.
  // The service therefore asks Stripe whether this deal's fee was already
  // charged; when it was, no intent was created and no client secret exists.
  // Same code and shape as the $99 deposit's guard, so the client can handle one
  // contract rather than two.
  if (intent.status === "charge_unsettled") {
    return errorResponse(
      "CHARGE_UNSETTLED",
      "We've received your payment. It isn't recorded on our side yet — please do not pay again.",
      409,
      { paymentIntentId: intent.paymentIntentId, intentStatus: intent.intentStatus },
    );
  }

  return successResponse({ clientSecret: intent.clientSecret });
}
