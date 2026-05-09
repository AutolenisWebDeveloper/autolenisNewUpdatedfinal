// lib/services/vehicle-request/vehicle-request-due-diligence.service.ts
import { prisma } from "@/lib/prisma";

const DEFAULT_CHECKPOINTS = [
  { name: "Vehicle availability confirmed", description: "Contact dealer/seller to confirm vehicle is still available" },
  { name: "Price verification", description: "Verify asking price matches listing and market data" },
  { name: "Vehicle history check", description: "Review VIN history (Carfax/AutoCheck equivalent)" },
  { name: "Photos reviewed", description: "Review all available photos for condition accuracy" },
];

export async function initializeCheckpoints(requestId: string) {
  return prisma.vehicleRequestDueDiligenceCheckpoint.createMany({
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
