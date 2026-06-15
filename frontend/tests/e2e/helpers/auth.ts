// e2e auth helpers. Three real mechanisms, matching the app exactly:
//   - dealer: POST the real /api/dealer/auth/signin (sets dealer_token cookie in
//             the APIRequestContext jar, reused by subsequent calls).
//   - admin:  mint an admin_token JWT identically to lib/admin-auth.signAdminJwt
//             (HS256, issuer autolenis-admin, 24h, claims incl. mfaVerified) using
//             the same JWT_SECRET the deployed app verifies with.
//   - buyer:  drive the REAL /auth/signin form (Supabase getUser() validates the
//             session server-side, so a real login is required — no minting).
import { SignJWT } from "jose";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { GATE } from "../fixtures/constants";

// Replicates lib/admin-auth.ts: signAdminJwt + getAdminJwtSecret (TextEncoder(JWT_SECRET)).
// Requires the e2e job's JWT_SECRET to match the deployed preview's.
export async function mintAdminToken(): Promise<string> {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set — required to mint the admin e2e token");
  return new SignJWT({
    adminId: GATE.adminId,
    role: "SUPER_ADMIN",
    email: GATE.adminEmail,
    mfaVerified: true,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("autolenis-admin")
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(new TextEncoder().encode(secret));
}

export async function adminCookieHeader(): Promise<string> {
  return `admin_token=${await mintAdminToken()}`;
}

// Authenticates the gate dealer in the given APIRequestContext (cookie persists
// in the context jar for subsequent requests).
export async function signInDealer(request: APIRequestContext): Promise<void> {
  const res = await request.post("/api/dealer/auth/signin", {
    data: { email: GATE.dealerEmail, password: GATE.dealerPassword },
  });
  expect(res.status(), "dealer signin should succeed").toBe(200);
}

// Logs a buyer in through the real sign-in form; the resulting page.context()
// holds the Supabase session cookies, and context.request reuses them.
export async function signInBuyerUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/auth/signin");
  await page.getByTestId("signin-email-input").fill(email);
  await page.getByTestId("signin-password-input").fill(password);
  await page.getByTestId("signin-form").getByRole("button", { name: /sign in/i }).click();
  // Land off the sign-in page (dashboard or redirect target).
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/signin"), { timeout: 15_000 });
}
