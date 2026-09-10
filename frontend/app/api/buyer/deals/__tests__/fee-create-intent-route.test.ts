// §23.2 / PAY-58 — POST /api/buyer/deals/[dealId]/fee/create-intent must not mint a
// $400 PaymentIntent while the upgrade window is shut.
//
// THE DEFECT. This route had no plan check of any kind. Both admin twins
// (`concierge-fee/create-intent`, `concierge-fee/send-link`) refuse a non-Premium
// buyer; only the UI kept a Standard buyer away from here. A Standard buyer who POSTed
// directly received a $400 client secret for a plan they had not elected and a window
// that had never opened.
//
// The window is a stricter gate than a plan-flag check would have been, in three ways
// that each matter: it requires a settled, unrefunded, undisputed $99 (§23.2's "what
// must be true"), it refuses once the balance has already settled, and it refuses after
// funding clears. A `buyers.plan === "PREMIUM"` check allows all three.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//   "app/api/buyer/deals/__tests__/fee-create-intent-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

interface Ctrl {
  deal: Record<string, unknown> | null;
  window: { open: boolean; reason?: string; detail?: string };
  windowChecked: string[];
  intentCalls: number;
}
let ctrl: Ctrl;

mock.module("@/lib/auth/api", {
  namedExports: {
    getRequestBuyer: async () => ({ id: "buyer_1" }),
    successResponse: (data: unknown) => ({ ok: true, data }),
    errorResponse: (code: string, message: string, status: number, details?: unknown) => ({
      ok: false, code, message, status, details,
    }),
  },
});
mock.module("@/lib/prisma", {
  namedExports: { prisma: { deal: { findFirst: async () => ctrl.deal } } },
});
mock.module("@/lib/security/rate-limit", {
  namedExports: { limitPaymentIntent: async () => ({ ok: true }), clientIpKey: () => "ip" },
});
mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});
mock.module("@/lib/services/plan/upgrade-window.service", {
  namedExports: {
    isUpgradeWindowOpen: async (vrId: string) => {
      ctrl.windowChecked.push(vrId);
      return ctrl.window;
    },
  },
});
mock.module("@/lib/services/deal/service-fee.service", {
  namedExports: {
    createFeePaymentIntent: async () => {
      ctrl.intentCalls += 1;
      return { status: "ready", clientSecret: "cs_1", paymentIntentId: "pi_1", netFeeCents: 40000 };
    },
  },
});

interface RouteResult { ok: boolean; code?: string; details?: { reason?: string } }

async function post(): Promise<RouteResult> {
  const { POST } = await import("@/app/api/buyer/deals/[dealId]/fee/create-intent/route");
  const req = new NextRequest("https://autolenis.com/api/buyer/deals/deal_1/fee/create-intent", {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  return (await POST(req, { params: Promise.resolve({ dealId: "deal_1" }) })) as unknown as RouteResult;
}

beforeEach(() => {
  ctrl = {
    deal: { id: "deal_1", buyerId: "buyer_1", vehicleRequestId: "vr_1", feePaidAt: null },
    window: { open: true },
    windowChecked: [],
    intentCalls: 0,
  };
});

test("an open window mints the intent", async () => {
  const res = await post();
  assert.equal(res.ok, true);
  assert.deepEqual(ctrl.windowChecked, ["vr_1"]);
  assert.equal(ctrl.intentCalls, 1);
});

test("THE DEFECT: no settled $99 means no intent — the window never opened", async () => {
  ctrl.window = { open: false, reason: "deposit_not_settled", detail: "the window opens when the $99 settles" };
  const res = await post();

  assert.equal(res.ok, false);
  assert.equal(res.code, "UPGRADE_WINDOW_CLOSED");
  assert.equal(res.details?.reason, "deposit_not_settled");
  assert.equal(ctrl.intentCalls, 0, "no PaymentIntent may exist for a window that never opened");
});

test("an already-settled balance is refused rather than charged twice", async () => {
  ctrl.window = { open: false, reason: "already_premium", detail: "the balance has settled" };
  const res = await post();
  assert.equal(res.code, "UPGRADE_WINDOW_CLOSED");
  assert.equal(ctrl.intentCalls, 0);
});

// PAY-59a. Inert until Phase 8 writes `deals.funding_cleared_at`, and pinned now so the
// behaviour is proven rather than newly written when it lands.
test("funding cleared is refused, and the reason travels for the UI", async () => {
  ctrl.window = { open: false, reason: "funding_cleared", detail: "funding has cleared" };
  const res = await post();
  assert.equal(res.details?.reason, "funding_cleared");
  assert.equal(ctrl.intentCalls, 0);
});

test("the recorded fee still short-circuits first — a paid buyer never reaches the window", async () => {
  ctrl.deal = { id: "deal_1", buyerId: "buyer_1", vehicleRequestId: "vr_1", feePaidAt: new Date() };
  const res = await post();
  assert.equal(res.code, "ALREADY_PAID");
  assert.deepEqual(ctrl.windowChecked, [], "and the window is not consulted for a question already answered");
});

test("a deal from before the request link is let through, not refused", async () => {
  ctrl.deal = { id: "deal_1", buyerId: "buyer_1", vehicleRequestId: null, feePaidAt: null };
  const res = await post();
  assert.equal(res.ok, true, "the buyer had no part in that data shape, and the charge guards still apply");
  assert.deepEqual(ctrl.windowChecked, []);
});

test("a deal that is not this buyer's is 404 before anything else", async () => {
  ctrl.deal = null;
  const res = await post();
  assert.equal(res.code, "NOT_FOUND");
  assert.equal(ctrl.intentCalls, 0);
});
