// lib/services/buyer/referral.service.ts — F25

import { prisma } from "@/lib/prisma";
import { COMMISSION_RATES, PREMIUM_FEE_REMAINING_CENTS } from "@/lib/constants";
import { countsTowardEarned } from "@/lib/services/affiliate/commission.service";

export async function getBuyerReferralStats(buyerId: string) {
  const affiliate = await prisma.affiliate.findFirst({
    where: { userId: (await prisma.buyer.findUnique({ where: { id: buyerId }, select: { userId: true } }))?.userId ?? "" },
    include: { commissions: { select: { amountCents: true, status: true } } },
  });

  if (!affiliate) return null;

  // M8 — one definition per fact across surfaces:
  //   referralCount = referred BUYERS (AffiliateReferral rows), never
  //   `children` (sub-affiliates — a different relationship);
  //   totalEarned follows the shared ledger rule (countsTowardEarned).
  const referralCount = await prisma.affiliateReferral.count({
    where: { affiliateId: affiliate.id },
  });
  const totalEarned = affiliate.commissions.filter(countsTowardEarned).reduce((s, c) => s + c.amountCents, 0);
  const referralCode = affiliate.referralCode;

  return {
    referralCode,
    referralLink: `${(process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim()}/auth/signup?ref=${referralCode}`,
    referralCount,
    totalEarnedCents: totalEarned,
    // M4 — advertise off the same constant the ledger pays on: 15% of the
    // captured $400, not of the $499 sticker.
    commissionPerDeal: Math.round(PREMIUM_FEE_REMAINING_CENTS * COMMISSION_RATES.LEVEL_1),
  };
}
