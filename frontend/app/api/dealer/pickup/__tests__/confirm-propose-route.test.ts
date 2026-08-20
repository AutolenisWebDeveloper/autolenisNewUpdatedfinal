// Route contract tests for the dealer round-trip endpoints:
//   POST /api/dealer/pickup/[dealId]/confirm   → confirmPickup
//   POST /api/dealer/pickup/[dealId]/propose   → counterAsDealer
// Pins dealer portal-session auth, delegation to the CAS-guarded service, and
// code→HTTP mapping (foreign deal → 404 via NOT_FOUND, cap → 409).
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/dealer/pickup/__tests__/confirm-propose-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

let authedDealer: { id: string } | null = { id: "dealer_1" };
let confirmResult: unknown = { ok: true, pickup: { id: "pickup_1", status: "SCHEDULED" } };
let counterResult: unknown = { ok: true, pickup: { id: "pickup_1", status: "DEALER_COUNTERED" } };
let confirmCalls: Array<{ dealId: string; dealerId: string; proposedAt: Date }> = [];
let counterCalls: Array<{ dealId: string; dealerId: string; when: Date; proposedAt: Date }> = [];

mock.module("@/lib/auth/dealer-api", {
  namedExports: {
    getRequestDealer: async () => authedDealer,
    successResponse: (data: unknown, status = 200) => NextResponse.json({ success: true, data }, { status }),
    errorResponse: (code: string, message: string, status = 400) =>
      NextResponse.json({ error: { code, message } }, { status }),
  },
});

mock.module("@/lib/services/pickup/pickup-coordination.service", {
  namedExports: {
    confirmPickup: async (dealId: string, dealerId: string, proposedAt: Date) => {
      confirmCalls.push({ dealId, dealerId, proposedAt });
      return confirmResult;
    },
    counterAsDealer: async (dealId: string, dealerId: string, when: Date, proposedAt: Date) => {
      counterCalls.push({ dealId, dealerId, when, proposedAt });
      return counterResult;
    },
    coordHttp: (code: string) => {
      switch (code) {
        case "NOT_FOUND": return { errorCode: "NOT_FOUND", status: 404 };
        case "CONFLICT": return { errorCode: "CONFLICT", status: 409 };
        case "CAP": return { errorCode: "COUNTER_CAP", status: 409 };
        case "AVAILABILITY": return { errorCode: "VALIDATION_ERROR", status: 400 };
        default: return { errorCode: "ERROR", status: 400 };
      }
    },
  },
});

function req(url: string, body: unknown) {
  return new NextRequest(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
const params = { params: Promise.resolve({ dealId: "deal_1" }) };
const PROPOSED_AT = "2026-02-10T18:00:00Z";

beforeEach(() => {
  authedDealer = { id: "dealer_1" };
  confirmResult = { ok: true, pickup: { id: "pickup_1", status: "SCHEDULED" } };
  counterResult = { ok: true, pickup: { id: "pickup_1", status: "DEALER_COUNTERED" } };
  confirmCalls = [];
  counterCalls = [];
});

test("confirm: unauthenticated dealer → 401, no service call", async () => {
  authedDealer = null;
  const { POST } = await import("@/app/api/dealer/pickup/[dealId]/confirm/route");
  const res = await POST(req("http://localhost/api/dealer/pickup/deal_1/confirm", { proposedAt: PROPOSED_AT }), params);
  assert.equal(res.status, 401);
  assert.equal(confirmCalls.length, 0);
});

test("confirm: valid → delegates to confirmPickup with dealer id + token, 200", async () => {
  const { POST } = await import("@/app/api/dealer/pickup/[dealId]/confirm/route");
  const res = await POST(req("http://localhost/api/dealer/pickup/deal_1/confirm", { proposedAt: PROPOSED_AT }), params);
  assert.equal(res.status, 200);
  assert.equal(confirmCalls.length, 1);
  assert.equal(confirmCalls[0]!.dealerId, "dealer_1");
  assert.equal(+confirmCalls[0]!.proposedAt, +new Date(PROPOSED_AT));
});

test("confirm: a foreign deal (isolation → NOT_FOUND) maps to 404", async () => {
  confirmResult = { ok: false, code: "NOT_FOUND", reason: "Pickup not found." };
  const { POST } = await import("@/app/api/dealer/pickup/[dealId]/confirm/route");
  const res = await POST(req("http://localhost/api/dealer/pickup/deal_1/confirm", { proposedAt: PROPOSED_AT }), params);
  assert.equal(res.status, 404);
});

test("propose: valid → delegates to counterAsDealer with the alt time + token, 200", async () => {
  const { POST } = await import("@/app/api/dealer/pickup/[dealId]/propose/route");
  const res = await POST(
    req("http://localhost/api/dealer/pickup/deal_1/propose", { scheduledAt: "2026-02-17T18:00:00Z", proposedAt: PROPOSED_AT }),
    params,
  );
  assert.equal(res.status, 200);
  assert.equal(counterCalls.length, 1);
  assert.equal(+counterCalls[0]!.when, +new Date("2026-02-17T18:00:00Z"));
});

test("propose: counter cap (CAP) maps to 409", async () => {
  counterResult = { ok: false, code: "CAP", reason: "You've reached the maximum number of counter-proposals." };
  const { POST } = await import("@/app/api/dealer/pickup/[dealId]/propose/route");
  const res = await POST(
    req("http://localhost/api/dealer/pickup/deal_1/propose", { scheduledAt: "2026-02-17T18:00:00Z", proposedAt: PROPOSED_AT }),
    params,
  );
  assert.equal(res.status, 409);
  const body = JSON.parse((await res.text()).trim());
  assert.equal(body.error.code, "COUNTER_CAP");
});
