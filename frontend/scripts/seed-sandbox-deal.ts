// scripts/seed-sandbox-deal.ts
// Bootstraps a complete sandbox deal pipeline so the buyer-journey E2E tests can
// exercise auction → offers → deposit → deal → financing → contract shield → esign → pickup
// in a single command:  yarn sandbox:seed-deal
//
// Idempotent: if the sandbox buyer/dealer already exist, only the deal-related rows
// are wiped and recreated (auction, offers, deal, deposit, shortlist, etc.).

import { PrismaClient, BuyerPlan, DealerStatus, UserRole, AuctionStatus, OfferStatus, DealStatus, DepositStatus, FinancingPath, FinancingStatus, PreQualDecision, PreQualTier, InventoryLane } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

const SANDBOX_BUYER_EMAIL = "sandbox-buyer@autolenis-test.com";
const SANDBOX_BUYER_PASSWORD = "SandboxBuyer1!";
const SANDBOX_DEALER_EMAIL = "sandbox-dealer@autolenis-test.com";
const SANDBOX_DEALER_PASSWORD = "SandboxDealer1!";

const prisma = new PrismaClient();
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function ensureSupabaseUser(email: string, password: string): Promise<string> {
  // Try to find existing user
  const list = await supabase.auth.admin.listUsers();
  const existing = list.data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) return existing.id;

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`Supabase create user failed: ${error?.message}`);
  return data.user.id;
}

