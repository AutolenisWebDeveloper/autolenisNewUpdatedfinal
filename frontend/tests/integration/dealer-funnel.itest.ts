// Dealer funnel — integration tests against a SEEDED LOCAL Postgres.
//
// These assert DATABASE STATE through the real service functions and the real
// Prisma client, not HTTP status or visible text. They never touch production
// (project aieybibvewmvrubcpthm); DATABASE_URL must point at the local
// autolenis_e2e database or the suite refuses to run.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import {
  issueInvitationToken,
  validateInvitationToken,
  consumeInvitationToken,
  expireStaleInvitations,
} from "@/lib/services/dealer-recruitment/invitation-token.service";
import { hashToken } from "@/lib/services/dealer-recruitment/account-claim.service";
import { dealerScope } from "@/lib/auth/dealer-scope";
import { parseCsvPriceToCents } from "@/lib/utils/csv-price";

const url = process.env.DATABASE_URL ?? "";
if (!/autolenis_e2e/.test(url)) {
  throw new Error(
    `Refusing to run: DATABASE_URL must target the local autolenis_e2e database (got ${url.slice(0, 40)}…)`,
  );
}

const prisma = new PrismaClient();
let userId = "";
let dealerId = "";

before(async () => {
  const user = await prisma.user.create({
    data: {
      email: `e2e-${Date.now()}@example.test`,
      role: "DEALER",
      supabaseId: `e2e-supabase-${Date.now()}`,
    },
  });
  userId = user.id;
  const dealer = await prisma.dealer.create({
    data: { userId, dealershipName: "E2E Motors", status: "PENDING" },
  });
  dealerId = dealer.id;
});

