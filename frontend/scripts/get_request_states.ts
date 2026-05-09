import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const reqs = await p.vehicleRequest.findMany({
    where: { buyer: { user: { email: 'testbuyer_iteration8@autolenis-test.com' }}},
    select: { id: true, status: true, makePreference: true, modelPreference: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 10
  });
  console.log(JSON.stringify(reqs, null, 2));
  await p.$disconnect();
})();
