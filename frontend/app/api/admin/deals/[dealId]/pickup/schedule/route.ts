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

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

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

  // Notify buyer + dealer that pickup is scheduled — non-blocking.
  const pickupDateFormatted = scheduledDate.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  const pickupWindow = scheduledDate.toLocaleString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
  const dealWithParties = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      buyer: { include: { user: { select: { email: true } } } },
      offer: {
        include: {
          auction: true,
          dealer: { include: { user: { select: { email: true } } } },
        },
      },
    },
  });

  const buyerEmail = dealWithParties?.buyer?.user?.email;
  const buyerFirstName = dealWithParties?.buyer?.firstName ?? "there";
  if (buyerEmail) {
    await sendPickupReadyEmail(buyerEmail, buyerFirstName, pickupDateFormatted)
      .catch(err => console.error("[pickup/schedule] buyer email failed:", err));
  }

  const dealerEmail = dealWithParties?.offer?.dealer?.user?.email;
  if (dealerEmail) {
    const dealer = dealWithParties.offer.dealer;
    const vehicleRef = `Deal ${dealId.slice(0, 8)}`;
    await sendDealerPickupScheduledEmail({
      to: dealerEmail,
      contactName: dealer.dealershipName,
      vehicleRef,
      buyerCity: dealWithParties.buyer?.city ?? "",
      buyerState: dealWithParties.buyer?.state ?? "",
      pickupWindow,
      dealUrl: `${APP_URL}/dealer/deals/${dealId}`,
      dealId,
    }).catch(err => console.error("[pickup/schedule] dealer email failed:", err));
  }

  return adminSuccess({ success: true });
}
