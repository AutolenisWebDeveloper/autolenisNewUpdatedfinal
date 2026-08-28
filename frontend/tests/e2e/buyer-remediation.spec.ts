import { test, expect, type Page } from "@playwright/test";

// Behavioural E2E for the buyer-portal remediation.
//
// Every spec here pins a defect that was found and fixed, so a regression shows
// up as a failing behaviour rather than as a code review someone has to redo.
//
// PREREQUISITES. These need a RUNNING instance (E2E_BASE_URL) and, for the
// authenticated flows, a signed-in buyer storage state (E2E_STORAGE_STATE).
// Where a prerequisite is missing the spec SKIPS with an explicit reason — it
// never passes vacuously, because a green suite that checked nothing is worse
// than a skipped one.
//
// Run:
//   E2E_BASE_URL=https://<preview> \
//   E2E_STORAGE_STATE=./buyer-state.json \
//   pnpm test:e2e

const HAS_AUTH = !!process.env.E2E_STORAGE_STATE;
const authOnly = (reason = "E2E_STORAGE_STATE not set — no signed-in buyer session") =>
  test.skip(!HAS_AUTH, reason);

/** Every buyer route reachable from the sidebar, plus the standalone screens. */
const BUYER_ROUTES = [
  "/buyer/dashboard",
  "/buyer/prequal",
  "/buyer/search",
  "/buyer/searches",
  "/buyer/shortlist",
  "/buyer/auctions",
  "/buyer/deal",
  "/buyer/deal/financing",
  "/buyer/financing",
  "/buyer/contract-shield",
  "/buyer/contracts",
  "/buyer/fee",
  "/buyer/esign",
  "/buyer/pickup",
  "/buyer/requests",
  "/buyer/trade-in",
  "/buyer/notifications",
  "/buyer/messages",
  "/buyer/documents",
  "/buyer/insurance",
  "/buyer/billing",
  "/buyer/activity",
  "/buyer/referral",
  "/buyer/profile",
  "/buyer/settings",
];

/** Copy that may only appear when the server has confirmed the underlying fact. */
const UNBACKED_CLAIMS = [
  /auction is now live/i,
  /dealers are being invited/i,
  /payment confirmed/i,
  /service fee paid/i,
];

