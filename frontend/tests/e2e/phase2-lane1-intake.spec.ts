// Phase 2 — the Lane 1 intake journeys, end to end.
//
// SCOPE AND HONESTY NOTE, in the style tests/e2e already uses.
//
// These specs drive a real browser against a locally running app backed by the
// throwaway `autolenis_e2e` database, and assert PERSISTED STATE as well as
// visible text. §12.4: "Every Playwright journey asserts the browser-visible
// result and the persisted state (via the preview DB), and that duplicate
// submissions create no duplicate records."
//
// Prerequisites, and what happens without them:
//   • DATABASE_URL containing `autolenis_e2e` — otherwise every test SKIPS.
//     Same guard as every other spec here; it is what makes it impossible to
//     point this file at a real database by editing one env line.
//   • A running Next server at E2E_BASE_URL.
//   • The §12.3 preflight (scripts/preview-isolation-preflight.ts) having passed.
//
// WHAT IS DELIBERATELY NOT ASSERTED HERE.
//
// The buyer DASHBOARD leg of journey 1 needs a Supabase-authenticated buyer
// session. There is no non-production authenticated environment (CLAUDE.md ->
// CRITICAL ENVIRONMENT BOUNDARY) and this repository must not manufacture one,
// so that leg SKIPS with its reason rather than being approximated by a
// hand-minted cookie. What the dashboard READS — exactly one open Vehicle
// Request for the buyer — is asserted against the database instead, and that is
// stated as a different, weaker claim than "the dashboard rendered it".

import { test, expect, type APIRequestContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const HAS_DB = /autolenis_e2e/.test(process.env.DATABASE_URL ?? "");
const HAS_AUTH = !!process.env.E2E_STORAGE_STATE;

/** One namespace per project so desktop and mobile never collide. */
function ns(projectName: string): string {
  return `${projectName}-${process.env.E2E_RUN_ID ?? "local"}`;
}

async function countsFor(email: string) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, supabaseId: true, buyer: { select: { id: true } } },
  });
  const buyerId = user?.buyer?.id ?? null;
  const requests = buyerId
    ? await prisma.vehicleRequest.findMany({
        where: { buyerId },
        select: { id: true, status: true, zip: true, abandonedAt: true, notes: true },
      })
    : [];
  const leads = await prisma.buyerOpportunity.count({ where: { email } });
  return { user, buyerId, requests, leads };
}

