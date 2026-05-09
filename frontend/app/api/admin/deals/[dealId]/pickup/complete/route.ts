// POST /api/admin/deals/[dealId]/pickup/complete
// Admin manually overrides QR scan to mark pickup as COMPLETED.
// Sets Pickup.status = COMPLETED and Deal.status = COMPLETED.
// Sends buyer notification. AuditLog entry required.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { sendDealCompleteEmail } from "@/lib/services/email/resend.service";

interface Props { params: Promise<{ dealId: string }> }

const schema = z.object({
  reason: z.string().min(1, "Override reason is required"),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      pickup: true,
      buyer: { include: { user: { select: { email: true } } } },
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

  // Advance deal to COMPLETED
  await prisma.deal.update({
    where: { id: dealId },
    data: { status: "COMPLETED" },
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
    console.error("[pickup/complete] deal complete email failed:", e);
  }

  return adminSuccess({
    dealId,
    dealStatus: "COMPLETED",
    pickupId: pickup.id,
    pickupStatus: "COMPLETED",
    completedAt: pickup.completedAt,
  });
}
