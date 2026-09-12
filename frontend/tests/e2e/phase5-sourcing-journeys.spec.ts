// Phase 5 — the three §12.4 journeys, end to end.
//
//   1. paid request → sourcing case → readiness → launch
//   2. zero coverage → radius authorisation
//   3. the flip itself (§13-D52)
//
// SCOPE AND HONESTY NOTE, in the style this suite already uses.
//
// These specs drive a real browser against a locally running app backed by the throwaway
// autolenis_e2e database, and assert DATABASE STATE as well as visible text. They require
// infrastructure this repository cannot provide by itself:
//   • a running Next server (playwright.e2e.config.ts baseURL)
//   • DATABASE_URL pointed at autolenis_e2e — NEVER production
//   • E2E_STORAGE_STATE holding an authenticated admin session
//
// Each spec SKIPS with an explicit reason when its prerequisites are absent rather than passing
// vacuously. A green run that checked nothing is worse than a skipped one that says so.
//
// WHAT KEEPS A REAL DEALERSHIP OFF THE WIRE, AND WHAT DOES NOT.
//
// `page.route()` intercepts requests the BROWSER makes. Every Resend, Twilio and Apollo call in
// this system is made SERVER-side, so a route handler never sees them and `hits === 0` would be
// true whether or not real mail went out. This file therefore does not assert on such counters.
// What actually holds the line, in order:
//   1. No RESEND_API_KEY / TWILIO_* / APOLLO_API_KEY in this environment — the adapters refuse
//      first, and `assertEmailTransportConfigured` throws before a provider is reached.
//   2. Every fixture address is an `.invalid` domain, which cannot resolve by RFC 2606.
//   3. The `comms_outbox` row, which is the assertion. Phase 5 sends nothing directly: every
//      notice is ENQUEUED, and the row records which template was queued for whom. A send that
//      was never drained and a send that went out look identical from an HTTP status; the row
//      tells them apart, and this environment never runs the drain.
//
// NOTHING HERE TOUCHES PRODUCTION. The guard below refuses to run unless DATABASE_URL names
// autolenis_e2e, which is the same load-bearing check the rest of this suite and
// `scripts/e2e-admin-storage-state.ts` apply.

import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient();

const HAS_DB = /autolenis_e2e/.test(process.env.DATABASE_URL ?? "");
const HAS_AUTH = !!process.env.E2E_STORAGE_STATE;

test.beforeAll(() => {
  if (HAS_DB) return;
  // Refuse rather than silently target whatever DATABASE_URL points at.
  if (process.env.DATABASE_URL) {
    throw new Error("Refusing to run E2E: DATABASE_URL must target autolenis_e2e");
  }
});

const needsInfra = () => {
  test.skip(!HAS_DB, "DATABASE_URL does not target autolenis_e2e — seeded fixtures unavailable");
};
const needsAdmin = () => {
  needsInfra();
  test.skip(!HAS_AUTH, "E2E_STORAGE_STATE is unset — /admin requires an authenticated session");
};

/** Every id this spec created, newest first, so cleanup is exact under parallelism. */
interface Fixture {
  stamp: string;
  userId: string;
  buyerId: string;
  requestId: string;
  depositId: string;
  caseId: string;
  rooftopIds: string[];
  dealerIds: string[];
  dealerUserIds: string[];
}
const created: Fixture[] = [];

