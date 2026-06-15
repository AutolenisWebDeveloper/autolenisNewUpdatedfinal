// Lifecycle gate-ENFORCEMENT e2e. Each test asserts the real rejection (HTTP 409/
// 400 + error code), NOT that a page rendered. Requires the gate fixtures
// (scripts/seed-e2e-gates.ts) and runs against E2E_BASE_URL.
//
// Auth: dealer via the real signin API; admin via a minted token (same JWT_SECRET
// as the deployed app — must be provided to the job); buyer via the real signin form.
import { test, expect } from "@playwright/test";
import { signInDealer, adminCookieHeader, signInBuyerUi } from "./helpers/auth";
import { GATE } from "./fixtures/constants";

test.describe("lifecycle gate enforcement (asserts rejection, not render)", () => {
  // INSURANCE gate — dealer scans a SIGNED deal whose insuranceStatus is NOT_STARTED.
  test("insurance gate: dealer scan without insurance proof → 409 INSURANCE_REQUIRED", async ({ request }) => {
    await signInDealer(request);
    const res = await request.post("/api/dealer/pickup/scan", { data: { qrToken: GATE.insuranceQrToken } });
    expect(res.status(), "must reject completion without insurance").toBe(409);
    expect(JSON.stringify(await res.json())).toContain("INSURANCE_REQUIRED");
  });

  // ILLEGAL JUMP — admin tries FINANCING_PENDING → COMPLETED without force.
  test("illegal stage jump via admin action → 409 INVALID_TRANSITION (no force)", async ({ request }) => {
    const res = await request.post(`/api/admin/deals/${GATE.dealJumpId}/action`, {
      headers: { Cookie: await adminCookieHeader() },
      data: { action: "DEAL_STAGE_ADVANCED", newStatus: "COMPLETED", reason: "e2e illegal jump" },
    });
    expect(res.status(), "non-adjacent jump must be rejected").toBe(409);
    expect(JSON.stringify(await res.json())).toContain("INVALID_TRANSITION");
  });

  // CONTRACT SHIELD gate — buyer requests esign on a CONTRACT_PENDING deal.
  test("esign gate: signing before CONTRACT_APPROVED → 409 CONTRACT_NOT_APPROVED", async ({ page, context }) => {
    await signInBuyerUi(page, GATE.esignBuyerEmail, GATE.esignBuyerPassword);
    const res = await context.request.post(`/api/buyer/esign/${GATE.dealEsignId}`, { data: {} });
    expect(res.status(), "esign must be blocked until Contract Shield approves").toBe(409);
    expect(JSON.stringify(await res.json())).toContain("CONTRACT_NOT_APPROVED");
  });

  // SHORTLIST gate — buyer with active prequal but empty shortlist tries to activate.
  test("shortlist gate: deposit/auction with empty shortlist → 400 SHORTLIST_REQUIRED", async ({ page, context }) => {
    await signInBuyerUi(page, GATE.shortlistBuyerEmail, GATE.shortlistBuyerPassword);
    const res = await context.request.post("/api/buyer/deposit/create-intent", { data: {} });
    expect(res.status(), "auction activation must require a non-empty shortlist").toBe(400);
    expect(JSON.stringify(await res.json())).toContain("SHORTLIST_REQUIRED");
  });

  // CROSS-ROLE PROPAGATION — a buyer stage transition surfaces on the admin activity feed.
  // Presence-level assertion: the transition produces a DEAL_STAGE_CHANGED event the
  // admin feed exposes. (The event metadata carries {from,to} but not dealId, so this
  // matches by event type + "fee pending" title, which in the seeded test env is
  // produced only by this action.)
  test("propagation: buyer financing transition appears on the admin activity feed", async ({ page, context, request }) => {
    await signInBuyerUi(page, GATE.propBuyerEmail, GATE.propBuyerPassword);
    const patch = await context.request.patch("/api/buyer/deal/financing", { data: { financingPath: "DEALER" } });
    expect(patch.ok(), "buyer financing transition should succeed").toBeTruthy();

    const activity = await request.get("/api/admin/activity?limit=200", { headers: { Cookie: await adminCookieHeader() } });
    expect(activity.ok(), "admin activity feed should load").toBeTruthy();
    const events = (await activity.json())?.data?.events ?? [];
    const propagated = JSON.stringify(events).toLowerCase();
    expect(propagated).toContain("fee pending"); // the buyer's stage change reached the admin surface
  });
});
