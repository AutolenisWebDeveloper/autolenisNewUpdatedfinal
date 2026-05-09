import { prisma } from "../lib/prisma";

async function main() {
  let req = await prisma.vehicleRequest.findFirst({
    where: { status: "SUBMITTED" },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  if (!req) {
    const cancelled = await prisma.vehicleRequest.findFirst({
      where: { status: "CANCELLED" },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    if (cancelled) {
      await prisma.vehicleRequest.update({ where: { id: cancelled.id }, data: { status: "SUBMITTED" } });
      req = { id: cancelled.id };
    }
  }
  if (!req) { console.log("NONE"); process.exit(1); }
  console.log(req.id);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => process.exit(0));
