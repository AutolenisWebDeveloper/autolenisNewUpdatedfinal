// lib/services/offer/best-price.service.ts
// System 4 — Best Price Engine: ranks offers by Cash, Monthly, Overall Value
// Weights from BestPriceWeightConfig (admin-configurable, fallback to defaults)

import { prisma } from "@/lib/prisma";

export interface RankedOffer {
  offerId: string;
  dealerId: string;
  dealerTier: string;
  otdPriceCents: number;
  junkFeesCents: number;
  monthlyPayment?: number;
  totalCostCents?: number;
  aprFlag?: string | null;
  aprRate?: number | null;
  rankCash: number;
  rankMonthly: number;
  rankOverall: number;
  overallScore: number;
}

function calculateMonthly(principal: number, aprRate: number, months: number): number {
  const r = aprRate / 12 / 100;
  if (r === 0) return Math.round(principal / months);
  return Math.round(principal * r / (1 - Math.pow(1 + r, -months)));
}

export async function rankOffers(auctionId: string, termMonths = 60): Promise<RankedOffer[]> {
  const offers = await prisma.offer.findMany({
    where: { auctionId, status: "SUBMITTED" },
    include: { dealer: { select: { id: true, tier: true, dealershipName: true } } },
    orderBy: { otdPriceCents: "asc" },
  });

  if (!offers.length) return [];

  // Get weight config (admin-configurable fallback to defaults)
  const weightConfig = await prisma.bestPriceWeightConfig.findFirst({ where: { isActive: true } })
    ?? { weightOtd: 0.4, weightMonthly: 0.25, weightFees: 0.2, weightJunkFees: 0.15 };

  // Compute metrics for each offer
  const withMetrics = offers.map(o => {
    const monthly = o.includesFinancing && o.aprRate && o.termMonths
      ? calculateMonthly(o.otdPriceCents, o.aprRate, o.termMonths)
      : undefined;

    const junkFeesCents = (o.junkFeeItems as Array<{amount: number}> | null)
      ?.reduce((s, f) => s + f.amount, 0) ?? 0;

    return { offer: o, monthly, junkFeesCents };
  });

  // Ranks (1 = best)
  const sortedByOtd = [...withMetrics].sort((a, b) => a.offer.otdPriceCents - b.offer.otdPriceCents);
  const sortedByMonthly = [...withMetrics].filter(o => o.monthly).sort((a, b) => (a.monthly ?? 0) - (b.monthly ?? 0));
  const sortedByJunk = [...withMetrics].sort((a, b) => a.junkFeesCents - b.junkFeesCents);

  return withMetrics.map(({ offer, monthly, junkFeesCents }) => {
    const rankCash = sortedByOtd.findIndex(o => o.offer.id === offer.id) + 1;
    const rankMonthly = sortedByMonthly.findIndex(o => o.offer.id === offer.id) + 1 || withMetrics.length;
    const rankJunk = sortedByJunk.findIndex(o => o.offer.id === offer.id) + 1;

    // Overall score (lower = better for cash/monthly/junk)
    const overallScore =
      (rankCash / withMetrics.length) * weightConfig.weightOtd +
      (rankMonthly / Math.max(sortedByMonthly.length, 1)) * weightConfig.weightMonthly +
      (rankJunk / withMetrics.length) * (weightConfig.weightFees + weightConfig.weightJunkFees);

    const rankOverall = 0; // Will be set after sort

    return {
      offerId: offer.id,
      dealerId: offer.dealerId,
      dealerTier: offer.dealer.tier,
      otdPriceCents: offer.otdPriceCents,
      junkFeesCents,
      monthlyPayment: monthly,
      aprFlag: offer.aprFlag,
      aprRate: offer.aprRate,
      rankCash,
      rankMonthly,
      rankOverall,
      overallScore,
    };
  }).map((r, _, arr) => {
    const sortedByOverall = [...arr].sort((a, b) => a.overallScore - b.overallScore);
    return { ...r, rankOverall: sortedByOverall.findIndex(o => o.offerId === r.offerId) + 1 };
  });
}

// Three canonical ranked offers for buyer comparison
export function selectTopOffers(ranked: RankedOffer[]): {
  bestCash: RankedOffer | null;
  bestMonthly: RankedOffer | null;
  bestOverall: RankedOffer | null;
} {
  const bestCash = ranked.find(r => r.rankCash === 1) ?? null;
  const bestMonthly = ranked.filter(r => r.monthlyPayment).find(r => r.rankMonthly === 1) ?? null;
  const bestOverall = ranked.find(r => r.rankOverall === 1) ?? null;
  return { bestCash, bestMonthly, bestOverall };
}
