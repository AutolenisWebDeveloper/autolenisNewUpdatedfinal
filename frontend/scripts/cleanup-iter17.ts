import { prisma } from "../lib/prisma";
async function main() {
  const buyer = await prisma.buyer.findFirst({ where: { user: { email: "sandbox-buyer@autolenis-test.com" } } });
  if (buyer) {
    const deals = await prisma.deal.findMany({ where: { buyerId: buyer.id }, select: { id: true } });
    const dealIds = deals.map(d => d.id);
    if (dealIds.length) {
      const cv = await prisma.contractVersion.deleteMany({ where: { dealId: { in: dealIds } } });
      console.log("deleted contract versions:", cv.count);
    }
  }
  // also reset dealer password via supabase admin
  const { createClient } = await import("@supabase/supabase-js");
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const dealer = await prisma.user.findUnique({ where: { email: "sandbox-dealer@autolenis-test.com" } });
  if (dealer) {
    await supa.auth.admin.updateUserById(dealer.supabaseId!, { password: "SandboxDealer1!" });
    console.log("reset dealer password");
  }
}
main().then(() => process.exit(0));
