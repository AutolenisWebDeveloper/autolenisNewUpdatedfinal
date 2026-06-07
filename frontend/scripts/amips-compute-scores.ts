// AMIPS Phase 1 — market score batch runner.
//
// Pre-computes the AutoLenis Market Score for every qualifying make/model x
// metro combination into amips_market_scores. Requires DATABASE_URL.
//
// Usage (from frontend/):
//   pnpm amips:compute-scores

import { prisma } from "@/lib/prisma";
import { computeMarketScoreBatch } from "@/lib/amips/pipelines/market-score-batch.pipeline";

async function main(): Promise<void> {
  console.log("[amips-compute-scores] starting");
  const result = await computeMarketScoreBatch();
  const total = await prisma.amipsMarketScore.count();
  console.log("");
  console.log("[amips-compute-scores] ===== SUMMARY =====");
  console.log(
    `[amips-compute-scores] combinations ${result.combinations}, computed ${result.computed}, skipped ${result.skipped}`,
  );
  console.log(`[amips-compute-scores] amips_market_scores rows: ${total}`);
  console.log("[amips-compute-scores] done");
}

main()
  .catch((err) => {
    console.error("[amips-compute-scores] FAILED", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
