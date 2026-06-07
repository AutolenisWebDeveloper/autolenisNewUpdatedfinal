// AMIPS Phase 1 — dealer intelligence sync runner.
//
// Populates dealer_intelligence from the DealerProspect cache and recomputes
// same-brand density. Requires DATABASE_URL in the environment.
//
// Usage (from frontend/):
//   pnpm amips:sync-dealers

import { prisma } from "@/lib/prisma";
import { syncDealerIntelligence } from "@/lib/amips/pipelines/dealer-intelligence.pipeline";

async function main(): Promise<void> {
  console.log("[amips-sync-dealers] starting");
  const result = await syncDealerIntelligence();
  const total = await prisma.dealerIntelligence.count();
  console.log("");
  console.log("[amips-sync-dealers] ===== SUMMARY =====");
  console.log(
    `[amips-sync-dealers] synced ${result.synced}, skipped ${result.skipped}, errors ${result.errors}`,
  );
  console.log(`[amips-sync-dealers] dealer_intelligence rows: ${total}`);
  console.log("[amips-sync-dealers] done");
}

main()
  .catch((err) => {
    console.error("[amips-sync-dealers] FAILED", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