test.beforeAll(async () => {
  test.skip(!HAS_DB, "DATABASE_URL must target autolenis_e2e — refusing to touch any other database");
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

// ───────────────────────────────────────────────────────────────────────────
// JOURNEY 1 — homepage → guest capture → claim → the request the dashboard reads
// ───────────────────────────────────────────────────────────────────────────

test.describe.serial("journey 1 — homepage capture, then claim", () => {
  test("the homepage hero captures a guest and persists exactly one draft request", async ({ page }, testInfo) => {
    test.skip(!HAS_DB, "no autolenis_e2e database");
    const email = `j1-${ns(testInfo.project.name)}@example.invalid`;

    await page.goto("/");
    const form = page.getByTestId("hero-intake-form");
    await expect(form, "§6.1's surface map opens with the homepage hero capture").toBeVisible();

    await page.getByTestId("hero-intake-email").fill(email);
    await page.getByTestId("hero-intake-zip").fill("75035");
    await page.getByTestId("hero-intake-interest").fill("Used SUV under $35k");
    await page.getByTestId("hero-intake-submit").click();

    // FAILURE MUST RENDER AS FAILURE: if the submit failed, the error element is
    // the one that appears, and this assertion reports the reason rather than a
    // bare timeout on the success element.
    const error = page.getByTestId("hero-intake-error");
    const success = page.getByTestId("hero-intake-success");
    await expect
      .poll(async () => ((await success.count()) ? "success" : (await error.count()) ? await error.innerText() : "pending"), {
        timeout: 15_000,
      })
      .toBe("success");

    // ── persisted state ──────────────────────────────────────────────────
    const { user, buyerId, requests, leads } = await countsFor(email);
    expect(user, "a guest capture writes a users row").not.toBeNull();
    expect(user!.supabaseId.startsWith("guest_"), "the capture is a GUEST, not a verified registration").toBe(true);
    expect(buyerId, "the guest capture writes a buyers row").not.toBeNull();
    expect(requests.length, "§5 rule 6: incomplete is a DRAFT, and exactly one").toBe(1);
    expect(requests[0]!.status).toBe("DRAFT");
    expect(requests[0]!.zip, "§5 rule 3: the ZIP is written to the Vehicle Request too").toBe("75035");
    expect(leads, "the lead row is written alongside the request").toBeGreaterThanOrEqual(1);

    // ── §6.4: all four recovery touches exist the moment the tab closes ──
    const touches = await prisma.commsOutbox.findMany({
      where: { vehicleRequestId: requests[0]!.id, templateKey: { startsWith: "draft_recovery_" } },
      select: { templateKey: true, runAt: true, cancelKey: true, status: true, cancelledAt: true },
      orderBy: { runAt: "asc" },
    });
    expect(touches.length, "§6.4 enqueues all four touches at capture — not chained").toBe(4);
    expect(new Set(touches.map((t) => t.cancelKey)).size, "one cancel key stops the whole sequence").toBe(1);
    expect(touches.every((t) => t.cancelledAt === null)).toBe(true);
  });

  test("a claim token binds the completion to the SAME buyer and the SAME request", async ({ request }, testInfo) => {
    test.skip(!HAS_DB, "no autolenis_e2e database");
    const email = `j1-${ns(testInfo.project.name)}@example.invalid`;

    const before = await countsFor(email);
    expect(before.buyerId, "journey 1's capture must have run first").not.toBeNull();
    const requestIdBefore = before.requests[0]!.id;

    // The claim link the buyer is emailed carries a RAW token; only its hash is
    // stored. Minting it here is exactly what the recovery email does.
    const { issueResumeToken } = await import("../../lib/services/buyer/request-resume-token.service");
    const { rawToken } = await issueResumeToken({ buyerId: before.buyerId!, vehicleRequestId: requestIdBefore });

    const res = await (request as APIRequestContext).post("/api/public/request-vehicle/complete", {
      data: {
        email,
        claimToken: rawToken,
        make: "Toyota",
        model: "4Runner",
        yearFrom: 2021,
        additionalNotes: "claimed via the emailed link",
      },
    });
    expect(res.status(), await res.text()).toBe(200);

    const after = await countsFor(email);
    expect(after.buyerId, "rule 16 tier 2: the token names the buyer — no second buyer is created").toBe(before.buyerId);
    expect(after.requests.length, "the open request is UPDATED, never duplicated").toBe(1);
    expect(after.requests[0]!.id, "and it is the same row").toBe(requestIdBefore);

    // The four recovery touches must stop once the draft advances.
    const touches = await prisma.commsOutbox.findMany({
      where: { vehicleRequestId: requestIdBefore, templateKey: { startsWith: "draft_recovery_" } },
      select: { cancelledAt: true, status: true },
    });
    expect(
      touches.filter((t) => t.cancelledAt !== null).length,
      "§6.4's second half: advancing the request cancels the whole sequence",
    ).toBe(touches.length);
  });

  test("the buyer dashboard shows that one request", async () => {
    test.skip(
      !HAS_AUTH,
      "NOT VERIFIED: the dashboard is buyer-authenticated (Supabase session). There is no non-production authenticated environment and this repository must not manufacture one. Needs E2E_STORAGE_STATE holding a real buyer session minted against a non-production Supabase project.",
    );
    expect(HAS_AUTH).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// JOURNEY 2 — a duplicate submission creates nothing
// ───────────────────────────────────────────────────────────────────────────

test("journey 2 — submitting the hero form twice creates no second buyer and no second request", async ({ page }, testInfo) => {
  test.skip(!HAS_DB, "no autolenis_e2e database");
  const email = `j2-${ns(testInfo.project.name)}@example.invalid`;

  async function submitOnce() {
    await page.goto("/");
    await page.getByTestId("hero-intake-email").fill(email);
    await page.getByTestId("hero-intake-zip").fill("75035");
    await page.getByTestId("hero-intake-submit").click();
    await expect(page.getByTestId("hero-intake-success")).toBeVisible({ timeout: 15_000 });
  }

  await submitOnce();
  const first = await countsFor(email);
  expect(first.requests.length).toBe(1);

  await submitOnce();
  const second = await countsFor(email);

  expect(second.user!.id, "the same guest user is reused").toBe(first.user!.id);
  expect(second.buyerId, "the same buyer is reused — repeated submissions are not several people").toBe(first.buyerId);
  expect(second.requests.length, "the one-open-request index holds: attach-and-update, never a second row").toBe(1);
  expect(second.requests[0]!.id).toBe(first.requests[0]!.id);

  // The partial unique index is the real control, not the application check.
  const openStatuses = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint AS n FROM vehicle_requests WHERE buyer_id = $1 AND status = ANY(ARRAY['DRAFT','SUBMITTED','INTAKE','PAYMENT_REQUIRED','ACTIVE_SOURCING','RADIUS_AUTHORIZATION_REQUIRED','OFFER_READY','OFFER_SENT','OFFER_ACCEPTED','OFFER_DECLINED']::"VehicleRequestStatus"[])`,
    first.buyerId,
  );
  expect(Number(openStatuses[0]!.n), "exactly one row satisfies the index predicate").toBe(1);
});

// ───────────────────────────────────────────────────────────────────────────
// JOURNEY 3 — the refinance form stays in Lane 2
// ───────────────────────────────────────────────────────────────────────────

test("journey 3 — the refinance form is Lane 2: it advances no Lane 1 transaction", async ({ page, request }, testInfo) => {
  test.skip(!HAS_DB, "no autolenis_e2e database");
  const email = `j3-${ns(testInfo.project.name)}@example.invalid`;

  // Browser leg: the page renders, and it does NOT mount the Lane 1 capture.
  await page.goto("/refinance");
  await expect(page.getByTestId("hero-intake-form"), "the Lane 1 hero capture belongs to the homepage only").toHaveCount(0);

  // API leg: a real Lane 2 submission.
  const res = await (request as APIRequestContext).post("/api/public/refinance", {
    data: {
      firstName: "Lane",
      lastName: "Two",
      email,
      phone: "5551230000",
      vehicleYear: 2021,
      loanBalanceCents: 2_400_000,
      monthlyPaymentCents: 60_000,
      interestRateBand: "OVER_12",
      employmentStatus: "FULL_TIME",
      state: "TX",
      consentGiven: true,
      source: `e2e-${ns(testInfo.project.name)}`,
    },
  });
  expect([200, 201].includes(res.status()), await res.text()).toBe(true);

  // Persisted state: a refinance lead exists, and NOTHING in Lane 1 moved.
  const lead = await prisma.refinanceApplication.findFirst({ where: { email } });
  expect(lead, "the Lane 2 surface did persist its own lead — this is not a vacuous pass").not.toBeNull();

  const { user, buyerId, requests } = await countsFor(email);
  expect(user, "Lane 2 creates no buyer identity").toBeNull();
  expect(buyerId).toBeNull();
  expect(requests.length, "Lane 2 creates no Vehicle Request").toBe(0);
});
