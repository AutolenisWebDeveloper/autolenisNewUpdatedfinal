// scripts/seed-e2e-gates.ts
// Idempotent, test-scoped fixtures that position deals JUST BEFORE each lifecycle
// gate so the rejection can actually fire in e2e:
//   - CONTRACT_PENDING deal           → esign-without-CONTRACT_APPROVED (409)
//   - SIGNED deal, insurance NOT_STARTED + pickup QR → dealer scan → COMPLETED (409)
//   - buyer w/ active prequal + EMPTY shortlist → deposit/auction (400 SHORTLIST_REQUIRED)
//   - FINANCING_PENDING deal          → admin illegal stage jump (409)
//   - FINANCING_PENDING deal          → buyer financing transition → admin activity (propagation)
// Plus a SUPER_ADMIN row (token minted in the helper).
//
// Mirrors scripts/seed-sandbox-deal.ts: all accounts are *@autolenis-test.com and
// deletes are scoped to those rows only. MUST run against the NON-PROD E2E target
// (the e2e job supplies E2E_* env). Run:  pnpm sandbox:seed-e2e-gates
import {
  PrismaClient, BuyerPlan, DealerStatus, UserRole, AuctionStatus, OfferStatus,
  DealStatus, DepositStatus, InsuranceStatus, PickupStatus, PreQualDecision, PreQualTier, AdminRole,
} from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { GATE } from "../tests/e2e/fixtures/constants";

const prisma = new PrismaClient();
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function ensureSupabaseUser(email: string, password: string): Promise<string> {
  const list = await supabase.auth.admin.listUsers();
  const existing = list.data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) return existing.id;
  const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`Supabase create user failed (${email}): ${error?.message}`);
  return data.user.id;
}

async function ensureBuyer(email: string, password: string) {
  const supabaseId = await ensureSupabaseUser(email, password);
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, supabaseId, role: UserRole.BUYER },
    update: { supabaseId, role: UserRole.BUYER },
  });
  const buyer = await prisma.buyer.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id, firstName: "Gate", lastName: "Buyer", phone: "555-555-0000",
      city: "Austin", state: "TX", zip: "78701", onboardingComplete: true,
      termsAcceptedAt: new Date(), termsVersion: process.env.CURRENT_TERMS_VERSION ?? "2026-01-01",
      plan: BuyerPlan.STANDARD,
    },
    update: { onboardingComplete: true, plan: BuyerPlan.STANDARD },
  });
  return { user, buyer };
}

// Scoped wipe: remove a buyer's deal-pipeline + prequal/shortlist so each run is deterministic.
async function wipeBuyer(buyerId: string) {
  const deals = await prisma.deal.findMany({ where: { buyerId }, select: { id: true } });
  const dealIds = deals.map((d) => d.id);
  if (dealIds.length) {
    await prisma.contractScan.deleteMany({ where: { dealId: { in: dealIds } } });
    await prisma.eSignEnvelope.deleteMany({ where: { dealId: { in: dealIds } } });
    await prisma.pickup.deleteMany({ where: { dealId: { in: dealIds } } });
    await prisma.financing.deleteMany({ where: { dealId: { in: dealIds } } });
    await prisma.messageThread.deleteMany({ where: { dealId: { in: dealIds } } });
    await prisma.dealStatusHistory.deleteMany({ where: { dealId: { in: dealIds } } });
  }
  await prisma.deal.deleteMany({ where: { buyerId } });
  const deposits = await prisma.deposit.findMany({ where: { buyerId }, select: { id: true } });
  const depositIds = deposits.map((d) => d.id);
  if (depositIds.length) {
    await prisma.offer.deleteMany({ where: { auction: { depositId: { in: depositIds } } } });
    await prisma.auction.deleteMany({ where: { depositId: { in: depositIds } } });
    await prisma.deposit.deleteMany({ where: { id: { in: depositIds } } });
  }
  await prisma.shortlist.deleteMany({ where: { buyerId } });
  await prisma.preQualification.deleteMany({ where: { buyerId } });
  await prisma.buyerActivityEvent.deleteMany({ where: { buyerId } });
}

async function activePrequal(buyerId: string) {
  await prisma.preQualification.create({
    data: {
      buyerId, decision: PreQualDecision.APPROVED, tier: PreQualTier.STRONG,
      maxOtdAmountCents: 3_500_000, expiresAt: new Date(Date.now() + 60 * 864e5), isExternal: false,
    },
  });
}

