// Dealer entry funnel — end-to-end.
//
// SCOPE AND HONESTY NOTE. These specs drive the real browser against a locally
// running app backed by the seeded autolenis_e2e database. They assert DATABASE
// STATE, not just HTTP status or visible text.
//
// They require infrastructure this repository cannot provide by itself:
//   • a running Next server (playwright.e2e.config.ts baseURL)
//   • a Supabase auth instance — the claim and invite paths call
//     supabase.auth.admin.createUser(), which has no local stub
//   • DATABASE_URL pointed at autolenis_e2e (never production)
// Email is exercised through the existing DEV_SKIPPED path; no Stripe calls.
//
// Where that infrastructure is absent, the equivalent database-state assertions
// are executed by tests/integration/dealer-funnel.itest.ts, which runs today.
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

test.beforeAll(() => {
  const url = process.env.DATABASE_URL ?? "";
  if (!/autolenis_e2e/.test(url)) {
    throw new Error("Refusing to run E2E: DATABASE_URL must target autolenis_e2e");
  }
});
test.afterAll(async () => { await prisma.$disconnect(); });

// (a) application → claim → onboarding → ACTIVE → dashboard
test("(a) approved application claims, onboards, and becomes ACTIVE", async ({ page }) => {
  const { rawToken, dealerId } = await seedApprovedApplicationWithClaimToken();

  await page.goto(`/dealer/claim?token=${rawToken}`);
  // D1: this must NOT bounce to sign-in.
  await expect(page).toHaveURL(new RegExp("/dealer/claim"));

  await page.getByLabel(/password/i).first().fill("E2ePassw0rd!");
  await page.getByRole("button", { name: /create account|continue/i }).click();
  await expect(page).toHaveURL(new RegExp("/dealer/onboarding"));

  await completeFourOnboardingSteps(page);

  const dealer = await prisma.dealer.findUniqueOrThrow({ where: { id: dealerId } });
  expect(dealer.status).toBe("ACTIVE");
  expect(dealer.onboardingStep).toBe("COMPLETE");

  const sigs = await prisma.dealerAgreementSignature.count({ where: { dealerId } });
  expect(sigs).toBe(1);

  const claim = await prisma.dealerAccountClaimToken.findFirstOrThrow({ where: { dealerId } });
  expect(claim.consumedAt).not.toBeNull();

  await expect(page).toHaveURL(new RegExp("/dealer/dashboard"));
});

// (b) same via the invite path
test("(b) invited dealer claims and the invitation is hashed + consumed", async ({ page }) => {
  const { rawToken, email } = await seedPendingInvitation();

  await page.goto(`/dealer/invite/claim?token=${rawToken}`);
  await page.getByLabel(/password/i).first().fill("E2ePassw0rd!");
  await page.getByRole("button", { name: /create|claim|continue/i }).click();
  await expect(page).toHaveURL(new RegExp("/dealer/onboarding"));

  // Columns are named explicitly, and the token-column assertions are made
  // against whichever physical schema this database has: token_hash/consumed_at
  // only exist once migration 20260828000000 is applied, and an unqualified
  // select would fail with P2022 before that.
  const inv = await prisma.dealerInvitation.findFirstOrThrow({
    where: { email }, select: { id: true, status: true },
  });
  expect(inv.status).toBe("ACCEPTED");

  // Probed inline rather than through the service, so this spec needs no path
  // alias from the Playwright runner.
  const cols = await prisma.$queryRawUnsafe<Array<{ column_name: string; is_nullable: string }>>(
    `SELECT a.attname AS column_name,
            CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable
       FROM pg_attribute a
      WHERE a.attrelid = to_regclass('dealer_invitations')
        AND a.attnum > 0 AND NOT a.attisdropped
        AND a.attname IN ('token','token_hash','consumed_at')`,
  );
  const caps = {
    hasToken: cols.some(c => c.column_name === "token"),
    hasTokenHash: cols.some(c => c.column_name === "token_hash"),
    tokenRequired: cols.some(c => c.column_name === "token" && c.is_nullable === "NO"),
  };
  if (caps.hasTokenHash) {
    const [row] = await prisma.$queryRawUnsafe<Array<{ token: string | null; token_hash: string | null; consumed_at: Date | null }>>(
      `SELECT ${caps.hasToken ? '"token"' : "NULL AS token"}, "token_hash", "consumed_at"
         FROM dealer_invitations WHERE id = $1`,
      inv.id,
    );
    expect(row.token_hash).not.toBeNull();
    expect(row.consumed_at).not.toBeNull();
    if (!caps.tokenRequired) expect(row.token).toBeNull(); // D3: raw token never persisted
  }
});