async function main() {
  console.log("─── seed-sandbox-deal ───");

  // 1. Sandbox Supabase users
  const buyerSupabaseId = await ensureSupabaseUser(SANDBOX_BUYER_EMAIL, SANDBOX_BUYER_PASSWORD);
  const dealerSupabaseId = await ensureSupabaseUser(SANDBOX_DEALER_EMAIL, SANDBOX_DEALER_PASSWORD);
  console.log("Supabase users ensured:", { buyerSupabaseId, dealerSupabaseId });

  // 2. Prisma User + Buyer rows
  const buyerUser = await prisma.user.upsert({
    where: { email: SANDBOX_BUYER_EMAIL },
    create: { email: SANDBOX_BUYER_EMAIL, supabaseId: buyerSupabaseId, role: UserRole.BUYER },
    update: { supabaseId: buyerSupabaseId, role: UserRole.BUYER },
  });
  const buyer = await prisma.buyer.upsert({
    where: { userId: buyerUser.id },
    create: {
      userId: buyerUser.id,
      firstName: "Sandbox",
      lastName: "Buyer",
      phone: "555-555-1010",
      address: "100 Sandbox Ave",
      city: "Austin",
      state: "TX",
      zip: "78701",
      onboardingComplete: true,
      termsAcceptedAt: new Date(),
      termsVersion: process.env.CURRENT_TERMS_VERSION ?? "2026-01-01",
      plan: BuyerPlan.STANDARD,
    },
    update: {
      onboardingComplete: true,
      plan: BuyerPlan.STANDARD,
    },
  });

  // 3. Prisma User + Dealer rows
  const dealerUser = await prisma.user.upsert({
    where: { email: SANDBOX_DEALER_EMAIL },
    create: { email: SANDBOX_DEALER_EMAIL, supabaseId: dealerSupabaseId, role: UserRole.DEALER },
    update: { supabaseId: dealerSupabaseId, role: UserRole.DEALER },
  });
  const dealer = await prisma.dealer.upsert({
    where: { userId: dealerUser.id },
    create: {
      userId: dealerUser.id,
      dealershipName: "Sandbox Test Motors",
      phone: "555-555-2020",
      address: "200 Lot Lane",
      city: "Austin",
      state: "TX",
      zip: "78702",
      status: DealerStatus.ACTIVE,
      tier: "STANDARD",
    },
    update: { status: DealerStatus.ACTIVE },
  });

  // 4. Wipe existing deal-pipeline rows for idempotency
  const existingDeposits = await prisma.deposit.findMany({ where: { buyerId: buyer.id }, select: { id: true } });
  const depositIds = existingDeposits.map((d) => d.id);
  if (depositIds.length) {
    // Delete child rows that FK back to Deal first to avoid P2003
    const dealsToDelete = await prisma.deal.findMany({ where: { buyer: { id: buyer.id } }, select: { id: true } });
    const dealIds = dealsToDelete.map((d) => d.id);
    if (dealIds.length) {
      await prisma.contractScan.deleteMany({ where: { dealId: { in: dealIds } } });
      await prisma.contractVersion.deleteMany({ where: { dealId: { in: dealIds } } });
      await prisma.eSignEnvelope.deleteMany({ where: { dealId: { in: dealIds } } });
      await prisma.pickup.deleteMany({ where: { dealId: { in: dealIds } } });
      await prisma.financing.deleteMany({ where: { dealId: { in: dealIds } } });
      await prisma.messageThread.deleteMany({ where: { dealId: { in: dealIds } } });
    }
    await prisma.deal.deleteMany({ where: { buyer: { id: buyer.id } } });
    await prisma.offer.deleteMany({ where: { auction: { depositId: { in: depositIds } } } });
    await prisma.auction.deleteMany({ where: { depositId: { in: depositIds } } });
    await prisma.deposit.deleteMany({ where: { id: { in: depositIds } } });
  }
  await prisma.shortlist.deleteMany({ where: { buyerId: buyer.id } });
  await prisma.preQualification.deleteMany({ where: { buyerId: buyer.id } });

  // 5. Pre-qualification (APPROVED, max OTD $35,000)
  await prisma.preQualification.create({
    data: {
      buyerId: buyer.id,
      decision: PreQualDecision.APPROVED,
      tier: PreQualTier.STRONG,
      maxOtdAmountCents: 3_500_000,
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      isExternal: false,
    },
  });

  // 6. Six seeded inventory items (so the 5+1 shortlist limit can be exercised) + 2-item Shortlist
  const invSeed = [
    { vin: "SANDBOX-VIN-A0001", year: 2022, make: "Toyota", model: "Camry", trim: "LE", mileage: 28000, priceCents: 2_400_000 },
    { vin: "SANDBOX-VIN-A0002", year: 2021, make: "Honda", model: "Civic", trim: "EX", mileage: 32000, priceCents: 2_100_000 },
    { vin: "SANDBOX-VIN-A0003", year: 2023, make: "Ford", model: "Escape", trim: "SE", mileage: 18000, priceCents: 2_650_000 },
    { vin: "SANDBOX-VIN-A0004", year: 2020, make: "Nissan", model: "Altima", trim: "SV", mileage: 41000, priceCents: 1_950_000 },
    { vin: "SANDBOX-VIN-A0005", year: 2022, make: "Mazda", model: "CX-5", trim: "Touring", mileage: 26000, priceCents: 2_750_000 },
    { vin: "SANDBOX-VIN-A0006", year: 2021, make: "Hyundai", model: "Elantra", trim: "SEL", mileage: 35000, priceCents: 1_850_000 },
  ];
  const inventoryItems = await Promise.all(
    invSeed.map((item) =>
      prisma.inventoryItem.upsert({
        where: { vin: item.vin },
        create: {
          ...item,
          lane: InventoryLane.LANE_1,
          isActive: true,
          images: ["https://upload.wikimedia.org/wikipedia/commons/a/ac/2018_Toyota_Camry_%28ASV70R%29_Ascent_sedan_%282018-08-27%29_01.jpg"],
        },
        update: { isActive: true, priceCents: item.priceCents },
      }),
    ),
  );

  const shortlist = await prisma.shortlist.create({
    data: {
      buyerId: buyer.id,
      // Seed only 2 items into the shortlist so the 5+1 cap test has headroom
      items: {
        create: inventoryItems.slice(0, 2).map((i) => ({ inventoryItemId: i.id, readinessState: "AUCTION_READY" })),
      },
    },
  });

  // 7. Deposit (PAID) and Auction (ACTIVE, ends in 24 h)
  const deposit = await prisma.deposit.create({
    data: {
      buyerId: buyer.id,
      amountCents: 9_900,
      status: DepositStatus.PAID,
      stripePaymentIntentId: `pi_sandbox_seed_${Date.now()}`,
    },
  });

  const auction = await prisma.auction.create({
    data: {
      buyerId: buyer.id,
      depositId: deposit.id,
      status: AuctionStatus.ACTIVE,
      startedAt: new Date(),
      endsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      invitations: {
        create: [{ dealerId: dealer.id, sentAt: new Date(), respondedAt: new Date() }],
      },
    },
  });

  // 8. Three dealer offers with realistic OTD breakdowns + ranks
  const offerSpecs = [
    { otd: 2_650_000, vehicle: 2_400_000, tax: 200_000, fees: 50_000, apr: 0.069, term: 60, rank: 1, score: 0.92 },
    { otd: 2_720_000, vehicle: 2_450_000, tax: 220_000, fees: 50_000, apr: 0.072, term: 60, rank: 2, score: 0.84 },
    { otd: 2_810_000, vehicle: 2_500_000, tax: 250_000, fees: 60_000, apr: 0.079, term: 72, rank: 3, score: 0.71 },
  ];

  const offers = await Promise.all(
    offerSpecs.map((spec) =>
      prisma.offer.create({
        data: {
          auctionId: auction.id,
          dealerId: dealer.id,
          status: OfferStatus.SUBMITTED,
          otdPriceCents: spec.otd,
          vehiclePriceCents: spec.vehicle,
          taxCents: spec.tax,
          feesCents: spec.fees,
          includesFinancing: true,
          aprRate: spec.apr,
          termMonths: spec.term,
          bestPriceScore: spec.score,
          rankCash: spec.rank,
          rankMonthly: spec.rank,
          rankBalanced: spec.rank,
          submittedAt: new Date(),
        },
      }),
    ),
  );

  // 9. Deal in SIGNING_PENDING bound to the top offer
  const winningOffer = offers[0];
  const deal = await prisma.deal.create({
    data: {
      buyerId: buyer.id,
      offerId: winningOffer.id,
      status: DealStatus.SIGNING_PENDING,
      financingPath: FinancingPath.DEALER,
      financing: {
        create: {
          path: FinancingPath.DEALER,
          aprRate: winningOffer.aprRate ?? 0.069,
          termMonths: winningOffer.termMonths ?? 60,
          approvedAmountCents: winningOffer.otdPriceCents,
          monthlyPaymentCents: 52_000,
          status: FinancingStatus.SELECTED,
        },
      },
    },
  });

  // 10. Wipe + reseed dealer-side surfaces (notifications, message thread, document, lead)
  await prisma.notification.deleteMany({ where: { dealerId: dealer.id } });
  await prisma.notification.createMany({
    data: [
      {
        dealerId: dealer.id,
        type: "AUCTION_STARTED",
        channel: "IN_APP",
        title: "New auction invitation",
        body: `You've been invited to bid on auction ${auction.id.slice(0, 8)}. Review the vehicle and submit your offer.`,
      },
      {
        dealerId: dealer.id,
        type: "DEAL_SELECTED",
        channel: "IN_APP",
        title: "Your offer was selected",
        body: `Buyer selected your offer on deal ${deal.id.slice(0, 8)}. Proceed to e-sign.`,
      },
    ],
  });

  // Message thread between buyer and dealer for the deal
  await prisma.messageThread.deleteMany({ where: { dealId: deal.id } });
  await prisma.messageThread.create({
    data: {
      dealId: deal.id,
      lastMessageAt: new Date(),
      participants: {
        create: [
          { userId: buyerUser.id, role: "BUYER" },
          { userId: dealerUser.id, role: "DEALER" },
        ],
      },
      messages: {
        create: [{
          senderId: buyerUser.id,
          content: "Hi! Looking forward to wrapping this up. Let me know when the contract is ready.",
        }],
      },
    },
  });

  // Seed a dealer document so /dealer/documents has at least one row
  await prisma.document.deleteMany({ where: { dealerId: dealer.id } });
  await prisma.document.create({
    data: {
      dealerId: dealer.id,
      name: "Sandbox dealer license.pdf",
      type: "OTHER",
      url: "https://example.com/sandbox-license.pdf",
    },
  });

  console.log("✓ Seed complete");
  console.log({
    buyerId: buyer.id,
    dealerId: dealer.id,
    shortlistId: shortlist.id,
    depositId: deposit.id,
    auctionId: auction.id,
    offerIds: offers.map((o) => o.id),
    dealId: deal.id,
  });

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
