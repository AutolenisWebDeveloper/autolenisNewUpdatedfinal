// lib/services/referral/referral-milestone.service.ts
// GAP-CRIT #8 — awards referral milestones against ADMIN-CONFIGURABLE thresholds
// (ReferralMilestoneConfig). No hardcoded thresholds/amounts. Awarding is
// idempotent (a buyer earns each configured milestone at most once); payout
// stays a manual, admin-gated action (see /api/admin/referral-milestones/[id]/pay).

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

/**
 * Count how many buyers this buyer has referred. Uses the SAME metric the buyer
 * sees on their referral hub (affiliateReferral rows for the affiliate owned by
 * this buyer's user), so an earned milestone always matches the displayed count.
 */
async function getReferralCount(buyerId: string): Promise<number> {
  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, select: { userId: true } });
  if (!buyer?.userId) return 0;
  const affiliate = await prisma.affiliate.findFirst({
    where: { userId: buyer.userId },
    select: { id: true },
  });
  if (!affiliate) return 0;
  return prisma.affiliateReferral.count({ where: { affiliateId: affiliate.id } });
}

/**
 * Evaluate a buyer's referral count against the active configured thresholds and
 * award any newly-crossed milestones. Idempotent: the unique (buyerId,
 * milestone) index means re-running never double-awards. Never marks a milestone
 * paid — that remains a deliberate admin action.
 *
 * Returns the number of milestones newly awarded this call.
 */
export async function evaluateBuyerReferralMilestones(buyerId: string): Promise<number> {
  try {
    const [count, configs] = await Promise.all([
      getReferralCount(buyerId),
      prisma.referralMilestoneConfig.findMany({ where: { active: true }, orderBy: { threshold: "asc" } }),
    ]);
    if (count <= 0 || configs.length === 0) return 0;

    let awarded = 0;
    for (const cfg of configs) {
      if (count < cfg.threshold) continue;
      // Idempotent create: the (buyerId, milestone) unique index rejects a
      // duplicate award. Swallow P2002 (already earned) and continue.
      try {
        await prisma.referralMilestone.create({
          data: {
            buyerId,
            milestone: cfg.label,
            rewardType: cfg.rewardType,
            rewardValue: cfg.rewardValue,
            achieved: true,
            achievedAt: new Date(),
          },
        });
        awarded++;
      } catch (err) {
        const code = (err as { code?: string } | null)?.code;
        if (code !== "P2002") throw err;
      }
    }

    if (awarded > 0) {
      await prisma.notification
        .create({
          data: {
            buyerId,
            type: "SYSTEM_ALERT",
            title: "You earned a referral reward!",
            body: "You've hit a referral milestone. Our team will process your reward shortly.",
            actionUrl: "/buyer/referral",
          },
        })
        .catch(() => {});
    }

    return awarded;
  } catch (err) {
    // Best-effort: never let milestone evaluation break the caller (page load /
    // referral event). Log and move on.
    logger.error(`[referral-milestone] evaluation failed for buyer ${buyerId}:`, err);
    return 0;
  }
}
