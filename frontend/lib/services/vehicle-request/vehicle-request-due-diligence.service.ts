// lib/services/vehicle-request/vehicle-request-due-diligence.service.ts
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

const DEFAULT_CHECKPOINTS = [
  { name: "Vehicle availability confirmed", description: "Contact dealer/seller to confirm vehicle is still available" },
  { name: "Price verification", description: "Verify asking price matches listing and market data" },
  { name: "Vehicle history check", description: "Review VIN history (Carfax/AutoCheck equivalent)" },
  { name: "Photos reviewed", description: "Review all available photos for condition accuracy" },
];

/**
 * Seed the due-diligence checkpoints for a request.
 *
 * EXTENDED IN PHASE 3, not duplicated. §5d's settlement side effect ends with "open the
 * sourcing case" and PAY-33/S6-29a require the checkpoints seeded with it, atomically —
 * so this needs to run inside the settlement transaction, which means taking the
 * transaction client rather than reaching for the global one.
 *
 * IDEMPOTENT. `skipDuplicates` is not enough on its own here (there is no unique
 * constraint on (request_id, name) to skip against), so the guard is the count check:
 * a request that already has checkpoints is left exactly as it is, including any an
 * operator has already ticked off. Stripe redelivers, and the settlement transaction
 * can legitimately run twice; seeding twice would give an operator eight checkpoints
 * and no way to tell which four were real.
 */
export async function initializeCheckpoints(
  requestId: string,
  db: typeof prisma | Prisma.TransactionClient = prisma,
) {
  const existing = await db.vehicleRequestDueDiligenceCheckpoint.count({ where: { requestId } });
  if (existing > 0) return { count: 0 };

  return db.vehicleRequestDueDiligenceCheckpoint.createMany({
    data: DEFAULT_CHECKPOINTS.map((cp, i) => ({ requestId, name: cp.name, description: cp.description, order: i })),
  });
}

export async function completeCheckpoint(checkpointId: string, adminId: string) {
  return prisma.vehicleRequestDueDiligenceCheckpoint.update({
    where: { id: checkpointId },
    data: { completed: true, completedAt: new Date(), completedBy: adminId },
  });
}

export async function allCheckpointsComplete(requestId: string): Promise<boolean> {
  const checkpoints = await prisma.vehicleRequestDueDiligenceCheckpoint.findMany({ where: { requestId } });
  return checkpoints.length > 0 && checkpoints.every(c => c.completed);
}
