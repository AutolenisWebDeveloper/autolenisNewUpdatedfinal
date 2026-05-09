// lib/services/deal/deal-risk.service.ts
// Feature 17 — Deal Risk Intelligence
// Computed from internal deal data ONLY — no external APIs

import { prisma } from "@/lib/prisma";
import { RiskTier } from "@prisma/client";
import { DEAL_RISK_TIERS } from "@/lib/constants";

export interface RiskAssessment {
  score: number;
  tier: RiskTier;
  factors: Array<{ name: string; impact: number; description: string }>;
}

export async function computeDealRisk(dealId: string): Promise<RiskAssessment> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      buyer: { include: { preQualification: true } },
      offer: true,
      contractScans: { orderBy: { scannedAt: "desc" }, take: 1 },
    },
  });

  if (!deal) throw new Error("Deal not found");

  let score = 0;
  const factors: RiskAssessment["factors"] = [];

  // Factor 1: Insurance not started past FEE_PAID
  if (["FEE_PAID", "INSURANCE_PENDING"].includes(deal.status) && deal.insuranceStatus === "NOT_STARTED") {
    score += 25;
    factors.push({ name: "Insurance Not Started", impact: 25, description: "Insurance not initiated after fee payment" });
  }

  // Factor 2: Contract Shield failure
  const scan = deal.contractScans[0];
  if (scan?.status === "FAIL") {
    score += 30;
    factors.push({ name: "Contract Shield Failed", impact: 30, description: `Score: ${scan.score}/100 — contract has unresolved issues` });
  } else if (scan?.status === "WARNING") {
    score += 15;
    factors.push({ name: "Contract Shield Warning", impact: 15, description: `Score: ${scan.score}/100 — review recommended` });
  }

  // Factor 3: Deal age stall > 7 days
  const ageHours = (Date.now() - deal.createdAt.getTime()) / 3600000;
  if (ageHours > 168 && !["COMPLETED", "CANCELLED"].includes(deal.status)) {
    score += 20;
    factors.push({ name: "Deal Stalled", impact: 20, description: `Deal inactive for ${Math.round(ageHours / 24)} days` });
  }

  // Factor 4: Insurance failed
  if (deal.insuranceStatus === "FAILED") {
    score += 30;
    factors.push({ name: "Insurance Failed", impact: 30, description: "Insurance verification or binding failed" });
  }

  // Factor 5: Prequal expiring within 7 days
  if (deal.buyer.preQualification?.expiresAt) {
    const daysUntilExpiry = (deal.buyer.preQualification.expiresAt.getTime() - Date.now()) / 86400000;
    if (daysUntilExpiry > 0 && daysUntilExpiry < 7) {
      score += 15;
      factors.push({ name: "Prequal Expiring Soon", impact: 15, description: `Pre-qualification expires in ${Math.round(daysUntilExpiry)} days` });
    }
  }

  const tier: RiskTier =
    score >= DEAL_RISK_TIERS.CRITICAL.min ? RiskTier.CRITICAL :
    score >= DEAL_RISK_TIERS.HIGH.min ? RiskTier.HIGH :
    score >= DEAL_RISK_TIERS.MEDIUM.min ? RiskTier.MEDIUM : RiskTier.LOW;

  // Update deal risk in DB
  await prisma.deal.update({ where: { id: dealId }, data: { riskScore: score, riskTier: tier } }).catch(() => {});

  return { score, tier, factors };
}

// Run risk assessment on all active deals — called by workflow-automation cron
export async function updateAllDealRisks(): Promise<number> {
  const activeDeals = await prisma.deal.findMany({
    where: { status: { notIn: ["COMPLETED", "CANCELLED", "REFUNDED"] } },
    select: { id: true },
  });

  let updated = 0;
  for (const { id } of activeDeals) {
    try {
      await computeDealRisk(id);
      updated++;
    } catch { /* continue */ }
  }
  return updated;
}
