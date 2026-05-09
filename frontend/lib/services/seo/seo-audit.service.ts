// lib/services/seo/seo-audit.service.ts
import { prisma } from "@/lib/prisma";
import { computeHealthScore } from "./seo.service";

export async function auditAllPages(): Promise<{ audited: number; avgScore: number }> {
  const configs = await prisma.seoPageConfig.findMany();
  let totalScore = 0;
  for (const config of configs) {
    const score = await computeHealthScore(config.pageSlug);
    totalScore += score;
    await prisma.seoHealthScore.create({ data: { pageSlug: config.pageSlug, score, issues: [], status: score >= 80 ? "EXCELLENT" : score >= 60 ? "GOOD" : score >= 40 ? "NEEDS_WORK" : "CRITICAL" } });
  }
  return { audited: configs.length, avgScore: configs.length > 0 ? Math.round(totalScore / configs.length) : 0 };
}
