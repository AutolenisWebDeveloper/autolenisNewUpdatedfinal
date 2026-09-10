import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { NotificationType, NotificationChannel } from "@prisma/client";
import { logger } from "@/lib/logger";
import { limitGeneral } from "@/lib/security/rate-limit";
import { recordPlanElection, recordRequestPlanElection } from "@/lib/services/buyer/plan-snapshot.service";
import { findOpenRequest } from "@/lib/services/vehicle-request/open-request.service";
import { isUpgradeWindowOpen, quotePremiumBalance } from "@/lib/services/plan/upgrade-window.service";

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

  // STAGE 1 — the plan election as a `plan_snapshots` row, not only as a flag.
  // `Buyer.plan` answers "what plan now" and destroys "what plan when"; §23's
  // upgrade window, Premium-balance reversion and post-settlement downgrade review
  // all turn on the second question. The flag write above is untouched.
  //
  // Awaited, unlike the audit row below: the snapshot IS the record of the
  // election, and an election with no record is the thing this replaces.
  await recordPlanElection({
    buyerId: buyer.id,
    plan: "PREMIUM",
    touchpoint: "buyer_dashboard_upgrade",
    actor: buyer.id,
    reason: "Self-service upgrade STANDARD → PREMIUM (no charge at this stage; fee collected at deal payment).",
  });

  // PHASE 3 — §23.1: PLAN IS ELECTED PER VEHICLE REQUEST.
  //
  // The buyer-level snapshot above is the DEFAULT ("the buyer record carries the current
  // default"); this binds the election to the request it is actually about ("the Vehicle
  // Request and the Deal carry the binding snapshot"). Without it the election is
  // recorded for the person and not for the transaction, and §23.4's "a buyer starts a
  // second Vehicle Request → new request, new $99, fresh plan election" has nowhere to
  // record the difference.
  //
  // The buyer-level writer would not have written this even if it had the request id: it
  // dedupes on the BUYER's latest plan, and after the row above the buyer is already
  // PREMIUM. That dedupe is right at buyer level and wrong at request level, which is
  // why the request-scoped writer exists.
  //
  // ELECTION IS STILL FREE, and deliberately (owner decision, 2026-07, above). What
  // Phase 3 changes is that electing is no longer the same thing as being entitled:
  // `entitledPlanForRequest` reads the ledger of settled payments, so the concierge is
  // never delivered unpaid (§23.1, PAY-57). This response says so rather than returning a
  // bare "PREMIUM" that reads as though something had been bought.
  let windowState: Awaited<ReturnType<typeof isUpgradeWindowOpen>> | null = null;
  let quote: Awaited<ReturnType<typeof quotePremiumBalance>> | null = null;
  const openRequest = await findOpenRequest(buyer.id);
  if (openRequest) {
    await recordRequestPlanElection({
      buyerId: buyer.id,
      vehicleRequestId: openRequest.id,
      plan: "PREMIUM",
      touchpoint: "buyer_dashboard_upgrade",
      actor: buyer.id,
      reason: "Self-service election STANDARD → PREMIUM for this request. The $400 balance is unpaid.",
    });
    windowState = await isUpgradeWindowOpen(openRequest.id);
    quote = await quotePremiumBalance(openRequest.id);
  }

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

  return successResponse({
    plan: updated.plan,
    planUpgradedAt: updated.planUpgradedAt,
    alreadyUpgraded: false,
    // §23.1 / PAY-57 — the election is recorded; the entitlement is not granted. Named
    // in the payload so a client cannot render "you are Premium" from a free flip.
    entitled: false,
    upgradeWindow: windowState,
    balance: quote,
  });
}
