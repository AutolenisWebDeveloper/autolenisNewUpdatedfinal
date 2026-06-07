// AMIPS Phase 0 — seed runner.
//
// Runs the launch seed sequence:
//   1. seedVehicleIntelligence() — top 20 vehicles
//   2. seedContentQueue()        — priority-ordered backlog (Tiers A/B/C)
// then reports the resulting counts.
//
// Requires DATABASE_URL in the environment (.env is auto-loaded by Prisma when
// the client is constructed).
//
// Usage (from frontend/):
//   pnpm amips:seed

import { prisma } from "@/lib/prisma";
import { seedVehicleIntelligence } from "@/lib/amips/seed/vehicle-intelligence.seed";
import { seedContentQueue } from "@/lib/amips/seed/content-queue.seed";

async function main(): Promise<void> {
  console.log("[amips-seed] starting AMIPS Phase 0 seed sequence");

  const vehicles = await seedVehicleIntelligence();
  const queue = await seedContentQueue();

  // Final counts from the database.
  const vehicleCount = await prisma.vehicleIntelligence.count();
  const queueCount = await prisma.contentQueue.count();

  console.log("");
  console.log("[amips-seed] ===== SUMMARY =====");
  console.log(`[amips-seed] vehicle_intelligence rows: ${vehicleCount} (upserted this run: ${vehicles.upserted})`);
  console.log(`[amips-seed] content_queue rows: ${queueCount} (inserted this run: ${queue.inserted}, skipped: ${queue.skipped})`);
  console.log(`[amips-seed] queue by tier this run — A:${queue.byTier.A ?? 0} B:${queue.byTier.B ?? 0} C:${queue.byTier.C ?? 0}`);
  console.log("[amips-seed] done");
}

main()
  .catch((err) => {
    console.error("[amips-seed] FAILED", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
