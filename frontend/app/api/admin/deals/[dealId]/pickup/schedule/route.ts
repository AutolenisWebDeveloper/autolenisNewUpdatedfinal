// POST /api/admin/deals/[dealId]/pickup/schedule
// Schedules (or reschedules) a pickup for a deal.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { schedulePickup } from "@/lib/services/pickup/pickup.service";
import {
  sendPickupReadyEmail,
  sendDealerPickupScheduledEmail,
} from "@/lib/services/email/resend.service";

interface Props { params: Promise<{ dealId: string }> }

const schema = z.object({
  scheduledAt: z.string().refine(v => !isNaN(Date.parse(v)), "Invalid date"),
  location: z.string().min(5, "Location must be at least 5 characters"),
});

const MIN_SCHEDULE_BUFFER_MS = 60_000; // 1 minute

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) return adminError("NOT_FOUND", "Deal not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { scheduledAt, location } = parsed.data;
  const scheduledDate = new Date(scheduledAt);
  // Require at least 1 minute in the future to avoid race conditions
  if (scheduledDate.getTime() < Date.now() + MIN_SCHEDULE_BUFFER_MS) {
    return adminError("VALIDATION_ERROR", "Scheduled date must be at least 1 minute in the future", 400);
  }

  await schedulePickup(dealId, scheduledDate, location);

  await createAuditLog(admin, request, {
    action: "PICKUP_SCHEDULED",
    entityType: "Deal",
    entityId: dealId,
    metadata: { scheduledAt, location },
  });

  // Notify buyer + dealer — non-blocking
  try {
    const dealWithAll = await prisma.deal.findUnique({
      where: { id: dealId },
      include: {
        buyer: { include: { user: { select: { email: true } } } },
        offer: {
          include: {
            dealer: { include: { user: { select: { email: true } } } },
          },
        },
      },
    });

    const pickupDateLabel = scheduledDate.toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });

    const buyerEmail = dealWithAll?.buyer?.user?.email;
    if (buyerEmail) {
      await sendPickupReadyEmail(buyerEmail, dealWithAll?.buyer?.firstName ?? "there", pickupDateLabel)
        .catch(err => console.error("[pickup/schedule] buyer email failed:", err));
    }

    const dealer = dealWithAll?.offer?.dealer;
    const dealerEmail = dealer?.user?.email;
    if (dealerEmail) {
      const buyerCity = dealWithAll?.buyer?.city ?? "Location";
      const buyerState = dealWithAll?.buyer?.state ?? "TBD";
      await sendDealerPickupScheduledEmail({
        to: dealerEmail,
        contactName: dealer?.dealershipName ?? "Dealer",
        vehicleRef: `Deal ${dealId.slice(0, 8)}`,
        buyerCity,
        buyerState,
        pickupWindow: `${pickupDateLabel} — ${location}`,
        dealUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dealer/deals/${dealId}`,
        dealId,
      }).catch(err => console.error("[pickup/schedule] dealer email failed:", err));
    }
  } catch (err) {
    console.error("[pickup/schedule] post-schedule email lookup failed:", err);
  }

  return adminSuccess({ success: true });
}
