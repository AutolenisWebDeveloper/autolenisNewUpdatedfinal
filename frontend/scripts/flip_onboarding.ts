import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  await p.buyer.update({
    where: { id: "8b4c38db-71ce-4f89-8a0d-f06aeb7de6e1" },
    data: { onboardingComplete: false, termsAcceptedAt: null }
  });
  console.log("flipped");
  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
