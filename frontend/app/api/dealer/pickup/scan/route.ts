// POST /api/dealer/pickup/scan — dealer scans buyer's pickup QR code to mark deal COMPLETED.
// Body: { qrToken: string }
// On success: pickup.status=COMPLETED, deal.status=COMPLETED, completedAt timestamps,
// BuyerActivityEvent emitted, Resend completion email fired (best-effort).

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";
import { INSURANCE_SATISFIED, advanceDealStatus, DealTransitionError } from "@/lib/services/deal/deal.service";
import { Resend } from "resend";

// Lazy Resend client — constructed on first use. Prevents Next.js build-time
// page data collection from throwing when RESEND_API_KEY isn't set.
let resendInstance: Resend | null = null;
function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.includes("placeholder")) return null;
  if (!resendInstance) resendInstance = new Resend(apiKey);
  return resendInstance;
}

export async function POST(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const body = await request.json().catch(() => ({}));
  const qrToken = (body as { qrToken?: string }).qrToken?.trim();
  if (!qrToken) return errorResponse("VALIDATION_ERROR", "qrToken is required", 400);

  const pickup = await prisma.pickup.findFirst({
    where: { qrCodeData: qrToken },
    include: { deal: { include: { offer: true, buyer: { include: { user: true } } } } },
  });
  if (!pickup) {
    return errorResponse("INVALID_TOKEN", "QR code not found or invalid.", 422);
  }

  // Token must belong to one of this dealer's offers
  if (pickup.deal.offer?.dealerId !== dealer.id) {
    return errorResponse("INVALID_TOKEN", "QR code is not valid for this dealer.", 422);
  }

  // Expiry check
  if (pickup.qrExpiresAt && pickup.qrExpiresAt <= new Date()) {
    return errorResponse("INVALID_TOKEN", "QR code has expired.", 422);
  }

  if (pickup.status === "COMPLETED" || pickup.deal.status === "COMPLETED") {
    return errorResponse("ALREADY_SCANNED", "This QR code has already been scanned.", 409);
  }

  // Insurance hard gate — a vehicle cannot be released/completed without proof of
  // insurance on file (a bound platform policy, verified, or the buyer's own-policy
  // upload). This is the final-release gate; earlier stages are not blocked.
  if (!INSURANCE_SATISFIED.includes(pickup.deal.insuranceStatus)) {
    return errorResponse(
      "INSURANCE_REQUIRED",
      "Insurance proof is required before this pickup can be completed.",
      409,
    );
  }

  const completedAt = new Date();

  // Route the lifecycle transition through the guarded seam (enforces canTransition
  // + the insurance gate; records DealStatusHistory). The pickup record + completion
  // activity event are written after the deal has advanced.
  try {
    await advanceDealStatus(pickup.dealId, "COMPLETED", { actorRole: "DEALER", reason: "Dealer QR pickup scan" });
  } catch (err) {
    if (err instanceof DealTransitionError) {
      return errorResponse("NOT_READY_FOR_PICKUP", "This deal is not ready for pickup completion.", 409);
    }
    throw err;
  }

  await prisma.$transaction([
    prisma.pickup.update({
      where: { id: pickup.id },
      data: { status: "COMPLETED", completedAt },
    }),
    prisma.buyerActivityEvent.create({
      data: {
        buyerId: pickup.deal.buyerId,
        eventType: "DEAL_COMPLETED",
        title: "Pickup confirmed — your deal is complete",
        metadata: { dealId: pickup.dealId, completedAt: completedAt.toISOString() },
      },
    }),
  ]);

  // Best-effort completion email via Resend
  const buyerEmail = pickup.deal.buyer.user.email;
  const resend = getResend();
  resend?.emails.send({
    from: `${process.env.FROM_NAME ?? "AutoLenis"} <noreply@autolenis.com>`,
    to: buyerEmail,
    subject: "Congratulations — your AutoLenis deal is complete",
    html: `<p>Hi ${pickup.deal.buyer.firstName},</p>
           <p>Your vehicle pickup has been confirmed by the dealer. The deal is now marked as <strong>COMPLETED</strong> in your AutoLenis account.</p>
           <p>You can view your final receipt and contract at <a href="${(process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim()}/buyer/deals/${pickup.dealId}/receipt">your dashboard</a>.</p>
           <p>Thank you for choosing AutoLenis.</p>`,
  }).catch(() => { /* non-fatal */ });

  // CRM event spine — emit purchase_completed for the buyer after the deal has
  // been marked COMPLETED. Keyed on dealId so this path and the admin-override
  // path collapse to one logical event. Additive tail call: a failure never
  // affects the scan, which has already committed.
  try {
    const { emitDomainEvent } = await import("@/lib/events/emit");
    await emitDomainEvent("purchase_completed", {
      domainEntityId: pickup.dealId,
      contact: {
        email: pickup.deal.buyer.user.email ?? null,
        phone: pickup.deal.buyer.phone ?? null,
        firstName: pickup.deal.buyer.firstName,
        lastName: pickup.deal.buyer.lastName,
        source: "buyer_signup",
      },
      data: {
        deal_id: pickup.dealId,
        buyer_id: pickup.deal.buyerId,
        pickup_id: pickup.id,
        completed_via: "dealer_qr_scan",
      },
    });
  } catch (err) {
    logger.error("[pickup/scan] purchase_completed emit failed:", err);
  }

  return successResponse({
    success: true,
    dealId: pickup.dealId,
    completedAt: completedAt.toISOString(),
  });
}
