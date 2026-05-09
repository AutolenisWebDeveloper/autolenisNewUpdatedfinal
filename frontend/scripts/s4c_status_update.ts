// Mutates VehicleRequest status for E2E label testing.
// Usage: npx tsx scripts/s4c_status_update.ts <requestId> <STATUS>
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
async function main() {
  const id = process.argv[2];
  const status = process.argv[3] as any;
  if (!id || !status) { console.error("Usage: <id> <STATUS>"); process.exit(1); }
  const before = await db.vehicleRequest.findUnique({ where: { id }, select: { status: true } });
  const updated = await db.vehicleRequest.update({ where: { id }, data: { status } });
  console.log("BEFORE:", before?.status, "AFTER:", updated.status);
}
main().finally(() => db.$disconnect());
