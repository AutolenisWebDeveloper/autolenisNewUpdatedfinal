import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { NotificationType, NotificationChannel } from "@prisma/client";
import { logger } from "@/lib/logger";
import { limitGeneral } from "@/lib/security/rate-limit";
import { recordPlanElection, recordRequestPlanElection, upgradeTouchpointOf } from "@/lib/services/buyer/plan-snapshot.service";
import type { UpgradeTouchpoint } from "@/lib/services/plan/upgrade-suppression.service";
import { recordConversion } from "@/lib/services/plan/upgrade-touchpoint.service";
import { findOpenRequest } from "@/lib/services/vehicle-request/open-request.service";
import { isUpgradeWindowOpen, quotePremiumBalance } from "@/lib/services/plan/upgrade-window.service";
import { hasOpenException } from "@/lib/services/operations/exception-lineage.service";
import { raiseException } from "@/lib/services/operations/queue-item.service";

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

  // WHICH TOUCHPOINT CONVERTED — PAY-77, and the numerator of the whole §23.2a measurement.
  //
  // The label is VALIDATED against §23.2a's five rather than stored as given: `touchpoint` reaches
  // `plan_snapshots`, which carries an append-only trigger, so a client-supplied string would be
  // permanently unfixable — and a per-touchpoint conversion query would silently miss it. An
  // unrecognised or absent value falls back to the surface this route has always been, which is
  // the honest answer for a buyer who navigated here themselves.
  let convertedFrom: UpgradeTouchpoint | null = null;
  try {
    const body = (await request.clone().json()) as { touchpoint?: unknown };
    if (typeof body?.touchpoint === "string") {
      convertedFrom = upgradeTouchpointOf(body.touchpoint);
    }
  } catch {
    // No body, or not JSON. The self-service case; nothing to attribute.
  }

  if (buyer.plan === "PREMIUM") {
    return successResponse({ plan: "PREMIUM", alreadyUpgraded: true });
  }

  // §26 — "Upgrade prompt fires during an open exception | Operations | Suppress;
  // never upsell a buyer whose deal is stalled."
  //
  // THE SERVER IS WHERE THIS HAS TO HOLD. The dashboard already hides the card while
  // an exception is open, but a hidden card is UX: this route is reachable directly,
  // from a stale page, or from any surface that has not been taught the rule yet.
  // Server-side authorization always (CLAUDE.md golden rule 3).
  //
  // AND THE ATTEMPT IS THE EXCEPTION, which is why the raise site is here and not on
  // the render. Raising on every dashboard paint would flood the queue with a row per
  // page view and say nothing; a buyer who actually reached the upgrade action while
  // their transaction is held is one occurrence, worth one Operations row, and names
  // the surface that offered it.
  if (await hasOpenException(buyer.id)) {
    await raiseException({
      code: "UPGRADE_PROMPT_DURING_OPEN_EXCEPTION",
      buyerId: buyer.id,
      detail: `Upgrade attempted from ${convertedFrom ?? "self-service"} while an exception was open. The upgrade was refused.`,
    }).catch(() => {
      // The refusal stands whether or not the case opens. Failing the upgrade because
      // the queue write failed would punish the buyer for our bookkeeping.
    });
    return errorResponse(
      "EXCEPTION_OPEN",
      "Your purchase has an open item that needs resolving before plan changes. We will let you know as soon as it clears.",
      409,
    );
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
    touchpoint: convertedFrom ?? "buyer_dashboard_upgrade",
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
      touchpoint: convertedFrom ?? "buyer_dashboard_upgrade",
      actor: buyer.id,
      reason: "Self-service election STANDARD → PREMIUM for this request. The $400 balance is unpaid.",
    });

    // §23.2a's conversion counter, alongside the snapshot stamp. Two records of one fact, and
    // deliberately: the snapshot answers "what plan, elected when, from where" for the
    // transaction, and the activity event is the funnel's own series, queryable per touchpoint
    // without reading the append-only plan ledger.
    if (convertedFrom) {
      await recordConversion({
        buyerId: buyer.id,
        vehicleRequestId: openRequest.id,
        touchpoint: convertedFrom,
      });
    }
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
