// Route contract tests for the buyer round-trip endpoints:
//   POST /api/buyer/pickup/[dealId]/accept   → acceptCounter
//   POST /api/buyer/pickup/[dealId]/counter  → counterAsBuyer
// Pins buyer-session auth, delegation to the gated service, and code→HTTP mapping.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/buyer/pickup/__tests__/accept-counter-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

let authedBuyer: { id: string } | null = { id: "buyer_1" };
let acceptResult: unknown = { ok: true, pickup: { id: "pickup_1", status: "SCHEDULED" } };
let counterResult: unknown = { ok: true, pickup: { id: "pickup_1", status: "PROPOSED" } };
let acceptCalls: Array<{ dealId: string; buyerId: string; proposedAt: Date }> = [];
let counterCalls: Array<{ dealId: string; buyerId: string; when: Date; proposedAt: Date }> = [];

mock.module("@/lib/auth/api", {
  namedExports: {
    getRequestBuyer: async () => authedBuyer,
    successResponse: (data: unknown, status = 200) => NextResponse.json({ success: true, data }, { status }),
    errorResponse: (code: string, message: string, status = 400) =>
      NextResponse.json({ error: { code, message } }, { status }),
  },
});

mock.module("@/lib/services/pickup/pickup-coordination.service", {
  namedExports: {
    acceptCounter: async (dealId: string, buyerId: string, proposedAt: Date) => {
      acceptCalls.push({ dealId, buyerId, proposedAt });
      return acceptResult;
    },
    counterAsBuyer: async (dealId: string, buyerId: string, when: Date, proposedAt: Date) => {
      counterCalls.push({ dealId, buyerId, when, proposedAt });
      return counterResult;
    },
    coordHttp: (code: string) => {
      switch (code) {
        case "CONFLICT": return { errorCode: "CONFLICT", status: 409 };
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
  authedBuyer = { id: "buyer_1" };
  acceptResult = { ok: true, pickup: { id: "pickup_1", status: "SCHEDULED" } };
  counterResult = { ok: true, pickup: { id: "pickup_1", status: "PROPOSED" } };
  acceptCalls = [];
  counterCalls = [];
});

test("accept: unauthenticated → 401, no service call", async () => {
  authedBuyer = null;
  const { POST } = await import("@/app/api/buyer/pickup/[dealId]/accept/route");
  const res = await POST(req("http://localhost/api/buyer/pickup/deal_1/accept", { proposedAt: PROPOSED_AT }), params);
  assert.equal(res.status, 401);
  assert.equal(acceptCalls.length, 0);
});

test("accept: valid → delegates to acceptCounter and returns 200", async () => {
  const { POST } = await import("@/app/api/buyer/pickup/[dealId]/accept/route");
  const res = await POST(req("http://localhost/api/buyer/pickup/deal_1/accept", { proposedAt: PROPOSED_AT }), params);
  assert.equal(res.status, 200);
  assert.equal(acceptCalls.length, 1);
  assert.equal(acceptCalls[0]!.buyerId, "buyer_1");
  assert.equal(+acceptCalls[0]!.proposedAt, +new Date(PROPOSED_AT));
});

test("accept: a lost race (CONFLICT) maps to 409", async () => {
  acceptResult = { ok: false, code: "CONFLICT", reason: "This pickup was just updated." };
  const { POST } = await import("@/app/api/buyer/pickup/[dealId]/accept/route");
  const res = await POST(req("http://localhost/api/buyer/pickup/deal_1/accept", { proposedAt: PROPOSED_AT }), params);
  assert.equal(res.status, 409);
  const body = JSON.parse((await res.text()).trim());
  assert.equal(body.error.code, "CONFLICT");
});

test("counter: valid → delegates to counterAsBuyer with the new time + token", async () => {
  const { POST } = await import("@/app/api/buyer/pickup/[dealId]/counter/route");
  const res = await POST(
    req("http://localhost/api/buyer/pickup/deal_1/counter", { scheduledAt: "2026-02-16T18:00:00Z", proposedAt: PROPOSED_AT }),
    params,
  );
  assert.equal(res.status, 200);
  assert.equal(counterCalls.length, 1);
  assert.equal(+counterCalls[0]!.when, +new Date("2026-02-16T18:00:00Z"));
  assert.equal(+counterCalls[0]!.proposedAt, +new Date(PROPOSED_AT));
});

test("counter: an out-of-availability time (AVAILABILITY) maps to 400", async () => {
  counterResult = { ok: false, code: "AVAILABILITY", reason: "Please choose a time during business hours." };
  const { POST } = await import("@/app/api/buyer/pickup/[dealId]/counter/route");
  const res = await POST(
    req("http://localhost/api/buyer/pickup/deal_1/counter", { scheduledAt: "2026-02-16T02:00:00Z", proposedAt: PROPOSED_AT }),
    params,
  );
  assert.equal(res.status, 400);
});
