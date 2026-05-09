import { prisma } from "@/lib/prisma";
import { getDealerViolationSummary, computeJunkFeeRatio } from "@/lib/services/contract-shield/violation-pattern.service";

export interface DealerScorecard {
  tier: string;
  offerWinRate: number;
  dealCompletionRate: number;
  auctionResponseRate: number;
  avgResponseHours: number;
  junkFeeRatio: number;
  invitationsReceived: number;
  offersSubmitted: number;
  dealsWon: number;
  snapshots: Array<{ date: Date; tier: string; offerWinRate: number; dealCompletionRate: number }>;
  improvementTips: string[];
}

export async function computeDealerScorecard(dealerId: string, days = 90): Promise<DealerScorecard> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [invitations, offers, accepted, deals, snapshots, junkFeeRatioVal] = await Promise.all([
    prisma.auctionInvitation.count({ where: { dealerId, sentAt: { gte: since } } }),
    prisma.offer.count({ where: { dealerId, status: "SUBMITTED", createdAt: { gte: since } } }),
    prisma.offer.count({ where: { dealerId, status: "ACCEPTED", createdAt: { gte: since } } }),
    prisma.deal.count({ where: { offer: { dealerId }, status: "COMPLETED", createdAt: { gte: since } } }),
    prisma.dealerScorecardSnapshot.findMany({
      where: { dealerId },
      orderBy: { snapshotDate: "desc" },
      take: 30,
    }),
    computeJunkFeeRatio(dealerId),
  ]);

  const offerWinRate = offers > 0 ? (accepted / offers) * 100 : 0;
  const dealCompletionRate = accepted > 0 ? (deals / accepted) * 100 : 0;
  const auctionResponseRate = invitations > 0 ? (offers / invitations) * 100 : 0;

  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } });
  const tier = dealer?.tier ?? "STANDARD";

  // Improvement tips based on metrics
  const tips: string[] = [];
  if (offerWinRate < 20) tips.push("Your win rate is below platform average. Consider reviewing your OTD pricing vs. segment median.");
  if (junkFeeRatio(0, offers) > 30) tips.push("High junk fee ratio detected. Removing add-on fees improves win rate by up to 18%.");
  if (auctionResponseRate < 60) tips.push("Responding to more invitations increases your tier score and future invitation frequency.");
  if (dealCompletionRate < 70) tips.push("Improving deal completion rate (completing deals you win) is a key factor for Platinum tier.");
  if (tips.length === 0) tips.push("Your metrics look strong. Keep consistent offer quality to maintain or improve your tier.");

  return {
    tier, offerWinRate, dealCompletionRate, auctionResponseRate,
    avgResponseHours: 8,
    junkFeeRatio: junkFeeRatioVal, invitationsReceived: invitations,
    offersSubmitted: offers, dealsWon: accepted,
    snapshots: snapshots.map(s => ({
      date: s.snapshotDate, tier: s.tier,
      offerWinRate: s.offerWinRate, dealCompletionRate: s.dealCompletionRate,
    })),
    improvementTips: tips,
  };
}

function junkFeeRatio(_junkFees: number, total: number): number {
  return total > 0 ? (_junkFees / total) * 100 : 0;
}
