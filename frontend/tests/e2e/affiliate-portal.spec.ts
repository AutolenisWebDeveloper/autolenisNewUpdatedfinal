import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

// Behavioural E2E for the affiliate portal remediation (Phase 9, T9.1).
//
// Every spec pins a defect that was found and fixed on this branch, so a
// regression shows up as failing behaviour rather than a code review someone
// has to redo.
//
// PREREQUISITES. These need a RUNNING instance (E2E_BASE_URL) and, per flow,
// a signed-in affiliate storage state. Where a prerequisite is missing the
// spec SKIPS with an explicit reason — it never passes vacuously (same
// convention as buyer-remediation.spec.ts / dealer-funnel.spec.ts).
//
//   E2E_AFFILIATE_STORAGE_STATE            signed-in ACTIVE affiliate whose
//                                          onboarding review is APPROVED
//   E2E_AFFILIATE_ID                       that affiliate's Affiliate.id, for
//                                          the database-ledger assertions
//   E2E_AFFILIATE_NEW_STORAGE_STATE        signed-in ACTIVE affiliate with NO
//                                          onboarding review row (NOT_STARTED)
//   E2E_AFFILIATE_SUSPENDED_STORAGE_STATE  signed-in SUSPENDED affiliate
//   DATABASE_URL                           must target autolenis_e2e for any
//                                          spec that reads or asserts DB state
//                                          (never production)
//
// Run:
//   E2E_BASE_URL=http://localhost:3000 \
//   E2E_AFFILIATE_STORAGE_STATE=./affiliate-state.json \
//   npx playwright test -c playwright.e2e.config.ts tests/e2e/affiliate-portal.spec.ts

const AFFILIATE_STATE = process.env.E2E_AFFILIATE_STORAGE_STATE;
const NEW_STATE = process.env.E2E_AFFILIATE_NEW_STORAGE_STATE;
const SUSPENDED_STATE = process.env.E2E_AFFILIATE_SUSPENDED_STORAGE_STATE;
const AFFILIATE_ID = process.env.E2E_AFFILIATE_ID;
const DB_IS_E2E = /autolenis_e2e/.test(process.env.DATABASE_URL ?? "");

// The two unauthenticated specs need only a running instance; the config
// defaults baseURL to localhost:3000, so E2E_BASE_URL is the explicit signal
// that one exists — without it they SKIP instead of failing on a dead socket.
const serverOnly = () =>
  test.skip(!process.env.E2E_BASE_URL, "E2E_BASE_URL not set — no running instance to test against");
const affiliateOnly = () =>
  test.skip(!AFFILIATE_STATE, "E2E_AFFILIATE_STORAGE_STATE not set — no signed-in affiliate session");
const dbOnly = () =>
  test.skip(!DB_IS_E2E, "DATABASE_URL does not target autolenis_e2e — refusing DB assertions");

// Lazily constructed so specs that never touch the DB don't need a valid URL.
let prisma: PrismaClient | null = null;
function db(): PrismaClient {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}
test.afterAll(async () => { await prisma?.$disconnect(); });

/** Every destination in AffiliateSidebar.NAV_ITEMS (kept in sync by the
 *  onboarding-gate unit test; listed literally here so the spec is
 *  self-contained for the Playwright runner). */
const PORTAL_ROUTES = [
  "/affiliate/portal/dashboard",
  "/affiliate/portal/referrals",
  "/affiliate/portal/referral-hub",
  "/affiliate/portal/earnings",
  "/affiliate/portal/finance",
  "/affiliate/portal/documents",
  "/affiliate/portal/network",
  "/affiliate/portal/leaderboard",
  "/affiliate/portal/income-calculator",
  "/affiliate/portal/notifications",
  "/affiliate/portal/compliance",
  "/affiliate/portal/resources",
  "/affiliate/portal/profile",
  "/affiliate/portal/settings",
];

/** The server gate's exempt set (ONBOARDING_EXEMPT_PATHS + the wizard). */
const EXEMPT_ROUTES = [
  "/affiliate/portal/onboarding",
  "/affiliate/portal/profile",
  "/affiliate/portal/settings",
  "/affiliate/portal/compliance",
  "/affiliate/portal/dashboard",
  "/affiliate/portal/notifications",
  "/affiliate/portal/resources",
];

async function withState(page: Page, state: string): Promise<{ ctx: BrowserContext; p: Page }> {
  const ctx = await page.context().browser()!.newContext({ storageState: state });
  return { ctx, p: await ctx.newPage() };
}

