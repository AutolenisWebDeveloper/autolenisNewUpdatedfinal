import { prisma } from "@/lib/prisma";
import { getDealerViolationSummary, computeJunkFeeRatio } from "@/lib/services/contract-shield/violation-pattern.service";
import { dealerObligationRecord } from "@/lib/services/deal/post-completion-obligations.service";

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
  /**
   * §Stage 21: "Overdue obligations … register on the dealership scorecard."
   *
   * DERIVED AT READ TIME from the obligation rows, not incremented by the sweep. A counter
   * written when a row goes OVERDUE would be a second copy of a fact those rows already carry,
   * and the two would disagree the first time one was resolved.
   *
   * `resolvedLate` is here because the alternative rewards the pattern this stage exists to
   * surface: a dealership that lets every title run past its due date and then delivers would
   * show a clean scorecard the moment it caught up, and the buyers who drove on expired tags
   * would leave no trace.
   */
  postCompletionObligations: { openOverdue: number; resolvedLate: number; totalOpened: number };
  snapshots: Array<{ date: Date; tier: string; offerWinRate: number; dealCompletionRate: number }>;
  improvementTips: string[];
}

export async function computeDealerScorecard(dealerId: string, days = 90): Promise<DealerScorecard> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [invitationRows, offerRows, accepted, deals, snapshots, junkFeeRatioVal, obligations] = await Promise.all([
    prisma.auctionInvitation.findMany({
      where: { dealerId, sentAt: { gte: since } },
      select: { auctionId: true, sentAt: true },
    }),
    prisma.offer.findMany({
      where: { dealerId, status: "SUBMITTED", createdAt: { gte: since } },
      select: { auctionId: true, createdAt: true },
    }),
    prisma.offer.count({ where: { dealerId, status: "ACCEPTED", createdAt: { gte: since } } }),
    prisma.deal.count({ where: { offer: { dealerId }, status: "COMPLETED", createdAt: { gte: since } } }),
    prisma.dealerScorecardSnapshot.findMany({
      where: { dealerId },
      orderBy: { snapshotDate: "desc" },
      take: 30,
    }),
    computeJunkFeeRatio(dealerId),
    dealerObligationRecord(dealerId, since),
  ]);

  const invitations = invitationRows.length;
  const offers = offerRows.length;

  const offerWinRate = offers > 0 ? (accepted / offers) * 100 : 0;
  const dealCompletionRate = accepted > 0 ? (deals / accepted) * 100 : 0;
  const auctionResponseRate = invitations > 0 ? (offers / invitations) * 100 : 0;

  // Real average response time: hours between the auction invitation and the
  // dealer's submitted offer for the same auction (was previously hardcoded).
  const sentByAuction = new Map(invitationRows.map((i) => [i.auctionId, i.sentAt]));
  let responseHoursTotal = 0;
  let responseMatched = 0;
  for (const o of offerRows) {
    const sentAt = sentByAuction.get(o.auctionId);
    if (sentAt) {
      const hours = (o.createdAt.getTime() - sentAt.getTime()) / 3_600_000;
      if (hours >= 0) {
        responseHoursTotal += hours;
        responseMatched++;
      }
    }
  }
  const avgResponseHours =
    responseMatched > 0 ? Math.round((responseHoursTotal / responseMatched) * 10) / 10 : 0;

  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } });
  const tier = dealer?.tier ?? "STANDARD";

  // Improvement tips based on metrics
  const tips: string[] = [];
  if (offerWinRate < 20) tips.push("Your win rate is below platform average. Consider reviewing your OTD pricing vs. segment median.");
  if (junkFeeRatioVal > 30) tips.push("High junk fee ratio detected. Removing add-on fees improves win rate by up to 18%.");
  if (auctionResponseRate < 60) tips.push("Responding to more invitations increases your tier score and future invitation frequency.");
  if (dealCompletionRate < 70) tips.push("Improving deal completion rate (completing deals you win) is a key factor for Platinum tier.");
  // §Stage 21's consequence, stated to the party that can act on it. Named counts rather than a
  // score, because "your obligation score is 62" tells a dealership nothing it can do today.
  if (obligations.openOverdue > 0) {
    tips.push(
      `${obligations.openOverdue} post-completion obligation(s) are overdue — titles, trade payoffs, ` +
        "due-bill repairs or promised accessories. Reply to the overdue notice with the current status and our Operations team will update the record.",
    );
  } else if (obligations.resolvedLate > 0) {
    tips.push(
      `${obligations.resolvedLate} past obligation(s) were resolved after their due date. Buyers wait on ` +
        "titles and temporary tags; delivering on time is the single clearest signal of dealer quality.",
    );
  }
  if (tips.length === 0) tips.push("Your metrics look strong. Keep consistent offer quality to maintain or improve your tier.");

  return {
    tier, offerWinRate, dealCompletionRate, auctionResponseRate,
    avgResponseHours,
    junkFeeRatio: junkFeeRatioVal, invitationsReceived: invitations,
    offersSubmitted: offers, dealsWon: accepted,
    postCompletionObligations: obligations,
    snapshots: snapshots.map(s => ({
      date: s.snapshotDate, tier: s.tier,
      offerWinRate: s.offerWinRate, dealCompletionRate: s.dealCompletionRate,
    })),
    improvementTips: tips,
  };
}
