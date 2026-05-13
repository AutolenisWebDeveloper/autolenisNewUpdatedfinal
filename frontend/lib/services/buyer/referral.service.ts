// lib/services/buyer/referral.service.ts — F25

import { prisma } from "@/lib/prisma";
import { COMMISSION_RATES, PREMIUM_FEE_CENTS } from "@/lib/constants";

export async function getBuyerReferralStats(buyerId: string) {
  const affiliate = await prisma.affiliate.findFirst({
    where: { userId: (await prisma.buyer.findUnique({ where: { id: buyerId }, select: { userId: true } }))?.userId ?? "" },
    include: { commissions: { select: { amountCents: true, status: true } }, children: { select: { id: true } } },
  });

  if (!affiliate) return null;

  const totalEarned = affiliate.commissions.filter(c => c.status !== "REVERSED").reduce((s, c) => s + c.amountCents, 0);
  const referralCount = affiliate.children.length;
  const referralCode = affiliate.referralCode;

  return {
    referralCode,
    referralLink: `${(process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim()}/auth/signup?ref=${referralCode}`,
    referralCount,
    totalEarnedCents: totalEarned,
    commissionPerDeal: Math.round(PREMIUM_FEE_CENTS * COMMISSION_RATES.LEVEL_1),
  };
}
