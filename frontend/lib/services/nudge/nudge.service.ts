// lib/services/nudge/nudge.service.ts — Feature 6 Smart Buyer Nudge Engine

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { NUDGE_DEFAULTS, DEPOSIT_AMOUNT_USD } from "@/lib/constants";
import { NudgeChannel, NudgeStage } from "@prisma/client";

export async function triggerNudge(buyerId: string, stage: NudgeStage): Promise<void> {
  const config = await prisma.nudgeConfiguration.findUnique({ where: { stage } })
    ?? { inAppDelayHours: NUDGE_DEFAULTS.PREQUAL_IDLE_HOURS, maxDismissals: NUDGE_DEFAULTS.MAX_DISMISSALS_BEFORE_STOP, cooldownHours: NUDGE_DEFAULTS.COOLDOWN_HOURS_AFTER_DISMISS };

  // Check dismissal count
  const dismissals = await prisma.nudgeEvent.count({
    where: { buyerId, stage: stage.toString(), dismissedAt: { not: null } },
  });
  if (dismissals >= config.maxDismissals) return;

  // Check cooldown
  const lastNudge = await prisma.nudgeEvent.findFirst({
    where: { buyerId, stage: stage.toString() },
    orderBy: { triggeredAt: "desc" },
  });
  if (lastNudge) {
    const hoursSince = (Date.now() - lastNudge.triggeredAt.getTime()) / 3600000;
    if (hoursSince < config.cooldownHours) return;
  }

  await prisma.nudgeEvent.create({
    data: { buyerId, stage: stage.toString(), channel: NudgeChannel.IN_APP },
  });

  const nudgeMessages: Record<NudgeStage, { title: string; body: string }> = {
    PREQUAL_IDLE: { title: "Your buying power awaits", body: "Complete your prequalification in 3 minutes — no credit score impact." },
    DEPOSIT_IDLE: { title: "Dealers are waiting", body: `Activate your auction with a ${DEPOSIT_AMOUNT_USD} deposit and let dealers compete.` },
    FINANCING_IDLE: { title: "Next step: financing", body: "Choose your financing path to move your deal forward." },
    INSURANCE_IDLE: { title: "Insurance needed", body: "Arrange coverage to continue with your deal." },
    EMAIL_IDLE: { title: "Your deal needs attention", body: "Log in to continue with your vehicle purchase." },
  };

  const msg = nudgeMessages[stage];
  if (msg) {
    await prisma.notification.create({
      data: { buyerId, title: msg.title, body: msg.body, type: "SYSTEM_ALERT" },
    }).catch(() => {});
  }
}

// Called by workflow-automation cron
export async function runNudgeEngine(): Promise<number> {
  let nudged = 0;
  const buyers = await prisma.buyer.findMany({
    where: { onboardingComplete: true },
    include: { preQualification: true, auctions: { where: { status: "ACTIVE" } }, deals: { where: { status: { notIn: ["COMPLETED", "CANCELLED"] } } } },
    take: 100,
  });

  for (const buyer of buyers) {
    if (!buyer.preQualification && buyer.onboardingComplete) {
      await triggerNudge(buyer.id, NudgeStage.PREQUAL_IDLE).catch(() => {});
      nudged++;
    } else if (buyer.preQualification && !buyer.auctions.length) {
      await triggerNudge(buyer.id, NudgeStage.DEPOSIT_IDLE).catch(() => {});
      nudged++;
    }
  }

  // ── Post-selection deal stage nudges ──────────────────────────────────────
  // The pre-deposit nudges above don't cover deals that stall mid-lifecycle.
  // Nudge buyers whose deals sit too long in a post-selection pending stage so
  // they don't go cold. Uses a stage-keyed NudgeEvent for a per-buyer cooldown.
  const dealNudgeConfigs = [
    {
      status: "FINANCING_PENDING" as const,
      thresholdHours: 24,
      title: "Complete your financing to move forward",
      body: "Your deal is waiting on financing confirmation. " +
        "Let us know how you would like to proceed.",
      actionUrl: "/buyer/deal/financing",
      notifType: "DEAL_STAGE_CHANGED" as const,
    },
    {
      status: "FEE_PENDING" as const,
      thresholdHours: 24,
      title: "Your concierge fee is ready",
      body: "Complete your one-time concierge fee to finalize " +
        "your deal and move to the next step.",
      actionUrl: "/buyer/fee",
      notifType: "FEE_PAID" as const,
    },
    {
      status: "INSURANCE_PENDING" as const,
      thresholdHours: 48,
      title: "Upload your insurance proof",
      body: "Your deal needs insurance verification before " +
        "we can schedule pickup.",
      actionUrl: "/buyer/insurance",
      notifType: "INSURANCE_BOUND" as const,
    },
    {
      status: "CONTRACT_PENDING" as const,
      thresholdHours: 24,
      title: "Your contract is ready to review",
      body: "Review your purchase contract to continue your deal.",
      actionUrl: "/buyer/contracts",
      notifType: "CONTRACT_READY" as const,
    },
    {
      status: "SIGNING_PENDING" as const,
      thresholdHours: 24,
      title: "Your contract is waiting for your signature",
      body: "E-sign your contract to finalize and prepare " +
        "for vehicle pickup.",
      actionUrl: "/buyer/esign",
      notifType: "SIGNING_READY" as const,
    },
  ] as const;

  for (const cfg of dealNudgeConfigs) {
    try {
      const cutoff = new Date(
        Date.now() - cfg.thresholdHours * 60 * 60 * 1000
      );

      const stuckDeals = await prisma.deal.findMany({
        where: {
          status: cfg.status,
          updatedAt: { lte: cutoff },
        },
        select: { id: true, buyerId: true },
        take: 50,
      });

      for (const deal of stuckDeals) {
        // 24h cooldown per buyer per stage.
        const nudgeStageKey = `deal_${cfg.status.toLowerCase()}`;
        const recentNudge = await prisma.nudgeEvent.findFirst({
          where: {
            buyerId: deal.buyerId,
            stage: nudgeStageKey,
            triggeredAt: {
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
            },
          },
          select: { id: true },
        });
        if (recentNudge) continue;

        await prisma.notification.create({
          data: {
            buyerId: deal.buyerId,
            type: cfg.notifType,
            title: cfg.title,
            body: cfg.body,
            actionUrl: cfg.actionUrl,
          },
        }).catch(() => {});

        await prisma.nudgeEvent.create({
          data: {
            buyerId: deal.buyerId,
            stage: nudgeStageKey,
            channel: NudgeChannel.IN_APP,
          },
        }).catch(() => {});

        nudged++;
      }
    } catch (err) {
      logger.error(
        `[nudge-engine] deal stage nudge failed for ${cfg.status}:`,
        err
      );
    }
  }

  return nudged;
}
