// Gate-bypass e2e — proves protected role surfaces cannot be reached by direct
// URL navigation without authentication, and that a privileged API route rejects
// unauthenticated calls. Exercises the proxy.ts RBAC redirects identified in the
// Phase 1 matrix. Run with:  npx playwright install chromium && pnpm test:e2e
import { test, expect } from "@playwright/test";

// pathname-prefix → expected sign-in destination prefix when unauthenticated.
const PROTECTED_REDIRECTS: { path: string; signinPrefix: string }[] = [
  { path: "/buyer/dashboard", signinPrefix: "/auth/signin" },
  { path: "/affiliate/portal/dashboard", signinPrefix: "/auth/signin" },
  { path: "/dealer/dashboard", signinPrefix: "/dealer/sign-in" },
  { path: "/admin/dashboard", signinPrefix: "/admin/auth/signin" },
];

for (const { path, signinPrefix } of PROTECTED_REDIRECTS) {
  test(`unauthenticated ${path} redirects to ${signinPrefix}`, async ({ page }) => {
    await page.goto(path);
    // Landed somewhere under the sign-in surface, not on the protected page.
    await expect(page).toHaveURL(new RegExp(`${signinPrefix.replace(/\//g, "\\/")}`));
    expect(page.url()).not.toContain(path);
  });
}

test("unauthenticated privileged API call is rejected (401)", async ({ request }) => {
  // The buyer esign route requires an authenticated buyer before any work.
  const res = await request.post("/api/buyer/esign/non-existent-deal-id");
  expect(res.status()).toBe(401);
});

// RBAC API perimeter — unauthenticated mutating calls to each role namespace must
// be rejected (401), never silently accepted. These assert the auth REJECTION
// (status code), not a rendered page, and need no seeded data.
const UNAUTH_MUTATIONS: { name: string; method: "post" | "patch"; path: string }[] = [
  { name: "buyer deposit intent", method: "post", path: "/api/buyer/deposit/create-intent" },
  { name: "buyer shortlist add", method: "post", path: "/api/buyer/shortlist" },
  { name: "buyer financing", method: "post", path: "/api/buyer/financing" },
  { name: "dealer offer create", method: "post", path: "/api/dealer/offers" },
  { name: "dealer pickup scan", method: "post", path: "/api/dealer/pickup/scan" },
  { name: "admin deal action", method: "post", path: "/api/admin/deals/non-existent/action" },
  { name: "affiliate payout request", method: "post", path: "/api/affiliate/payouts/request" },
];

for (const { name, method, path } of UNAUTH_MUTATIONS) {
  test(`unauthenticated ${name} (${path}) is rejected 401`, async ({ request }) => {
    const res = await request[method](path, { data: {} });
    // 401 = auth gate fired. (Never 2xx — that would mean an unguarded mutation.)
    expect(res.status(), `${path} must reject unauthenticated callers`).toBe(401);
  });
}