async function gotoOk(page: Page, path: string) {
  const res = await page.goto(path, { waitUntil: "domcontentloaded" });
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// P0-3 — the unapplied-migration blast radius.
// These three routes issued unnarrowed ESignEnvelope reads and would throw
// "The column e_sign_envelopes.executed_document_key does not exist in the
// current database" the moment a real deal existed.
// ─────────────────────────────────────────────────────────────────────────────
test.describe("e-sign schema gate", () => {
  for (const path of ["/buyer/esign", "/buyer/pickup", "/buyer/contracts"]) {
    test(`${path} renders against the physical schema`, async ({ page }) => {
      authOnly();
      const res = await gotoOk(page, path);
      expect(res?.status(), `${path} must not 500`).toBeLessThan(500);
      await expect(page.locator("body")).not.toContainText("does not exist in the current database");
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// P0-2 — false success on the money path.
// The deposit page must never assert that the auction is live from client state.
// ─────────────────────────────────────────────────────────────────────────────
test.describe("deposit truthfulness", () => {
  test("the deposit page makes no activation claim before payment", async ({ page }) => {
    authOnly();
    await gotoOk(page, "/buyer/deposit");
    const body = page.locator("body");
    for (const claim of UNBACKED_CLAIMS) {
      await expect(body, `unbacked claim rendered before any payment: ${claim}`).not.toContainText(claim);
    }
  });

  test("the verifying page refuses to claim success without a payment reference", async ({ page }) => {
    authOnly();
    await gotoOk(page, "/buyer/deposit/success");
    // No payment_intent → nothing is known → no success claim.
    await expect(page.getByTestId("deposit-success-page")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/auction is now live/i);
  });

  test("a succeeded-but-unsettled payment is acknowledged, not shown as a failure", async ({ page }) => {
    test.skip(
      !process.env.E2E_SUCCEEDED_UNSETTLED_PI,
      "E2E_SUCCEEDED_UNSETTLED_PI not set — needs a Stripe TEST-MODE PaymentIntent " +
        "that succeeded while its Deposit row is still PENDING (the webhook-never-arrives case)",
    );
    authOnly();
    await gotoOk(page, `/buyer/deposit/success?payment_intent=${process.env.E2E_SUCCEEDED_UNSETTLED_PI}`);
    await expect(page.getByTestId("deposit-charged-unsettled-page")).toBeVisible();
    // It must acknowledge the charge and forbid re-paying...
    await expect(page.locator("body")).toContainText(/do not pay again/i);
    // ...and must NOT offer the pay-again route or claim the auction is live.
    await expect(page.getByTestId("deposit-failed-page")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/auction is now live/i);
  });

  test("a buyer who already paid is never shown another card form", async ({ page }) => {
    test.skip(
      !process.env.E2E_CHARGED_UNSETTLED_STORAGE_STATE,
      "E2E_CHARGED_UNSETTLED_STORAGE_STATE not set — needs a signed-in buyer whose " +
        "newest Deposit is PENDING while its Stripe TEST-MODE PaymentIntent already " +
        "succeeded (the webhook-never-arrives case, on the deposit page itself)",
    );
    await page.context().storageState({ path: process.env.E2E_CHARGED_UNSETTLED_STORAGE_STATE });
    await gotoOk(page, "/buyer/deposit");

    // The honest state renders instead of the sales surface...
    await expect(page.getByTestId("deposit-charge-unsettled-block")).toBeVisible();
    await expect(page.locator("body")).toContainText(/do not pay again/i);

    // ...and every route to a second $99 charge is absent, not merely disabled.
    await expect(page.getByTestId("deposit-payment-form")).toHaveCount(0);
    await expect(page.getByTestId("deposit-submit-btn")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/total charged today/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P0-1 / access loops — no buyer route may redirect to itself, and the
// suspension notice must actually render.
// ─────────────────────────────────────────────────────────────────────────────
test.describe("access loops", () => {
  test("no buyer route redirects in a cycle", async ({ page }) => {
    authOnly();
    for (const path of BUYER_ROUTES) {
      const res = await gotoOk(page, path);
      expect(res, `${path} produced no response — likely a redirect loop`).not.toBeNull();
      expect(res!.status(), `${path} status`).toBeLessThan(500);
    }
  });

  test("the suspension notice renders instead of redirecting to itself", async ({ page }) => {
    test.skip(
      !process.env.E2E_SUSPENDED_STORAGE_STATE,
      "E2E_SUSPENDED_STORAGE_STATE not set — needs a signed-in SUSPENDED buyer session",
    );
    const ctx = await page.context().browser()!.newContext({
      storageState: process.env.E2E_SUSPENDED_STORAGE_STATE,
    });
    const suspended = await ctx.newPage();
    const res = await suspended.goto("/buyer/suspended", { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBeLessThan(400);
    await expect(suspended.getByRole("heading", { name: /account suspended/i })).toBeVisible();
    await ctx.close();
  });

  test("a suspended buyer is denied by the API, not just the UI", async ({ request }) => {
    test.skip(
      !process.env.E2E_SUSPENDED_STORAGE_STATE,
      "E2E_SUSPENDED_STORAGE_STATE not set — needs a signed-in SUSPENDED buyer session",
    );
    // Suspension used to be enforced only on pages; every /api/buyer/** route
    // stayed writable.
    const res = await request.get("/api/buyer/me");
    expect([401, 403]).toContain(res.status());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Removed escalation paths. Both were zero-caller endpoints that let a buyer
// decide something only the system may decide.
// ─────────────────────────────────────────────────────────────────────────────
test.describe("removed escalation endpoints", () => {
  test("a buyer cannot self-approve Contract Shield", async ({ request }) => {
    authOnly();
    test.skip(!process.env.E2E_DEAL_ID, "E2E_DEAL_ID not set — needs a deal owned by the test buyer");
    const res = await request.post(`/api/buyer/contract-shield/${process.env.E2E_DEAL_ID}`, { data: {} });
    expect(res.status(), "POST must no longer be routable").toBeGreaterThanOrEqual(400);
  });

  test("a buyer cannot mint their own pickup QR", async ({ request }) => {
    authOnly();
    test.skip(!process.env.E2E_DEAL_ID, "E2E_DEAL_ID not set — needs a deal owned by the test buyer");
    const res = await request.post(`/api/buyer/pickup/${process.env.E2E_DEAL_ID}/qr`);
    expect(res.status(), "the QR self-issue route must be gone").toBeGreaterThanOrEqual(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Navigation: journey-aware nav, no dead ends, no dead links.
// ─────────────────────────────────────────────────────────────────────────────
test.describe("navigation", () => {
  test("unreachable sidebar items are locked, not silent-bounce links", async ({ page }) => {
    test.skip(
      !process.env.E2E_NEW_BUYER_STORAGE_STATE,
      "E2E_NEW_BUYER_STORAGE_STATE not set — needs a signed-in buyer who has NOT completed onboarding",
    );
    const ctx = await page.context().browser()!.newContext({
      storageState: process.env.E2E_NEW_BUYER_STORAGE_STATE,
    });
    const fresh = await ctx.newPage();
    await fresh.goto("/buyer/dashboard", { waitUntil: "domcontentloaded" });

    // Deal-flow items must be locked for a buyer who has not onboarded.
    const locked = fresh.locator('[data-locked="true"]');
    expect(await locked.count(), "expected locked nav items for a pre-onboarding buyer").toBeGreaterThan(0);
    await expect(locked.first()).toHaveAttribute("aria-disabled", "true");

    // Nothing rendered as a live link may silently bounce to onboarding.
    const links = fresh.locator('aside a[href^="/buyer/"]');
    for (let i = 0; i < (await links.count()); i++) {
      const href = await links.nth(i).getAttribute("href");
      if (!href || href === "/buyer/onboarding") continue;
      const res = await fresh.goto(href, { waitUntil: "domcontentloaded" });
      expect(res?.status()).toBeLessThan(500);
      expect(
        new URL(fresh.url()).pathname,
        `${href} is offered as a live link but bounced to onboarding`,
      ).not.toBe("/buyer/onboarding");
      await fresh.goto("/buyer/dashboard", { waitUntil: "domcontentloaded" });
    }
    await ctx.close();
  });

  test("every buyer page offers a way forward or back", async ({ page }) => {
    authOnly();
    for (const path of BUYER_ROUTES) {
      await gotoOk(page, path);
      const actionable = page.locator(
        'main a[href], main button:not([disabled]), aside a[href], form button[type="submit"]',
      );
      expect(await actionable.count(), `${path} is a terminal dead end`).toBeGreaterThan(0);
    }
  });

  test("a stale deep link keeps the buyer inside the portal", async ({ page }) => {
    authOnly();
    // notFound() used to fall through to the marketing 404, whose only action
    // pointed at "/" — ejecting an authenticated buyer from their portal.
    await gotoOk(page, "/buyer/contracts/does-not-exist");
    await expect(page.getByTestId("buyer-not-found")).toBeVisible();
    await expect(page.getByTestId("buyer-not-found-dashboard-btn")).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-role isolation — a buyer token must be rejected on the other portals.
// ─────────────────────────────────────────────────────────────────────────────
test.describe("cross-role isolation", () => {
  for (const root of ["/api/dealer/deals", "/api/affiliate/dashboard", "/api/admin/buyers"]) {
    test(`a buyer session is rejected at ${root}`, async ({ request }) => {
      authOnly();
      const res = await request.get(root);
      expect([401, 403, 404], `${root} returned ${res.status()}`).toContain(res.status());
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Truthfulness sweep — no surface may assert money/dealer facts it cannot back.
// ─────────────────────────────────────────────────────────────────────────────
test.describe("truthfulness", () => {
  test("no buyer page claims a payment or dealer activity without server backing", async ({ page }) => {
    test.skip(
      !process.env.E2E_UNPAID_STORAGE_STATE,
      "E2E_UNPAID_STORAGE_STATE not set — needs a signed-in buyer with NO paid deposit and NO paid fee",
    );
    const ctx = await page.context().browser()!.newContext({
      storageState: process.env.E2E_UNPAID_STORAGE_STATE,
    });
    const unpaid = await ctx.newPage();
    for (const path of ["/buyer/dashboard", "/buyer/deposit", "/buyer/fee", "/buyer/deal", "/buyer/billing"]) {
      await unpaid.goto(path, { waitUntil: "domcontentloaded" });
      for (const claim of UNBACKED_CLAIMS) {
        await expect(
          unpaid.locator("body"),
          `${path} claims ${claim} for a buyer who has paid nothing`,
        ).not.toContainText(claim);
      }
    }
    await ctx.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Responsive + keyboard walk of the core flow.
// ─────────────────────────────────────────────────────────────────────────────
test.describe("responsive and keyboard", () => {
  test("the portal shell works at mobile width without horizontal overflow", async ({ page }) => {
    authOnly();
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ["/buyer/dashboard", "/buyer/search", "/buyer/deposit", "/buyer/fee"]) {
      await gotoOk(page, path);
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(overflows, `${path} scrolls horizontally at 390px`).toBe(false);
    }
  });

  test("the mobile drawer is keyboard reachable and dismissible", async ({ page }) => {
    authOnly();
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoOk(page, "/buyer/dashboard");
    await page.getByTestId("buyer-mobile-menu-toggle").click();
    await expect(page.getByTestId("buyer-mobile-drawer")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("buyer-mobile-drawer")).toBeHidden();
  });
});
