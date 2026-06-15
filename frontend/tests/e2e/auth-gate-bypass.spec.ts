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