// (c) a PENDING dealer is confined to onboarding
test("(c) PENDING dealer reaches onboarding and cannot reach inventory", async ({ page, request }) => {
  const { email, password } = await seedPendingDealerWithPassword();

  await page.goto("/dealer/sign-in");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();

  // D2: sign-in no longer 403s a PENDING account.
  await expect(page).toHaveURL(new RegExp("/dealer/onboarding"));

  // Portal page redirects back to onboarding rather than to sign-in.
  await page.goto("/dealer/inventory");
  await expect(page).toHaveURL(new RegExp("/dealer/onboarding"));

  // API is confined with a specific, actionable code.
  const res = await request.get("/api/dealer/inventory");
  expect(res.status()).toBe(403);
  expect((await res.json()).error.code).toBe("ONBOARDING_REQUIRED");
});

// (d) expired and reused claim tokens
test("(d) expired and reused claim tokens are rejected and create no dealer", async ({ page }) => {
  const before = await prisma.dealer.count();

  const expired = await seedExpiredClaimToken();
  await page.goto(`/dealer/claim?token=${expired}`);
  await expect(page.getByText(/expired/i)).toBeVisible();

  const consumed = await seedConsumedClaimToken();
  await page.goto(`/dealer/claim?token=${consumed}`);
  await expect(page.getByText(/already been used|already accepted/i)).toBeVisible();

  expect(await prisma.dealer.count()).toBe(before);
});

// (e) manual inventory add persists with dealer_id
test("(e) manual add persists a row with dealer_id set", async ({ page }) => {
  const { dealerId } = await signInActiveDealer(page);

  await page.goto("/dealer/inventory/add");
  await page.getByLabel(/vin/i).fill("1HGCM82633A123456");
  await page.getByLabel(/year/i).fill("2020");
  await page.getByLabel(/make/i).fill("Honda");
  await page.getByLabel(/model/i).fill("Accord");
  await page.getByLabel(/price/i).fill("25000");
  await page.getByTestId("condition-select").selectOption("USED");
  await page.getByRole("button", { name: /save|add vehicle/i }).click();

  const item = await prisma.inventoryItem.findFirstOrThrow({
    where: { dealerId, vin: "1HGCM82633A123456" },
  });
  expect(item.dealerId).toBe(dealerId);          // D8: not NULL
  expect(item.sourceAdapter).toBe("dealer_manual");
  expect(item.priceCents).toBe(2_500_000);       // dollars, not the 1/100 reading
});

// (f) both CSV paths agree on price
test("(f) both CSV paths import the same file to identical prices", async ({ page }) => {
  const { dealerId } = await signInActiveDealer(page);
  const csv = "vin,year,make,model,price\n1HGCM82633A111111,2020,Honda,Accord,25000\n";

  await importViaStandardHeaders(page, csv);
  const a = await prisma.inventoryItem.findFirstOrThrow({
    where: { dealerId, vin: "1HGCM82633A111111" },
  });
  await prisma.inventoryItem.delete({ where: { id: a.id } });

  await importViaColumnMapping(page, csv);       // D10: the mapping cookie must reach the bulk route
  const b = await prisma.inventoryItem.findFirstOrThrow({
    where: { dealerId, vin: "1HGCM82633A111111" },
  });

  expect(b.priceCents).toBe(a.priceCents);       // D11: identical, not 100x apart
  expect(a.priceCents).toBe(2_500_000);
});

// ── Fixtures. Implementations depend on the Supabase auth instance described in
// the header note; they are intentionally left as named seams rather than stubs
// that would make these specs appear to pass without exercising anything.
declare function seedApprovedApplicationWithClaimToken(): Promise<{ rawToken: string; dealerId: string }>;
declare function seedPendingInvitation(): Promise<{ rawToken: string; email: string }>;
declare function seedPendingDealerWithPassword(): Promise<{ email: string; password: string }>;
declare function seedExpiredClaimToken(): Promise<string>;
declare function seedConsumedClaimToken(): Promise<string>;
declare function signInActiveDealer(page: unknown): Promise<{ dealerId: string }>;
declare function completeFourOnboardingSteps(page: unknown): Promise<void>;
declare function importViaStandardHeaders(page: unknown, csv: string): Promise<void>;
declare function importViaColumnMapping(page: unknown, csv: string): Promise<void>;
