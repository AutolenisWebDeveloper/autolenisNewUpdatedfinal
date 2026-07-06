import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { NotificationType, NotificationChannel } from "@prisma/client";
import { logger } from "@/lib/logger";
import { limitGeneral } from "@/lib/security/rate-limit";

// POST /api/buyer/plan/upgrade
// Upgrades an authenticated Standard buyer to Premium.
// Idempotent: returns success if already Premium.
//
// INTENTIONALLY FREE AT THIS STAGE (owner decision, 2026-07): the no-charge
// upgrade is an acquisition lever — the $499 Premium concierge fee is
// monetized at deal close (deal-payment stage), not here. Do not add a charge
// to this endpoint without a product decision. The from→to audit metadata
// below doubles as the upgrade-funnel telemetry.
export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  if (buyer.plan === "PREMIUM") {
    return successResponse({ plan: "PREMIUM", alreadyUpgraded: true });
  }

  // Abuse guard on the self-service mutation (fails OPEN on store outage).
  const rl = await limitGeneral(`plan-upgrade:${buyer.id}`, { tokens: 5, window: "10 m" });
  if (!rl.ok) return errorResponse("RATE_LIMITED", rl.message, rl.status);

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
        reason: "Self-service plan upgrade STANDARD → PREMIUM (no charge at this stage; fee collected at deal payment).",
        // TODO(RBAC/Phase 4): add a PLAN_UPGRADED member to AdminActionType in
        // the first phase where a schema migration is acceptable; STATUS_CHANGE
        // is the closest existing enum value.
        metadata: {
          fromPlan: buyer.plan,
          toPlan: "PREMIUM",
          actor: "buyer",
          actorId: buyer.id,
          source: "self_service",
        },
      },
    }),
    prisma.buyerActivityEvent.create({
      data: {
        buyerId: buyer.id,
        eventType: "PLAN_UPGRADED",
        title: "Upgraded to Premium plan",
        metadata: {
          fromPlan: buyer.plan,
          toPlan: "PREMIUM",
          actor: "buyer",
          source: "self_service",
        },
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
