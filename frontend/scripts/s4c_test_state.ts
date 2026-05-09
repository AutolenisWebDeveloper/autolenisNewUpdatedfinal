// Reads VehicleRequests for testbuyer_iteration8 and reports state
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
async function main() {
  const buyer = await db.buyer.findFirst({ where: { user: { email: 'testbuyer_iteration8@autolenis-test.com' } }, include: { user: true } });
  console.log('BUYER', buyer?.id, buyer?.userId);
  if (!buyer) return;
  const reqs = await db.vehicleRequest.findMany({
    where: { buyerId: buyer.id },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { id: true, status: true, createdAt: true, makePreference: true, modelPreference: true, notes: true },
  });
  for (const r of reqs) {
    console.log(JSON.stringify({ id: r.id, status: r.status, createdAt: r.createdAt, make: r.makePreference, model: r.modelPreference, hasNotes: !!r.notes }));
  }
}
main().finally(() => db.$disconnect());
