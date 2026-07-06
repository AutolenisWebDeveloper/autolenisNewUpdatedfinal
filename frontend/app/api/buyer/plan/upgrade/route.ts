import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { NotificationType, NotificationChannel } from "@prisma/client";
import { logger } from "@/lib/logger";

// POST /api/buyer/plan/upgrade
// Upgrades an authenticated Standard buyer to Premium.
// Idempotent: returns success if already Premium. No charge happens here —
// the $499 Premium concierge fee is collected at the deal-payment stage.
export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  if (buyer.plan === "PREMIUM") {
    return successResponse({ plan: "PREMIUM", alreadyUpgraded: true });
  }

  // Upgrade plan. updateMany with a plan guard makes the flip race-safe: two
  // concurrent requests can't both record an upgrade (count tells us who won).
  const flipped = await prisma.buyer.updateMany({
    where: { id: buyer.id, plan: { not: "PREMIUM" } },
    data: {
      plan: "PREMIUM",
      planUpgradedAt: new Date(),
    },
  });
  if (flipped.count === 0) {
    return successResponse({ plan: "PREMIUM", alreadyUpgraded: true });
  }
  const updated = await prisma.buyer.findUniqueOrThrow({
    where: { id: buyer.id },
    select: { plan: true, planUpgradedAt: true },
  });

  // Audit the self-service plan change (non-blocking).
  await Promise.all([
    prisma.auditLog.create({
      data: {
        userId: buyer.userId ?? undefined,
        action: "STATUS_CHANGE",
        entityType: "buyer",
        entityId: buyer.id,
        reason: "Self-service plan upgrade STANDARD → PREMIUM (fee collected at deal payment).",
        metadata: { from: "STANDARD", to: "PREMIUM", selfService: true },
      },
    }),
    prisma.buyerActivityEvent.create({
      data: {
        buyerId: buyer.id,
        eventType: "PLAN_UPGRADED",
        title: "Upgraded to Premium plan",
        metadata: { from: "STANDARD", to: "PREMIUM", selfService: true },
      },
    }),
  ]).catch((e) => logger.error("[plan-upgrade] audit logging failed:", e));

  // Emit in-app notification
  await prisma.notification.create({
    data: {
      buyerId: buyer.id,
      type: NotificationType.SYSTEM_ALERT,
      channel: NotificationChannel.IN_APP,
      title: "Welcome to Premium",
      body: "You are now on the Premium plan. Your $99 deposit will be credited toward your $499 concierge fee — $400 net will be collected after you select your deal.",
      actionUrl: "/buyer/deal/payment",
    },
  });

  return successResponse({ plan: updated.plan, planUpgradedAt: updated.planUpgradedAt, alreadyUpgraded: false });
}