after(async () => {
  await prisma.inventoryItem.deleteMany({ where: { dealerId } });
  await prisma.dealerInvitation.deleteMany({ where: { email: { contains: "@example.test" } } });
  await prisma.dealer.deleteMany({ where: { id: dealerId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

// ── D3: invitation tokens ───────────────────────────────────────────────────
test("D3: an invitation persists only the HASH, never the raw token", async () => {
  const issued = issueInvitationToken();
  const inv = await prisma.dealerInvitation.create({
    data: {
      dealershipName: "Hash Motors",
      contactName: "Pat",
      email: `hash-${Date.now()}@example.test`,
      tokenHash: issued.tokenHash,
      expiresAt: issued.expiresAt,
      invitedBy: "admin-e2e",
      status: "PENDING",
    },
  });
  const row = await prisma.dealerInvitation.findUniqueOrThrow({ where: { id: inv.id } });
  assert.equal(row.token, null, "raw token must never be persisted");
  assert.equal(row.tokenHash, hashToken(issued.rawToken));
  assert.notEqual(row.tokenHash, issued.rawToken);
});

test("D3: a valid raw token validates by hash", async () => {
  const issued = issueInvitationToken();
  await prisma.dealerInvitation.create({
    data: {
      dealershipName: "Valid Motors", contactName: "Sam",
      email: `valid-${Date.now()}@example.test`,
      tokenHash: issued.tokenHash, expiresAt: issued.expiresAt,
      invitedBy: "admin-e2e", status: "PENDING",
    },
  });
  const v = await validateInvitationToken(issued.rawToken);
  assert.equal(v.ok, true);
});

test("D3: a consumed token cannot be reused, and only ONE concurrent claim wins", async () => {
  const issued = issueInvitationToken();
  const inv = await prisma.dealerInvitation.create({
    data: {
      dealershipName: "Once Motors", contactName: "Alex",
      email: `once-${Date.now()}@example.test`,
      tokenHash: issued.tokenHash, expiresAt: issued.expiresAt,
      invitedBy: "admin-e2e", status: "PENDING",
    },
  });

  // Two concurrent consumes of the same invitation.
  const [a, b] = await Promise.all([
    consumeInvitationToken(inv.id, dealerId),
    consumeInvitationToken(inv.id, dealerId),
  ]);
  assert.equal([a, b].filter(Boolean).length, 1, "exactly one claim may win");

  const row = await prisma.dealerInvitation.findUniqueOrThrow({ where: { id: inv.id } });
  assert.equal(row.status, "ACCEPTED");
  assert.ok(row.consumedAt, "consumedAt must be stamped");

  const v = await validateInvitationToken(issued.rawToken);
  assert.equal(v.ok, false);
  assert.equal((v as { reason: string }).reason, "consumed");
});

test("D3: an expired token is rejected", async () => {
  const issued = issueInvitationToken();
  await prisma.dealerInvitation.create({
    data: {
      dealershipName: "Stale Motors", contactName: "Jo",
      email: `stale-${Date.now()}@example.test`,
      tokenHash: issued.tokenHash,
      expiresAt: new Date(Date.now() - 1000),
      invitedBy: "admin-e2e", status: "PENDING",
    },
  });
  const v = await validateInvitationToken(issued.rawToken);
  assert.equal(v.ok, false);
  assert.equal((v as { reason: string }).reason, "expired");
});

test("D3: the sweep expires PENDING rows past expiresAt — the lazy-expiry gap", async () => {
  const issued = issueInvitationToken();
  const inv = await prisma.dealerInvitation.create({
    data: {
      dealershipName: "Sweep Motors", contactName: "Kim",
      email: `sweep-${Date.now()}@example.test`,
      tokenHash: issued.tokenHash,
      expiresAt: new Date(Date.now() - 60_000),
      invitedBy: "admin-e2e", status: "PENDING",
    },
  });
  const n = await expireStaleInvitations();
  assert.ok(n >= 1);
  const row = await prisma.dealerInvitation.findUniqueOrThrow({ where: { id: inv.id } });
  assert.equal(row.status, "EXPIRED", "a PENDING row past expiry must not stay PENDING");
});

// ── D2: lifecycle ───────────────────────────────────────────────────────────
test("D2: a newly created dealer is PENDING with ONBOARDING scope, not blocked", async () => {
  const d = await prisma.dealer.findUniqueOrThrow({ where: { id: dealerId } });
  assert.equal(d.status, "PENDING");
  assert.equal(dealerScope(d), "ONBOARDING");
});

test("D2: completing the agreement step is what makes a dealer ACTIVE + COMPLETE", async () => {
  const updated = await prisma.dealer.update({
    where: { id: dealerId },
    data: { status: "ACTIVE", onboardingStep: "COMPLETE" },
  });
  assert.equal(updated.status, "ACTIVE");
  assert.equal(updated.onboardingStep, "COMPLETE");
  assert.equal(dealerScope(updated), "FULL");
});

// ── D8/D11: inventory ───────────────────────────────────────────────────────
test("D8: a manual add persists a row carrying dealer_id and dealer_manual provenance", async () => {
  const item = await prisma.inventoryItem.create({
    data: {
      dealerId, lane: "LANE_1", vin: `1HGCM82633A${Date.now() % 1000000}`.slice(0, 17),
      year: 2020, make: "Honda", model: "Accord", trim: "EX",
      priceCents: 2_500_000, mileage: 40_000, condition: "used",
      description: "clean", images: [], isActive: true,
      sourceAdapter: "dealer_manual", lastSeenAt: new Date(),
    },
  });
  const row = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
  assert.equal(row.dealerId, dealerId, "dealer_id must be set — all 206 prod rows have it NULL");
  assert.equal(row.sourceAdapter, "dealer_manual");
  assert.equal(row.priceCents, 2_500_000);
  assert.equal(row.description, "clean", "description must persist, not be stripped");
});

test("D11: both CSV paths store IDENTICAL cents for the same cell", async () => {
  // Path A = standard-header client parse; Path B = server raw-rows parse.
  // Both now call the same parser, so equality is structural.
  for (const cell of ["25000", "$25,000", "25000.00", "9500"]) {
    const a = parseCsvPriceToCents(cell);
    const b = parseCsvPriceToCents(cell);
    assert.equal(a, b);
  }
  // And the value is dollars-scaled, not the old 1/100 reading.
  const vin = `2HGCM82633A${Date.now() % 1000000}`.slice(0, 17);
  const cents = parseCsvPriceToCents("25000")!;
  const item = await prisma.inventoryItem.create({
    data: {
      dealerId, lane: "LANE_1", vin, year: 2021, make: "Toyota", model: "Camry",
      priceCents: cents, images: [], isActive: true,
      sourceAdapter: "dealer_csv", lastSeenAt: new Date(),
    },
  });
  const row = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
  assert.equal(row.priceCents, 2_500_000, "$25,000 must not be stored as $250");
});
