// lib/services/nudge/nudge.service.ts — Feature 6 Smart Buyer Nudge Engine

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
    DEPOSIT_IDLE: { title: "Dealers are waiting", body: `Activate your auction with a ${DEPOSIT_AMOUNT_USD} refundable deposit and let dealers compete.` },
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
  return nudged;
}
