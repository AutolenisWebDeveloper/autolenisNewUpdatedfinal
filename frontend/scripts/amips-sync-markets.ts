// AMIPS Phase 1 — market intelligence sync runner.
//
// Populates market_intelligence for the top 25 metros (Census population +
// dealer-derived scores). Requires DATABASE_URL in the environment.
//
// Usage (from frontend/):
//   pnpm amips:sync-markets

import { prisma } from "@/lib/prisma";
import { syncMarketIntelligence } from "@/lib/amips/pipelines/market-intelligence.pipeline";

async function main(): Promise<void> {
  console.log("[amips-sync-markets] starting");
  const result = await syncMarketIntelligence();
  const top = await prisma.marketIntelligence.findMany({
    orderBy: { buyerLeverageScore: "desc" },
    take: 5,
    select: { metroName: true, buyerLeverageScore: true },
  });
  console.log("");
  console.log("[amips-sync-markets] ===== SUMMARY =====");
  console.log(`[amips-sync-markets] metros ${result.metros}, scored ${result.scored}`);
  console.log("[amips-sync-markets] top 5 by buyer leverage:");
  for (const m of top) {
    console.log(`[amips-sync-markets]   ${m.metroName}: ${m.buyerLeverageScore}`);
  }
  console.log("[amips-sync-markets] done");
}

main()
  .catch((err) => {
    console.error("[amips-sync-markets] FAILED", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
