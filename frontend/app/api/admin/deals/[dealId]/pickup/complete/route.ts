// POST /api/admin/deals/[dealId]/pickup/complete
// Admin manually overrides QR scan to mark pickup as COMPLETED.
// Sets Pickup.status = COMPLETED and Deal.status = COMPLETED.
// Sends buyer notification. AuditLog entry required.

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { advanceDealStatus } from "@/lib/services/deal/deal.service";
import { z } from "zod";
import {
  sendDealCompleteEmail,
  sendDealerPickupCompletedEmail,
  sendDealerPayoutInitiatedEmail,
} from "@/lib/services/email/resend.service";
import { syncGhlTag } from "@/lib/services/ghl/tag-sync";
import { scheduleLifecycleWorkload } from "@/lib/services/crm/lifecycle-scheduler";

interface Props { params: Promise<{ dealId: string }> }

const schema = z.object({
  reason: z.string().min(1, "Override reason is required"),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  // Force-completing a deal (bypasses the insurance gate) is a privileged override —
  // restrict to SUPER/OPERATIONS admins, consistent with the other override routes.
  if (!["SUPER_ADMIN", "OPERATIONS_ADMIN"].includes(admin.role)) {
    return adminError("FORBIDDEN", "Insufficient permissions — OPERATIONS_ADMIN or SUPER_ADMIN required", 403);
  }

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      pickup: true,
      buyer: { include: { user: { select: { email: true } } } },
      offer: { include: { dealer: { include: { user: { select: { email: true } } } } } },
    },
  });
  if (!deal) return adminError("NOT_FOUND", "Deal not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { reason } = parsed.data;

  // Upsert pickup record as COMPLETED
  const pickup = await prisma.pickup.upsert({
    where: { dealId },
    create: {
      dealId,
      status: "COMPLETED",
      completedAt: new Date(),
    },
    update: {
      status: "COMPLETED",
      completedAt: new Date(),
    },
  });

  // Advance deal to COMPLETED. This is an explicit admin override (reason required),
  // so the insurance gate is intentionally bypassed via force; recorded in history.
  await advanceDealStatus(dealId, "COMPLETED", {
    actorId: admin.adminId,
    actorRole: "ADMIN",
    reason,
    force: true,
  });

  // Notify buyer
  await prisma.notification.create({
    data: {
      buyerId: deal.buyerId,
      type: "DEAL_STAGE_CHANGED",
      channel: "IN_APP",
      title: "Vehicle pickup completed",
      body: "Your pickup has been manually confirmed by an admin. Congratulations on your new vehicle!",
    },
  });

  await createAuditLog(admin, request, {
    action: "PICKUP_MANUAL_OVERRIDE",
    entityType: "Deal",
    entityId: dealId,
    reason,
    metadata: { pickupId: pickup.id, previousStatus: deal.pickup?.status ?? "NONE", newStatus: "COMPLETED" },
  });

  // Send deal complete email — non-blocking
  try {
    const buyerEmail = deal.buyer?.user?.email;
    if (buyerEmail) {
      await sendDealCompleteEmail(buyerEmail, deal.buyer.firstName, dealId);
    }
  } catch (e) {
    logger.error("[pickup/complete] deal complete email failed:", e);
  }
  syncGhlTag(deal.buyer?.user?.email, "purchase-complete");

  // Lifecycle — congratulations + review-request sequence (the review touch, on
  // the internal path, also seeds the day-60 refinance + day-27 referral touches
  // via the drain's coupled postSend). Internal vs QStash is chosen per the
  // deal-complete activation flag (default QStash).
  if (deal.buyer?.user?.email) {
    scheduleLifecycleWorkload({
      workload: "deal_complete",
      buyerId: deal.buyerId,
      dealId,
      firstName: deal.buyer.firstName,
      email: deal.buyer.user.email,
    }).catch(() => {});
  }

  // Notify the dealer that pickup completed and payout is initiating — non-blocking.
  const dealerEmail = deal.offer?.dealer?.user?.email;
  if (dealerEmail) {
    const vehicleRef = `Deal ${dealId.slice(0, 8)}`;
    const dealershipName = deal.offer?.dealer?.dealershipName ?? "";
    await sendDealerPickupCompletedEmail({
      to: dealerEmail,
      contactName: dealershipName,
      vehicleRef,
      payoutSchedule: "3-5 business days",
      dealId,
    }).catch(err => logger.error("[pickup/complete] dealer pickup completed email failed:", err));

    const offerPriceCents = deal.offer?.otdPriceCents ?? 0;
    await sendDealerPayoutInitiatedEmail({
      to: dealerEmail,
      contactName: dealershipName,
      vehicleRef,
      amountCents: offerPriceCents,
      estimatedArrival: "3-5 business days",
      payoutId: dealId,
    }).catch(err => logger.error("[pickup/complete] dealer payout initiated email failed:", err));
  }

  // CRM event spine — emit purchase_completed for the buyer after the deal has
  // been marked COMPLETED. Additive tail call: a failure never affects the
  // pickup completion, which has already committed.
  try {
    const { emitDomainEvent } = await import("@/lib/events/emit");
    await emitDomainEvent("purchase_completed", {
      domainEntityId: dealId,
      contact: {
        email: deal.buyer?.user?.email ?? null,
        phone: deal.buyer?.phone ?? null,
        firstName: deal.buyer?.firstName,
        lastName: deal.buyer?.lastName,
        source: "buyer_signup",
      },
      data: {
        deal_id: dealId,
        buyer_id: deal.buyerId,
        pickup_id: pickup.id,
        completed_via: "admin_override",
      },
    });
  } catch (err) {
    logger.error("[pickup/complete] purchase_completed emit failed:", err);
  }

  return adminSuccess({
    dealId,
    dealStatus: "COMPLETED",
    pickupId: pickup.id,
    pickupStatus: "COMPLETED",
    completedAt: pickup.completedAt,
  });
}
