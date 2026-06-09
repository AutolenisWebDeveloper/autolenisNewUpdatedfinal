// /admin/social/intelligence — AutoLenis Intelligence Index console.
// Server shell: enforces admin auth, computes the four composite index scores,
// and loads this week's competitor opportunities + top buyer markets.

import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { computeIntelligenceScores } from "@/lib/social/market-index.generator";
import IntelligenceClient, {
  type CompetitorInsightRow,
  type MarketRow,
} from "./IntelligenceClient";

export const dynamic = "force-dynamic";

export default async function IntelligencePage() {
  await requireAdmin();

  const weekOf = new Date().toISOString().split("T")[0];

  const insights = (await prisma.competitorInsight
    .findMany({ where: { weekOf }, orderBy: { estimatedEngagement: "desc" } })
    .catch(() => [])) as CompetitorInsightRow[];

  const markets = (await prisma.marketIntelligence
    .findMany({
      orderBy: { buyerLeverageScore: "desc" },
      take: 5,
      select: { metroName: true, buyerLeverageScore: true },
    })
    .catch(() => [])) as MarketRow[];

  // Composite scores for the four gauges — pure DB math, no Groq on page load.
  const scores = await computeIntelligenceScores().catch(() => ({
    weekOf,
    buyerPowerIndex: 0,
    dealerCompetitionIndex: 0,
    vehiclePricingIndex: 0,
    negotiationIndex: 0,
    trend: "stable" as const,
    topBuyerMarkets: [],
    topVehicles: [],
  }));

  return (
    <IntelligenceClient
      insights={insights}
      markets={markets}
      scores={{
        buyerPowerIndex: scores.buyerPowerIndex,
        dealerCompetitionIndex: scores.dealerCompetitionIndex,
        vehiclePricingIndex: scores.vehiclePricingIndex,
        negotiationIndex: scores.negotiationIndex,
        trend: scores.trend,
        weekOf: scores.weekOf,
      }}
    />
  );
}