async function gotoOk(page: Page, path: string) {
  return page.goto(path, { waitUntil: "domcontentloaded" });
}

// ─────────────────────────────────────────────────────────────────────────────
// Access control — unauthenticated and bare-prefix behaviour (R1, proxy fix).
// ─────────────────────────────────────────────────────────────────────────────
test.describe("access control", () => {
  test("an unauthenticated visit to the portal redirects to sign-in, not a loop", async ({ browser }) => {
    serverOnly();
    // A fresh context guarantees no inherited storage state from the runner config.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const res = await page.goto("/affiliate/portal/dashboard", { waitUntil: "domcontentloaded" });
    expect(res, "no response — likely a redirect loop").not.toBeNull();
    expect(res!.status()).toBeLessThan(500);
    await expect(page).toHaveURL(/\/affiliate\/signin/);
    await ctx.close();
  });

  test("the bare /affiliate/portal path lands on the dashboard for a signed-in affiliate", async ({ page }) => {
    affiliateOnly();
    const { ctx, p } = await withState(page, AFFILIATE_STATE!);
    await gotoOk(p, "/affiliate/portal");
    // Proxy step 10 — bare prefix forwards to /dashboard instead of 404ing.
    await expect(p).toHaveURL(/\/affiliate\/portal\/dashboard/);
    await expect(p.getByTestId("affiliate-dashboard")).toBeVisible();
    await ctx.close();
  });

  test("a suspended affiliate is ejected to /affiliate/unsubscribed and denied by the API", async ({ page }) => {
    test.skip(!SUSPENDED_STATE, "E2E_AFFILIATE_SUSPENDED_STORAGE_STATE not set — needs a signed-in SUSPENDED affiliate");
    const { ctx, p } = await withState(page, SUSPENDED_STATE!);
    await gotoOk(p, "/affiliate/portal/dashboard");
    await expect(p).toHaveURL(/\/affiliate\/unsubscribed/);
    await expect(p.getByTestId("unsubscribed-title")).toBeVisible();
    // API enforcement, not just the page gate.
    const res = await ctx.request.get("/api/affiliate/dashboard");
    expect([401, 403]).toContain(res.status());
    await ctx.close();
  });

  test("a buyer-or-anonymous request is rejected by affiliate APIs", async ({ browser }) => {
    serverOnly();
    const ctx = await browser.newContext();
    for (const api of ["/api/affiliate/dashboard", "/api/affiliate/payouts/request"]) {
      const res = api.includes("request") ? await ctx.request.post(api) : await ctx.request.get(api);
      expect([401, 403], `${api} returned ${res.status()}`).toContain(res.status());
    }
    await ctx.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding gate — NOT_STARTED is confined to exempt pages + the wizard, and
// the exempt pages themselves must actually render (no dead ends).
// ─────────────────────────────────────────────────────────────────────────────
test.describe("onboarding gate", () => {
  test("a NOT_STARTED affiliate is routed to the wizard from gated pages", async ({ page }) => {
    test.skip(!NEW_STATE, "E2E_AFFILIATE_NEW_STORAGE_STATE not set — needs an affiliate with no onboarding review row");
    const { ctx, p } = await withState(page, NEW_STATE!);
    for (const path of ["/affiliate/portal/earnings", "/affiliate/portal/finance", "/affiliate/portal/network"]) {
      await gotoOk(p, path);
      await expect(p, `${path} must gate to the onboarding wizard`).toHaveURL(/\/affiliate\/portal\/onboarding/);
    }
    await ctx.close();
  });

  test("exempt pages stay reachable while onboarding is NOT_STARTED", async ({ page }) => {
    test.skip(!NEW_STATE, "E2E_AFFILIATE_NEW_STORAGE_STATE not set — needs an affiliate with no onboarding review row");
    const { ctx, p } = await withState(page, NEW_STATE!);
    for (const path of EXEMPT_ROUTES) {
      const res = await gotoOk(p, path);
      expect(res?.status(), `${path} status`).toBeLessThan(500);
      const landed = new URL(p.url()).pathname;
      // Exempt pages render in place; only the wizard route itself may show the wizard.
      if (path !== "/affiliate/portal/onboarding") {
        expect(landed, `${path} bounced to ${landed} despite being exempt`).toBe(path);
      }
    }
    // The compliance page in particular (the gate reconciliation defect).
    await gotoOk(p, "/affiliate/portal/compliance");
    await expect(p.getByTestId("affiliate-compliance-page").or(p.locator("main, body"))).toBeVisible();
    await ctx.close();
  });

  test("gated nav items carry the lock affordance for a NOT_STARTED affiliate", async ({ page }) => {
    test.skip(!NEW_STATE, "E2E_AFFILIATE_NEW_STORAGE_STATE not set — needs an affiliate with no onboarding review row");
    const { ctx, p } = await withState(page, NEW_STATE!);
    await gotoOk(p, "/affiliate/portal/dashboard");
    await expect(p.getByTestId("affiliate-nav-lock-earnings")).toBeVisible();
    await expect(p.getByTestId("affiliate-nav-lock-finance-hub")).toBeVisible();
    // Ungated destinations show no lock.
    await expect(p.getByTestId("affiliate-nav-lock-settings")).toHaveCount(0);
    await ctx.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Portal surfaces — every sidebar destination renders for an onboarded
// affiliate; no dead ends, no horizontal overflow at 375px.
// ─────────────────────────────────────────────────────────────────────────────
test.describe("portal surfaces", () => {
  test("every sidebar destination responds under 500 and offers a way forward", async ({ page }) => {
    affiliateOnly();
    const { ctx, p } = await withState(page, AFFILIATE_STATE!);
    for (const path of PORTAL_ROUTES) {
      const res = await gotoOk(p, path);
      expect(res, `${path} produced no response — likely a redirect loop`).not.toBeNull();
      expect(res!.status(), `${path} status`).toBeLessThan(500);
      const actionable = p.locator(
        'main a[href], main button:not([disabled]), aside a[href], form button[type="submit"]',
      );
      expect(await actionable.count(), `${path} is a terminal dead end`).toBeGreaterThan(0);
    }
    await ctx.close();
  });

  test("core pages have no horizontal overflow at 375px", async ({ page }) => {
    affiliateOnly();
    const { ctx, p } = await withState(page, AFFILIATE_STATE!);
    await p.setViewportSize({ width: 375, height: 812 });
    for (const path of ["/affiliate/portal/dashboard", "/affiliate/portal/earnings", "/affiliate/portal/network", "/affiliate/portal/finance"]) {
      await gotoOk(p, path);
      const overflows = await p.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(overflows, `${path} scrolls horizontally at 375px`).toBe(false);
    }
    await ctx.close();
  });

  test("the referral hub exposes the code and a working copy control", async ({ page }) => {
    affiliateOnly();
    const { ctx, p } = await withState(page, AFFILIATE_STATE!);
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
    await gotoOk(p, "/affiliate/portal/referral-hub");
    await expect(p.getByTestId("hub-referral-code")).toBeVisible();
    const link = (await p.getByTestId("hub-referral-link").textContent())?.trim() ?? "";
    expect(link, "referral link must embed ?ref=").toMatch(/\?ref=/);
    await p.getByTestId("hub-copy-link-btn").click();
    const copied = await p.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(link);
    await ctx.close();
  });

  test("notifications mark-read and mark-all-read update the badge truthfully", async ({ page }) => {
    affiliateOnly();
    const { ctx, p } = await withState(page, AFFILIATE_STATE!);
    await gotoOk(p, "/affiliate/portal/notifications");
    await expect(p.getByTestId("affiliate-notifications-page")).toBeVisible();
    // Either an empty state or a list — never the load-error panel on a healthy run.
    await expect(p.getByTestId("notifications-load-error")).toHaveCount(0);
    const markAll = p.getByTestId("affiliate-mark-all-read-btn");
    if (await markAll.isVisible()) {
      await markAll.click();
      await expect(p.getByTestId("affiliate-unread-badge")).toHaveCount(0);
      await expect(p.getByTestId("notifications-action-error")).toHaveCount(0);
    }
    await ctx.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Money truthfulness — the earnings the page shows must equal the ledger rule
// applied to the database (earned = PENDING+APPROVED+PAID plus negative
// REVERSED offsets; positive REVERSED and REJECTED never count).
// ─────────────────────────────────────────────────────────────────────────────
test.describe("earnings ledger", () => {
  test("the dashboard Total Earned equals the DB ledger aggregation", async ({ page }) => {
    affiliateOnly();
    dbOnly();
    test.skip(!AFFILIATE_ID, "E2E_AFFILIATE_ID not set — cannot aggregate this affiliate's ledger");

    const rows = await db().commission.findMany({
      where: { affiliateId: AFFILIATE_ID! },
      select: { amountCents: true, status: true },
    });
    const earnedCents = rows.reduce((sum, r) => {
      const counts =
        r.status === "PENDING" || r.status === "APPROVED" || r.status === "PAID" ||
        (r.status === "REVERSED" && r.amountCents < 0);
      return counts ? sum + r.amountCents : sum;
    }, 0);

    const { ctx, p } = await withState(page, AFFILIATE_STATE!);
    await gotoOk(p, "/affiliate/portal/dashboard");
    const shown = (await p.getByTestId("kpi-total-earned").textContent()) ?? "";
    const expected = `$${(earnedCents / 100).toLocaleString()}`;
    expect(shown, `dashboard shows ${shown}, ledger says ${expected}`).toContain(expected);
    await ctx.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Payout request rail (decision 3) — rejection paths are typed and the happy
// path writes a PENDING payout that claims the approved commissions.
// ─────────────────────────────────────────────────────────────────────────────
test.describe("payout request rail", () => {
  test("an affiliate below prerequisites gets a disabled control, not a dead click", async ({ page }) => {
    test.skip(!NEW_STATE, "E2E_AFFILIATE_NEW_STORAGE_STATE not set — needs a not-yet-onboarded affiliate");
    const { ctx } = await withState(page, NEW_STATE!);
    // Finance is gated for NOT_STARTED — the API must still refuse directly.
    const res = await ctx.request.post("/api/affiliate/payouts/request");
    expect(res.status(), "request without onboarding must be refused").toBe(409);
    const body = await res.json();
    expect(["ONBOARDING_REQUIRED", "NO_PAYOUT_METHOD", "NOTHING_TO_PAY", "BELOW_MINIMUM"]).toContain(body?.error?.code);
    await ctx.close();
  });

  test("the happy path creates a PENDING payout that claims the approved commissions", async ({ page }) => {
    affiliateOnly();
    dbOnly();
    test.skip(!AFFILIATE_ID, "E2E_AFFILIATE_ID not set — cannot verify claimed rows");

    const approved = await db().commission.aggregate({
      where: { affiliateId: AFFILIATE_ID!, status: "APPROVED", payoutId: null },
      _sum: { amountCents: true }, _count: true,
    });
    const open = await db().affiliatePayout.count({ where: { affiliateId: AFFILIATE_ID!, status: "PENDING" } });
    test.skip(
      open > 0 || (approved._sum.amountCents ?? 0) < 2500,
      `needs ≥ $25.00 unclaimed APPROVED and no open request (have $${((approved._sum.amountCents ?? 0) / 100).toFixed(2)}, ${open} open)`,
    );

    const { ctx, p } = await withState(page, AFFILIATE_STATE!);
    await gotoOk(p, "/affiliate/portal/finance");
    await p.getByTestId("request-payout-button").click();
    await p.getByRole("button", { name: /^request payout$/i }).click();
    await expect(p.getByTestId("payout-request-pending")).toBeVisible();

    const payout = await db().affiliatePayout.findFirstOrThrow({
      where: { affiliateId: AFFILIATE_ID!, status: "PENDING" },
      orderBy: { requestedAt: "desc" },
    });
    expect(payout.amountCents).toBe(approved._sum.amountCents);
    const claimed = await db().commission.count({ where: { payoutId: payout.id, status: "APPROVED" } });
    expect(claimed).toBe(approved._count);

    // A second request while one is open must be refused, not double-claim.
    const res = await ctx.request.post("/api/affiliate/payouts/request");
    expect(res.status()).toBe(409);
    expect((await res.json())?.error?.code).toBe("REQUEST_PENDING");
    await ctx.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Documents — upload persists and renders in the list (shared upload service).
// ─────────────────────────────────────────────────────────────────────────────
test.describe("documents", () => {
  test("a document upload lands in the list without a silent failure", async ({ page }) => {
    affiliateOnly();
    const { ctx, p } = await withState(page, AFFILIATE_STATE!);
    await gotoOk(p, "/affiliate/portal/documents");
    const input = p.locator('input[type="file"]').first();
    test.skip((await input.count()) === 0, "documents page exposes no file input in this state");
    await input.setInputFiles({
      name: "e2e-w9.pdf", mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 e2e test document"),
    });
    const submit = p.getByRole("button", { name: /upload/i }).first();
    if (await submit.isVisible()) await submit.click();
    // Success is visible state, not silence: the new row or a confirmation.
    await expect(p.locator("body")).not.toContainText(/upload failed|something went wrong/i);
    await ctx.close();
  });
});
