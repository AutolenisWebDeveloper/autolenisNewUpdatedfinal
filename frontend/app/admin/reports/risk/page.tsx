// Feature 17 — Admin Deal Risk Intelligence
// Risk scoring computed from internal deal data only (no external APIs)
// Factors: deal stage timing, prequal expiry, contract shield score, insurance status, nudge dismissal count

import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { TrendingUp, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RiskTier } from "@prisma/client";

export const dynamic = "force-dynamic";

const TIER_COLORS: Record<RiskTier, string> = {
  LOW: "bg-green-100 text-green-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  HIGH: "bg-orange-100 text-orange-700",
  CRITICAL: "bg-red-100 text-red-700",
};

export default async function AdminRiskReportPage() {
  await requireAdmin();

  let deals: Awaited<ReturnType<typeof prisma.deal.findMany<{ include: { buyer: true; offer: { select: { otdPriceCents: true } }; contractScans: { orderBy: { scannedAt: "desc" }; take: 1 } } }>>> = [];
  let loadError: string | null = null;

  try {
    deals = await prisma.deal.findMany({
      where: { status: { notIn: ["COMPLETED", "CANCELLED", "REFUNDED"] } },
      include: {
        buyer: true,
        offer: { select: { otdPriceCents: true } },
        contractScans: { orderBy: { scannedAt: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error loading risk data";
  }

  // Compute risk score from internal data (Feature 17)
  function computeRisk(deal: typeof deals[0]): { score: number; tier: RiskTier; factors: string[] } {
    let score = 0;
    const factors: string[] = [];

    // Factor 1: Insurance not started past financing
    if (deal.status === "FEE_PAID" && deal.insuranceStatus === "NOT_STARTED") {
      score += 25; factors.push("Insurance not started");
    }
    // Factor 2: Contract scan failed
    if (deal.contractScans[0]?.status === "FAIL") {
      score += 30; factors.push("Contract Shield failed");
    }
    // Factor 3: Contract scan warning
    if (deal.contractScans[0]?.status === "WARNING") {
      score += 15; factors.push("Contract Shield warning");
    }
    // Factor 4: Deal age > 7 days in any non-final stage
    const ageHours = (Date.now() - deal.createdAt.getTime()) / 3600000;
    if (ageHours > 168) { // 7 days
      score += 20; factors.push("Deal stalled > 7 days");
    }
    // Factor 5: Insurance status failed
    if (deal.insuranceStatus === "FAILED") {
      score += 30; factors.push("Insurance failed");
    }

    const tier: RiskTier = score >= 81 ? "CRITICAL" : score >= 61 ? "HIGH" : score >= 31 ? "MEDIUM" : "LOW";
    return { score, tier, factors };
  }

  const riskData = deals.map(deal => ({ deal, ...computeRisk(deal) }));
  const tierCounts = riskData.reduce((acc, r) => { acc[r.tier] = (acc[r.tier] ?? 0) + 1; return acc; }, {} as Record<RiskTier, number>);

  return (
    <div className="p-6 md:p-8 max-w-5xl" data-testid="admin-risk-report-page">
      <div className="flex items-center gap-3 mb-6">
        <TrendingUp size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Deal Risk Intelligence</h1>
      </div>

      {loadError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 flex items-start gap-2 text-red-700" data-testid="risk-load-error">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-sm">Failed to load risk data</p>
            <p className="text-xs mt-0.5 font-mono">{loadError}</p>
          </div>
        </div>
      )}

      {/* Tier distribution */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as RiskTier[]).map(tier => (
          <div key={tier} data-testid={`risk-tier-${tier.toLowerCase()}`}
            className={`rounded-xl p-4 text-center ${TIER_COLORS[tier]}`}>
            <p className="text-2xl font-bold">{tierCounts[tier] ?? 0}</p>
            <p className="text-xs font-semibold mt-0.5 capitalize">{tier.toLowerCase()} Risk</p>
          </div>
        ))}
      </div>

      {!loadError && deals.length === 0 && (
        <div className="text-center py-12 text-slate-400" data-testid="no-risk-deals">No active deals to analyze</div>
      )}

      {/* Deal list */}
      <div className="space-y-2">
        {riskData.filter(r => r.tier !== "LOW").sort((a, b) => b.score - a.score).map(({ deal, score, tier, factors }) => (
          <div key={deal.id} data-testid={`risk-deal-${deal.id}`}
            className="flex items-start justify-between bg-white border border-slate-200 rounded-xl px-5 py-4">
            <div>
              <p className="font-semibold text-slate-900 text-sm">{deal.buyer?.firstName ?? ""} {deal.buyer?.lastName ?? ""}</p>
              <p className="text-xs text-slate-400">${((deal.offer?.otdPriceCents ?? 0) / 100).toLocaleString()} · {deal.status.replace(/_/g, " ")} · Score: {score}</p>
              {factors.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {factors.map(f => <span key={f} className="text-xs bg-red-50 text-red-600 px-1.5 py-0.5 rounded">{f}</span>)}
                </div>
              )}
            </div>
            <Badge className={`text-xs ${TIER_COLORS[tier]} border-0 ml-4`}>{tier}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