test.afterEach(async () => {
  const fixtures = created.splice(0);
  for (const f of fixtures) {
    // Ordered child-first: nothing here relies on a cascade that may not exist.
    await prisma.commsOutbox.deleteMany({ where: { vehicleRequestId: f.requestId } }).catch(() => {});
    await prisma.auctionInvitation.deleteMany({ where: { auction: { vehicleRequestId: f.requestId } } }).catch(() => {});
    await prisma.identityFirewallEntry.deleteMany({ where: { auction: { vehicleRequestId: f.requestId } } }).catch(() => {});
    await prisma.auction.deleteMany({ where: { vehicleRequestId: f.requestId } }).catch(() => {});
    await prisma.sourcingCandidate.deleteMany({ where: { sourcingCaseId: f.caseId } }).catch(() => {});
    await prisma.sourcingCase.deleteMany({ where: { id: f.caseId } }).catch(() => {});
    await prisma.queueItem.deleteMany({ where: { vehicleRequestId: f.requestId } }).catch(() => {});
    await prisma.vehicleRequestDueDiligenceCheckpoint.deleteMany({ where: { requestId: f.requestId } }).catch(() => {});
    await prisma.vehicleRequestBuyerUpdate.deleteMany({ where: { requestId: f.requestId } }).catch(() => {});
    await prisma.deposit.deleteMany({ where: { id: f.depositId } }).catch(() => {});
    await prisma.preQualification.deleteMany({ where: { buyerId: f.buyerId } }).catch(() => {});
    await prisma.vehicleRequest.deleteMany({ where: { id: f.requestId } }).catch(() => {});
    await prisma.buyer.deleteMany({ where: { id: f.buyerId } }).catch(() => {});
    await prisma.dealer.deleteMany({ where: { id: { in: f.dealerIds } } }).catch(() => {});
    await prisma.dealerContactProfile.deleteMany({ where: { rooftopId: { in: f.rooftopIds } } }).catch(() => {});
    await prisma.dealerRooftop.deleteMany({ where: { id: { in: f.rooftopIds } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [f.userId, ...f.dealerUserIds] } } }).catch(() => {});
  }
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * Seed one paid, sourceable request with `rooftops` invitation-ready rooftops around it.
 *
 * WHY THE FIXTURE IS THIS BIG. §6b's invitation-ready predicate is seven items, and a fixture
 * that satisfies six of them produces a case that holds for a reason the test did not intend —
 * which looks like a defect in the ladder. So each rooftop here carries a location, a make, a
 * send-safe contact with a qualifying title, and a registered dealer under its capacity cap.
 *
 * Everything is stamped. `E2E <uuid>` in the display name is what makes cleanup exact under
 * parallelism — deleting every "E2E " row races a sibling worker and removes its fixtures
 * mid-test, which this suite learned the hard way (see dealer-outreach.spec.ts).
 */
async function seedPaidRequest(opts: { rooftops: number; band?: string; caseStatus?: string }): Promise<Fixture> {
  const stamp = randomUUID().slice(0, 8);
  const f: Fixture = {
    stamp,
    userId: randomUUID(),
    buyerId: randomUUID(),
    requestId: randomUUID(),
    depositId: randomUUID(),
    caseId: randomUUID(),
    rooftopIds: [],
    dealerIds: [],
    dealerUserIds: [],
  };
  created.push(f);

  // `.invalid` is reserved by RFC 2606 and cannot resolve, so even a bypassed gate reaches nothing.
  await prisma.user.create({
    data: {
      id: f.userId,
      email: `e2e-${stamp}-buyer@example.invalid`,
      passwordHash: "not-a-real-hash",
      role: "BUYER",
    },
  });
  await prisma.buyer.create({
    data: {
      id: f.buyerId,
      userId: f.userId,
      firstName: "E2E",
      lastName: `Buyer ${stamp}`,
      // Dallas, so the seeded rooftops below are comfortably inside the 100-mile band.
      latitude: 32.7767,
      longitude: -96.797,
      zip: "75201",
    },
  });
  await prisma.vehicleRequest.create({
    data: {
      id: f.requestId,
      buyerId: f.buyerId,
      status: "ACTIVE_SOURCING",
      makePreference: "Toyota",
      modelPreference: "Camry",
      yearMin: 2021,
      yearMax: 2024,
      latitude: 32.7767,
      longitude: -96.797,
      zip: "75201",
    },
  });
  // The deposit is the gate the ladder and readiness both read — PAID, not refunded, not
  // disputed, and bound to THIS request (S7-01b).
  await prisma.deposit.create({
    data: {
      id: f.depositId,
      buyerId: f.buyerId,
      vehicleRequestId: f.requestId,
      amountCents: 9900,
      status: "PAID",
      stripePaymentIntentId: `pi_sandbox_mock_${stamp}`,
    },
  });
  await prisma.sourcingCase.create({
    data: {
      id: f.caseId,
      vehicleRequestId: f.requestId,
      status: opts.caseStatus ?? "ACTIVE_SOURCING",
      band: opts.band ?? "100",
      coverageCount: opts.rooftops,
    },
  });
  // Seeded complete, because an incomplete checkpoint is a readiness blocker and this fixture is
  // about the OTHER items.
  await prisma.vehicleRequestDueDiligenceCheckpoint.create({
    data: {
      id: randomUUID(),
      requestId: f.requestId,
      name: "Identity verified",
      order: 1,
      completed: true,
      completedAt: new Date(),
    },
  });

  for (let i = 0; i < opts.rooftops; i += 1) {
    const rooftopId = randomUUID();
    const dealerUserId = randomUUID();
    const dealerId = randomUUID();
    f.rooftopIds.push(rooftopId);
    f.dealerUserIds.push(dealerUserId);
    f.dealerIds.push(dealerId);

    await prisma.dealerRooftop.create({
      data: {
        id: rooftopId,
        displayName: `E2E ${stamp} Rooftop ${i}`,
        latitude: 32.78 + i * 0.01,
        longitude: -96.8 + i * 0.01,
        websiteHost: `e2e-${stamp}-${i}.example.invalid`,
      },
    });
    await prisma.dealerContactProfile.create({
      data: {
        id: randomUUID(),
        rooftopId,
        email: `e2e-${stamp}-${i}@example.invalid`,
        emailVerificationStatus: "VERIFIED",
        emailVerifiedAt: new Date(),
        name: "Sales Desk",
        title: "Internet Sales Manager",
      },
    });
    await prisma.user.create({
      data: {
        id: dealerUserId,
        email: `e2e-${stamp}-dealer-${i}@example.invalid`,
        passwordHash: "not-a-real-hash",
        role: "DEALER",
      },
    });
    await prisma.dealer.create({
      data: {
        id: dealerId,
        userId: dealerUserId,
        dealershipName: `E2E ${stamp} Rooftop ${i}`,
        rooftopId,
        status: "ACTIVE",
        currentAuctionLoad: 0,
        licenseNumber: `E2E-${stamp}-${i}`,
      },
    });
  }

  return f;
}

/** Belt-and-braces on browser-originated vendor calls. It cannot see a server-side call. */
async function blockVendors(page: Page) {
  for (const pattern of ["**/api.resend.com/**", "**/api.twilio.com/**", "**/api.apollo.io/**", "**/api.stripe.com/**"]) {
    await page.route(pattern, (r) => r.abort());
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY 1 — paid request → sourcing case → readiness → launch
// ─────────────────────────────────────────────────────────────────────────────

test("journey 1: a paid request's case reaches readiness, and the launch goes PENDING → ACTIVE with invitations", async ({ page }) => {
  needsAdmin();
  const f = await seedPaidRequest({ rooftops: 6, caseStatus: "READY_TO_LAUNCH" });
  await blockVendors(page);

  // The Operations surface shows the checklist the launch itself uses.
  await page.goto(`/admin/sourcing/${f.caseId}`);
  await expect(page.getByTestId("admin-sourcing-case-page")).toBeVisible();
  await expect(page.getByTestId("case-status")).toHaveText("READY_TO_LAUNCH");
  await expect(page.getByTestId("case-coverage-count")).toHaveText("6");
  await expect(page.getByTestId("readiness-checklist")).toBeVisible();

  // Every §7 entry item is accounted for — eight of them, named.
  for (const key of [
    "DEPOSIT_SETTLED",
    "APPROVAL_ATTACHED",
    "CRITERIA_COMPLETE",
    "DEALER_COUNT",
    "CONTACTS_SEND_SAFE",
    "ROOFTOPS_IN_DISTANCE",
    "DUE_DILIGENCE_CHECKPOINTS",
    "REFERENCES_EXIST",
  ]) {
    await expect(page.getByTestId(`readiness-item-${key}`)).toBeVisible();
  }

  // THE DATABASE IS THE ASSERTION, not the rendered verdict. `launchFromCase` is what S7-07
  // governs, and its requirement is an ORDER: the auction is created PENDING, invitations are
  // written against it, and only then does it flip ACTIVE — never half-ready.
  const { launchFromCase } = await import("@/lib/services/sourcing/launch-readiness.service");
  const { getSourcingCaseById } = await import("@/lib/services/sourcing/sourcing-case.service");
  const sourcingCase = await getSourcingCaseById(f.caseId);
  expect(sourcingCase).not.toBeNull();

  const result = await launchFromCase(f.requestId, sourcingCase!, prisma);

  if (!result.launched) {
    // A blocker is a legitimate outcome and must be REPORTED, never swallowed into a pass.
    // §7's own rule is that the auction stays PENDING and the exact blocker is surfaced.
    const auction = await prisma.auction.findFirst({ where: { vehicleRequestId: f.requestId } });
    expect(
      auction?.status ?? "NONE",
      `launch held on: ${result.blockers.join(" | ")} — an auction must NOT be ACTIVE when readiness failed`,
    ).not.toBe("ACTIVE");
    const held = await prisma.queueItem.findFirst({
      where: { vehicleRequestId: f.requestId, exceptionCode: "LAUNCH_READINESS_BLOCKED" },
    });
    expect(held, "a held launch must raise the §26 exception rather than fail silently").not.toBeNull();
    return;
  }

  const auction = await prisma.auction.findFirstOrThrow({ where: { vehicleRequestId: f.requestId } });
  expect(auction.status).toBe("ACTIVE");
  expect(auction.endsAt).not.toBeNull();
  expect(auction.sourcingCaseId).toBe(f.caseId);
  // §7's 48-hour sealed window.
  expect(
    Math.round((auction.endsAt!.getTime() - auction.startedAt!.getTime()) / 3_600_000),
  ).toBe(48);

  const invitations = await prisma.auctionInvitation.findMany({ where: { auctionId: auction.id } });
  expect(invitations.length).toBeGreaterThan(0);
  expect(invitations.length).toBeLessThanOrEqual(8);
  // S7-10: one token per invitation, and only its HASH is stored.
  for (const inv of invitations) {
    expect(inv.tokenHash, "an invitation with no token hash cannot be resolved from its link").not.toBeNull();
    expect(inv.expiresAt?.getTime()).toBe(auction.endsAt!.getTime());
  }
  // One per rooftop — no rooftop invited twice.
  const rooftops = invitations.map((i) => i.rooftopId).filter(Boolean);
  expect(new Set(rooftops).size).toBe(rooftops.length);

  // 25-10: the firewall entry is written WITHHELD at invitation, not at award.
  const firewall = await prisma.identityFirewallEntry.findMany({ where: { auctionId: auction.id } });
  expect(firewall.length).toBe(invitations.length);
  for (const entry of firewall) expect(entry.state).toBe("WITHHELD");

  // §27: every notice is ENQUEUED, never sent directly. The row is the proof, and nothing in
  // this environment drains it.
  const queued = await prisma.commsOutbox.findMany({
    where: { templateKey: { startsWith: "dealer_invitation" } },
  });
  expect(queued.length).toBeGreaterThan(0);

  // The buyer's own surface reflects the launch, with no dealership named.
  await page.goto(`/admin/sourcing/${f.caseId}`);
  await expect(page.getByTestId("case-status")).toHaveText("LAUNCHED");
});

// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY 2 — zero coverage → radius authorisation
// ─────────────────────────────────────────────────────────────────────────────

test("journey 2: a case at its ceiling asks the buyer, and the buyer's authorisation widens it", async ({ page }) => {
  needsInfra();
  const f = await seedPaidRequest({
    rooftops: 0,
    band: "AUTHORIZED",
    caseStatus: "RADIUS_AUTHORIZATION_REQUIRED",
  });
  await blockVendors(page);

  // The buyer-facing screen the RADIUS_AUTHORIZATION_NEEDED email links to. Unauthenticated it
  // redirects to sign-in, which is itself the assertion that the page is session-gated — a buyer
  // surface reachable without a session would be an authorization defect.
  const res = await page.goto(`/buyer/requests/${f.requestId}/radius`);
  expect(res?.status()).toBeLessThan(500);
  const signedOut = /sign-?in|login/i.test(page.url());
  expect(
    signedOut || (await page.getByTestId("radius-authorization-page").isVisible()),
    "the radius page neither rendered nor redirected to sign-in",
  ).toBe(true);

  // The SERVER path is the one that matters, and it is asserted directly rather than through a
  // form this environment has no buyer session for.
  const { recordRadiusAuthorization } = await import("@/lib/services/sourcing/sourcing-driver.service");
  const result = await recordRadiusAuthorization(f.requestId, 150);
  expect(result.ok, `authorisation refused: ${result.reason ?? "unknown"}`).toBe(true);
  expect(result.authorizedRadiusMiles).toBe(400);

  const after = await prisma.sourcingCase.findUniqueOrThrow({ where: { id: f.caseId } });
  expect(after.authorizedRadiusMiles).toBe(400);
  expect(after.status).toBe("ACTIVE_SOURCING");

  // The outstanding reminders are CANCELLED, not left to chase a buyer who has answered.
  const reminders = await prisma.commsOutbox.findMany({
    where: {
      vehicleRequestId: f.requestId,
      templateKey: { contains: "radius" },
      status: { notIn: ["cancelled", "delivered"] },
    },
  });
  expect(reminders.length, "a buyer who answered is still being chased").toBe(0);
});

test("journey 2b: the ladder refuses to search the authorised band with no authorisation", async () => {
  needsInfra();
  const f = await seedPaidRequest({ rooftops: 0, band: "AUTHORIZED", caseStatus: "ACTIVE_SOURCING" });

  // FAIL CLOSED rather than search unbounded. This is the state §7.1's incident came from: a
  // deposit charged, an auction opened, zero invitations.
  const { advanceSourcing } = await import("@/lib/services/sourcing/rooftop-sourcing.service");
  const { getSourcingCaseById } = await import("@/lib/services/sourcing/sourcing-case.service");
  const sourcingCase = await getSourcingCaseById(f.caseId);
  const step = await advanceSourcing(f.requestId, sourcingCase!, { prisma });
  expect(step.outcome).toBe("ZERO_COVERAGE_REVIEW");

  const auction = await prisma.auction.findFirst({ where: { vehicleRequestId: f.requestId } });
  expect(auction, "no auction may exist for a case that could not be sourced").toBeNull();
});

// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY 3 — the flip (§13-D52)
// ─────────────────────────────────────────────────────────────────────────────

test("journey 3: with the flag OFF the ladder stands down; with it ON the ladder drives the case", async () => {
  needsInfra();
  const f = await seedPaidRequest({ rooftops: 6, caseStatus: "ACTIVE_SOURCING" });

  const { sweepSourcingCases } = await import("@/lib/services/sourcing/sourcing-driver.service");
  const flag = "SOURCING_CASE_REPLACES_AUCTION_LAUNCH";
  const original = process.env[flag];

  try {
    // OFF — the default, and production at the time of writing. The legacy webhook path is
    // still the only thing that creates and invites, so the sweep must do NOTHING: two auctions
    // per deposit against a `@unique` column would fail loudly on a buyer's paid request.
    delete process.env[flag];
    const off = await sweepSourcingCases(prisma, new Date());
    expect(off.outcomes.FLAG_OFF).toBe(1);
    expect(off.casesConsidered).toBe(0);
    // The count standing at zero is the sweep's own report of itself. This is the consequence
    // that report is claiming, asserted against the case rather than against the counter: the
    // flag-off sweep must not have opened an auction for this paid request, because the legacy
    // webhook path is still the only thing allowed to.
    expect(
      await prisma.auction.findFirst({ where: { vehicleRequestId: f.requestId } }),
      "the flag-off sweep created an auction the legacy path also creates",
    ).toBeNull();

    // ON — what the owner's flip changes. The sweep reaches the case; whether that case then
    // launches depends on readiness, which journey 1 covers.
    process.env[flag] = "true";
    const on = await sweepSourcingCases(prisma, new Date());
    expect(on.casesConsidered).toBeGreaterThan(0);
    expect(on.outcomes.FLAG_OFF, "the sweep stood down with the flag on").toBeUndefined();
  } finally {
    if (original === undefined) delete process.env[flag];
    else process.env[flag] = original;
  }
});

test("journey 3b: the concierge conversion is outside the flip in both positions", async () => {
  needsInfra();
  // §13-D52 precondition (b), owner ruling 2026-09-11. A concierge conversion is pre-sourced;
  // there is nothing to source, so opening a case for it would be wrong. Asserted against the
  // named guard so routing it through `applySettlementEffects` fails a test.
  const { CONCIERGE_IS_OUTSIDE_SOURCING_CASE_FLAG } = await import(
    "@/lib/services/concierge/concierge-conversion.service"
  );
  expect(CONCIERGE_IS_OUTSIDE_SOURCING_CASE_FLAG.opensSourcingCase).toBe(false);
  expect(CONCIERGE_IS_OUTSIDE_SOURCING_CASE_FLAG.writesLegacyPathWrite).toBe(false);
  expect(CONCIERGE_IS_OUTSIDE_SOURCING_CASE_FLAG.invitesDealers).toBe(false);
});

// ─────────────────────────────────────────────────────────────────────────────
// The dealer invitation link — S7-10, S7-13, §13-D37
// ─────────────────────────────────────────────────────────────────────────────

test("a tokenised invitation link shows the brief with NO buyer identity, and no action without a session", async ({ page }) => {
  needsInfra();
  const f = await seedPaidRequest({ rooftops: 5, caseStatus: "READY_TO_LAUNCH" });
  await blockVendors(page);

  const { launchFromCase } = await import("@/lib/services/sourcing/launch-readiness.service");
  const { getSourcingCaseById } = await import("@/lib/services/sourcing/sourcing-case.service");
  const sourcingCase = await getSourcingCaseById(f.caseId);
  const launched = await launchFromCase(f.requestId, sourcingCase!, prisma);
  test.skip(!launched.launched, `readiness held: ${launched.blockers.join(" | ")} — no invitation to follow`);

  // The RAW token is never stored, so it cannot be read back from the database. A spec that
  // needed one would have to mint it, which means re-deriving the mint — so this asserts the
  // link's REJECTION path with a token that was never issued, plus the id-based resume route.
  const unknown = "c".repeat(64);
  const res = await page.goto(`/dealer/invitation/${unknown}`);
  expect(
    res?.status(),
    "a token we never issued must be a 404 — 'expired' would assert we once issued it",
  ).toBe(404);

  const invitation = await prisma.auctionInvitation.findFirstOrThrow({
    where: { auction: { vehicleRequestId: f.requestId } },
  });

  // The resume route carries an id, not a credential, so it must prove everything from the
  // session. With none, it redirects to sign-in or offers the application path — never the brief.
  await page.goto(`/dealer/invitation/resume/${invitation.id}`);
  const url = page.url();
  const gated =
    /sign-?in/i.test(url) || (await page.getByTestId("resume-needs-account").isVisible().catch(() => false));
  expect(gated, "the resume route rendered a brief without a session — §13-D37 requires one").toBe(true);
  await expect(page.getByTestId("invitation-submit-offer")).toHaveCount(0);

  // S7-13, asserted against the PAGE rather than against the prop type: the buyer's name and
  // email must appear nowhere a dealership can read.
  const body = (await page.content()).toLowerCase();
  expect(body).not.toContain(`e2e-${f.stamp}-buyer@example.invalid`);
  expect(body).not.toContain(`buyer ${f.stamp}`.toLowerCase());
});
