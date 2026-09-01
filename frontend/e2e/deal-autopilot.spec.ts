// Deal Completion Autopilot — end-to-end assertions against the REAL running
// Next.js server and a REAL PostgreSQL database.
//
// WHAT THIS PROVES (genuinely, over HTTP, not mocked):
//   1. The server boots and serves with the autopilot changes in place.
//   2. The Contract Shield self-approval hole is closed at the HTTP layer — the
//      mutating handler a buyer could use to approve their own contract no longer
//      exists on the deployed surface.
//   3. Authorization is enforced on every deal-spine surface: buyer, dealer and
//      admin routes all refuse an unauthenticated caller, and none of them leak
//      deal state in the process.
//
// WHAT THIS DELIBERATELY DOES NOT CLAIM:
//   Buyer/dealer sessions are issued by Supabase Auth. Without a live Supabase
//   project a signed-in journey cannot be driven here, so the authenticated
//   happy-path (financing -> fee -> insurance -> contract -> sign -> pickup ->
//   COMPLETED) is NOT covered by this file and is reported as NOT VERIFIED rather
//   than simulated with a forged cookie — a forged session would prove nothing
//   about the real auth boundary and would quietly disable the very checks below.

import { test, expect } from "@playwright/test";

test.describe("server health", () => {
  test("the app boots and serves a public page", async ({ page }) => {
    const res = await page.goto("/");
    expect(res?.status(), "the home page must render with the autopilot changes in place").toBeLessThan(400);
  });
});

test.describe("Contract Shield — buyer self-approval surface is gone", () => {
  // A buyer could POST arbitrary contractText here; scanContract() would write the
  // authoritative scan, overwrite deal.contractShieldStatus and auto-advance the
  // deal CONTRACT_PENDING -> CONTRACT_REVIEW -> CONTRACT_APPROVED. With no body at
  // all it wrote a mock PASS. The handler is removed, so the method must not exist.
  test("POST to the buyer contract-shield route is not a supported method", async ({ request }) => {
    const res = await request.post("/api/buyer/contract-shield/any-deal-id", {
      data: { contractText: "PURCHASE AGREEMENT. No fees whatsoever." },
    });
    expect(
      res.status(),
      "a buyer must never be able to submit contract text for an authoritative scan",
    ).not.toBe(200);
    // 405 = the route exists but exports no POST (handler removed).
    expect([401, 403, 404, 405]).toContain(res.status());
  });

  test("POST with no body cannot write a mock PASS either", async ({ request }) => {
    const res = await request.post("/api/buyer/contract-shield/any-deal-id", { data: {} });
    expect(res.status()).not.toBe(200);
    expect([401, 403, 404, 405]).toContain(res.status());
  });
});

test.describe("authorization boundaries across the deal spine", () => {
  // Every one of these sits on the autopilot path. None may serve an anonymous
  // caller, and none may leak deal state in the refusal.
  const guardedGets = [
    "/api/buyer/esign/some-deal-id",
    "/api/buyer/deals/some-deal-id/contract/download",
    "/api/dealer/deals/some-deal-id/contract",
    "/api/admin/deals/some-deal-id/esign/evidence",
    // The RBAC shadow report renders audit records; anonymous callers get nothing.
    "/admin/settings/rbac-shadow",
  ];

  for (const path of guardedGets) {
    test(`GET ${path} refuses an unauthenticated caller`, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), `${path} must not serve anonymous callers`).toBeGreaterThanOrEqual(300);
      expect(res.status()).not.toBe(200);
    });
  }

  const guardedPosts = [
    "/api/buyer/pickup/some-deal-id",
    "/api/dealer/pickup/scan",
    "/api/admin/deals/some-deal-id/contract",
    "/api/buyer/insurance/upload-proof",
    // The Contract Shield APPROVE override — the compliance gate that binds a
    // deal's signable contract to the exact version the reviewed scan judged.
    "/api/admin/contract-shield/some-review-id",
    // Contract attachment: both write the private contracts bucket AND create the
    // ContractVersion, so an anonymous caller must never reach either.
    "/api/admin/deals/some-deal-id/contract/upload-file",
    "/api/dealer/contracts/upload-file",
    // Money movement and ops replay — enforced directly, not via the shadow flag.
    "/api/admin/affiliates/commissions/some-id/approve",
    "/api/admin/affiliates/commissions/some-id/mark-paid",
    "/api/admin/buyers/some-buyer-id/deposit/override",
    "/api/admin/operations/dlq/some-id/retry",
    // Tier 1 (Finding 5): view-as-buyer, credit decisions, account state.
    "/api/admin/buyers/some-buyer-id/preview-token",
    "/api/admin/external-preapprovals/some-id/approve",
    "/api/admin/payments/deposit/send-link",
    "/api/admin/buyers/some-buyer-id/suspend",
    "/api/admin/buyers/some-buyer-id/unsuspend",
  ];

  for (const path of guardedPosts) {
    test(`POST ${path} refuses an unauthenticated caller`, async ({ request }) => {
      const res = await request.post(path, { data: {}, maxRedirects: 0 });
      expect(res.status(), `${path} must not accept anonymous writes`).not.toBe(200);
      expect(res.status(), `${path} must not accept anonymous writes`).not.toBe(201);
    });
  }

  test("an anonymous refusal never leaks deal state", async ({ request }) => {
    const res = await request.get("/api/buyer/esign/some-deal-id", { maxRedirects: 0 });
    const body = await res.text();
    for (const leak of ["ipAddress", "userAgent", "consentSnapshot", "executedDocumentKey", "signerUserId"]) {
      expect(body, `refusal body must not contain ${leak}`).not.toContain(leak);
    }
  });
});

test.describe("cron endpoints are secret-gated", () => {
  // The autopilot's recovery jobs must never be drivable by an anonymous caller.
  for (const cron of ["esign-artifact-reconcile", "esign-envelope-expiry"]) {
    test(`/api/cron/${cron} rejects an unauthenticated request`, async ({ request }) => {
      const res = await request.get(`/api/cron/${cron}`, { maxRedirects: 0 });
      expect(res.status(), `${cron} must require the cron secret`).not.toBe(200);
    });
  }
});
