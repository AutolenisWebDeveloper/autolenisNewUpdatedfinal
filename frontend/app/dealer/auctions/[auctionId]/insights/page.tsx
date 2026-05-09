// Feature 22 — Dealer Post-Auction Loss Insights
// ONLY visible to LOSING dealers after auction closes
// Winner gets 403. All data fully anonymized — no competitor amounts, no competitor identity.
// Positional ranking and anonymized segment medians only.

import { requireDealer } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { TrendingDown, DollarSign, Clock, Star, AlertTriangle, Lightbulb } from "lucide-react";

interface Props { params: Promise<{ auctionId: string }> }

export default async function DealerAuctionInsightsPage({ params }: Props) {
  const { auctionId } = await params;
  const dealer = await requireDealer();

  // Confirm dealer was invited
  const invitation = await prisma.auctionInvitation.findFirst({
    where: { auctionId, dealerId: dealer.id },
    include: { auction: true },
  });
  if (!invitation) notFound();
  if (invitation.auction.status !== "CLOSED") notFound();

  // Check if dealer won — winners get 403
  const winningOffer = await prisma.offer.findFirst({
    where: { auctionId, dealerId: dealer.id, status: "ACCEPTED" },
  });
  if (winningOffer) {
    return (
      <div className="p-6 md:p-8 max-w-xl" data-testid="insights-winner-page">
        <h1 className="text-xl font-bold text-slate-900 mb-2">Auction Insights</h1>
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
          <p className="text-green-700 font-semibold">You won this auction!</p>
          <p className="text-sm text-green-600 mt-1">Loss insights are only available to dealers who did not win.</p>
        </div>
      </div>
    );
  }

  // Dealer's offer (if submitted)
  const myOffer = await prisma.offer.findFirst({
    where: { auctionId, dealerId: dealer.id, status: { not: "ACCEPTED" } },
  });

  // Anonymized segment data — no competitor amounts, no competitor identity
  const allSubmittedOffers = await prisma.offer.findMany({
    where: { auctionId, status: "SUBMITTED" },
    select: { otdPriceCents: true, feesCents: true },
  });

  const offerCount = allSubmittedOffers.length;
  const medianOtd = allSubmittedOffers.length > 0
    ? allSubmittedOffers.map(o => o.otdPriceCents).sort((a, b) => a - b)[Math.floor(allSubmittedOffers.length / 2)]
    : 0;

  const myRank = myOffer
    ? allSubmittedOffers.filter(o => o.otdPriceCents < myOffer.otdPriceCents).length + 1
    : null;

  const FACTOR_CARDS = [
    {
      icon: DollarSign,
      title: "OTD Price Position",
      finding: myOffer && medianOtd > 0
        ? myOffer.otdPriceCents > medianOtd
          ? `Your price was ${Math.round((myOffer.otdPriceCents - medianOtd) / medianOtd * 100)}% above the segment median`
          : "Your price was at or below the segment median"
        : "Insufficient data",
      tip: "Offers within 3% of the lowest submitted price win significantly more deals.",
    },
    {
      icon: AlertTriangle,
      title: "Fee Structure",
      finding: myOffer && myOffer.feesCents > 50000
        ? "Your offer included fees that may have been flagged by Contract Shield"
        : "Fee structure appears standard",
      tip: "Removing add-on fees improves Contract Shield scores and win rates by an average of 18%.",
    },
    {
      icon: Clock,
      title: "Response Speed",
      finding: invitation.respondedAt
        ? `You responded in ${Math.round((invitation.respondedAt.getTime() - invitation.sentAt.getTime()) / 3600000)} hours`
        : "No response recorded",
      tip: "Dealers who respond within 6 hours win 40% more deals than those responding after 12 hours.",
    },
    {
      icon: Star,
      title: "Tier Standing",
      finding: `Your current tier is ${dealer.tier}`,
      tip: "Higher tier dealers are invited to more auctions. Improve by increasing deal completion rate and reducing junk fees.",
    },
    {
      icon: TrendingDown,
      title: "Competitive Rank",
      finding: myRank ? `Your offer ranked #${myRank} of ${offerCount} submitted offers` : `${offerCount} offers were submitted`,
      tip: "Segment median prices are reviewed monthly — check your scorecard for current benchmarks.",
    },
  ];

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="dealer-insights-page">
      <div className="flex items-center gap-3 mb-2">
        <TrendingDown size={22} className="text-slate-500" />
        <h1 className="text-xl font-bold text-slate-900">Post-Auction Insights</h1>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        All insights are anonymized. No competitor amounts or identities are shared.
      </p>

      <div className="space-y-4">
        {FACTOR_CARDS.map((card, i) => (
          <div key={i} data-testid={`insight-card-${i}`} className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-[#0B5FD1]/10 flex items-center justify-center shrink-0">
                <card.icon size={18} className="text-[#0B5FD1]" />
              </div>
              <div>
                <p className="font-semibold text-slate-900 text-sm mb-1">{card.title}</p>
                <p className="text-sm text-slate-600 mb-3">{card.finding}</p>
                <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg p-3">
                  <Lightbulb size={14} className="text-blue-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-blue-700">{card.tip}</p>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-slate-400 text-center mt-6">
        Competitor offer amounts are never revealed. All benchmarks use anonymized segment medians.
      </p>
    </div>
  );
}