async function main() {
  console.log("─── seed-e2e-gates ───");

  // ── Admin (SUPER_ADMIN, isActive). Token is minted in the Playwright helper. ──
  const adminSupabaseId = await ensureSupabaseUser(GATE.adminEmail, "GateAdmin1!");
  const adminUser = await prisma.user.upsert({
    where: { email: GATE.adminEmail },
    create: { email: GATE.adminEmail, supabaseId: adminSupabaseId, role: UserRole.SUPER_ADMIN },
    update: { supabaseId: adminSupabaseId, role: UserRole.SUPER_ADMIN },
  });
  await prisma.admin.upsert({
    where: { id: GATE.adminId },
    create: { id: GATE.adminId, userId: adminUser.id, role: AdminRole.SUPER_ADMIN, isActive: true, totpEnabled: true },
    update: { userId: adminUser.id, role: AdminRole.SUPER_ADMIN, isActive: true },
  });

  // ── esign gate: CONTRACT_PENDING deal owned by the esign buyer ──
  const esign = await ensureBuyer(GATE.esignBuyerEmail, GATE.esignBuyerPassword);
  await wipeBuyer(esign.buyer.id);
  await activePrequal(esign.buyer.id);
  await prisma.deal.create({
    data: { id: GATE.dealEsignId, buyerId: esign.buyer.id, status: DealStatus.CONTRACT_PENDING },
  });

  // ── shortlist gate: active prequal + EMPTY shortlist + no paid deposit ──
  const shortlist = await ensureBuyer(GATE.shortlistBuyerEmail, GATE.shortlistBuyerPassword);
  await wipeBuyer(shortlist.buyer.id);
  await activePrequal(shortlist.buyer.id);
  // intentionally: no Shortlist row, no Deposit

  // ── illegal jump: FINANCING_PENDING deal for admin action ──
  const jump = await ensureBuyer(GATE.jumpBuyerEmail, GATE.jumpBuyerPassword);
  await wipeBuyer(jump.buyer.id);
  await activePrequal(jump.buyer.id);
  await prisma.deal.create({
    data: { id: GATE.dealJumpId, buyerId: jump.buyer.id, status: DealStatus.FINANCING_PENDING },
  });

  // ── propagation: FINANCING_PENDING deal the buyer advances to FEE_PENDING ──
  const prop = await ensureBuyer(GATE.propBuyerEmail, GATE.propBuyerPassword);
  await wipeBuyer(prop.buyer.id);
  await activePrequal(prop.buyer.id);
  await prisma.deal.create({
    data: { id: GATE.dealPropId, buyerId: prop.buyer.id, status: DealStatus.FINANCING_PENDING },
  });

  // ── insurance gate: dealer + buyer + offer + SIGNED deal (insurance NOT_STARTED) + pickup QR ──
  const dealerSupabaseId = await ensureSupabaseUser(GATE.dealerEmail, GATE.dealerPassword);
  const dealerUser = await prisma.user.upsert({
    where: { email: GATE.dealerEmail },
    create: { email: GATE.dealerEmail, supabaseId: dealerSupabaseId, role: UserRole.DEALER },
    update: { supabaseId: dealerSupabaseId, role: UserRole.DEALER },
  });
  const dealer = await prisma.dealer.upsert({
    where: { userId: dealerUser.id },
    create: {
      userId: dealerUser.id, dealershipName: "Gate Test Motors", phone: "555-555-3030",
      city: "Austin", state: "TX", zip: "78702", status: DealerStatus.ACTIVE, tier: "STANDARD",
    },
    update: { status: DealerStatus.ACTIVE },
  });
  const ins = await ensureBuyer(GATE.insuranceBuyerEmail, "GateBuyer1!");
  await wipeBuyer(ins.buyer.id);
  await activePrequal(ins.buyer.id);
  const insDeposit = await prisma.deposit.create({
    data: { buyerId: ins.buyer.id, amountCents: 9_900, status: DepositStatus.PAID, stripePaymentIntentId: `pi_gate_${Date.now()}` },
  });
  const insAuction = await prisma.auction.create({
    data: { buyerId: ins.buyer.id, depositId: insDeposit.id, status: AuctionStatus.CLOSED, startedAt: new Date(), endsAt: new Date() },
  });
  const insOffer = await prisma.offer.create({
    data: {
      auctionId: insAuction.id, dealerId: dealer.id, status: OfferStatus.ACCEPTED,
      otdPriceCents: 2_650_000, vehiclePriceCents: 2_400_000, taxCents: 200_000, feesCents: 50_000,
      submittedAt: new Date(),
    },
  });
  await prisma.deal.create({
    data: {
      id: GATE.dealInsuranceId, buyerId: ins.buyer.id, offerId: insOffer.id,
      status: DealStatus.SIGNED, insuranceStatus: InsuranceStatus.NOT_STARTED,
      pickup: {
        create: {
          status: PickupStatus.SCHEDULED, scheduledAt: new Date(Date.now() + 864e5),
          qrCodeData: GATE.insuranceQrToken, qrExpiresAt: new Date(Date.now() + 2 * 864e5),
        },
      },
    },
  });

  console.log("✓ e2e gate fixtures seeded", {
    admin: GATE.adminId, dealEsign: GATE.dealEsignId, dealJump: GATE.dealJumpId,
    dealInsurance: GATE.dealInsuranceId, dealProp: GATE.dealPropId,
  });
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
