// prisma/seed-test-dealer.ts
// Creates a test dealer account for automated testing

import { PrismaClient, UserRole, DealerStatus } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

const prisma = new PrismaClient();

async function main() {
  const email = "testdealer@autolenis-test.com";
  const password = "TestDealer@2026!";
  const dealershipName = "AutoLenis Test Dealership";

  // Check if already exists
  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) {
    const dealer = await prisma.dealer.findFirst({ where: { userId: existing.id }, include: { user: true } });
    console.log("Test dealer already exists:", { userId: existing.id, dealerId: dealer?.id });
    return;
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role: "DEALER", dealershipName },
  });

  if (error) {
    console.error("Supabase error:", error);
    throw error;
  }

  const user = await prisma.user.create({
    data: {
      supabaseId: data.user!.id,
      email,
      role: UserRole.DEALER,
    },
  });

  const dealer = await prisma.dealer.create({
    data: {
      userId: user.id,
      dealershipName,
      city: "Los Angeles",
      state: "CA",
      zip: "90001",
      phone: "555-555-5555",
      licenseNumber: "CA-TEST-12345",
      status: DealerStatus.ACTIVE,
    },
  });

  console.log("Created test dealer:", { userId: user.id, dealerId: dealer.id, email, password });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
