// Route contract tests for POST /api/buyer/pickup/[dealId] — buyer PROPOSES a
// pickup time (D2). Pins: a valid proposal calls proposePickup and does NOT
// advance the deal (the deal advances only on dealer confirm / buyer accept);
// an out-of-availability proposal is rejected; the eSign prerequisite holds; and
// only a SIGNED deal (no pending pickup) may open an initial proposal.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/buyer/pickup/__tests__/schedule-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

let dealStatus = "SIGNED";
let esignStatus: string | null = "COMPLETED";
let proposeResult: unknown = { ok: true, pickup: { id: "pickup_1", status: "PROPOSED" } };
let proposeCalls: Array<{ dealId: string; buyerId: string; when: Date; location: string | null }> = [];

mock.module("@/lib/auth/api", {
  namedExports: {
    getRequestBuyer: async () => ({ id: "buyer_1" }),
    successResponse: (data: unknown, status = 200) => NextResponse.json({ success: true, data }, { status }),
    errorResponse: (code: string, message: string, status = 400) =>
      NextResponse.json({ error: { code, message } }, { status }),
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deal: {
        findFirst: async () => ({
          id: "deal_1",
          buyerId: "buyer_1",
          status: dealStatus,
          eSignEnvelope: esignStatus ? { status: esignStatus } : null,
        }),
      },
    },
  },
});

mock.module("@/lib/services/pickup/pickup-coordination.service", {
  namedExports: {
    proposePickup: async (dealId: string, buyerId: string, when: Date, location: string | null) => {
      proposeCalls.push({ dealId, buyerId, when, location });
      return proposeResult;
    },
    // Real mapping so the route returns the right status for a failure code.
    coordHttp: (code: string) => {
      switch (code) {
        case "NOT_FOUND": return { errorCode: "NOT_FOUND", status: 404 };
        case "AVAILABILITY": return { errorCode: "VALIDATION_ERROR", status: 400 };
        case "STATE": return { errorCode: "INVALID_STATE", status: 409 };
        case "CONFLICT": return { errorCode: "CONFLICT", status: 409 };
        case "CAP": return { errorCode: "COUNTER_CAP", status: 409 };
        default: return { errorCode: "ERROR", status: 400 };
      }
    },
  },
});

// The buyer route's PATCH imports these; provide inert stubs so the module loads.
mock.module("@/lib/services/pickup/scheduling.service", {
  namedExports: { reschedulePickup: async () => ({ ok: true, pickup: {} }) },
});

async function loadPOST() {
  const mod = await import("@/app/api/buyer/pickup/[dealId]/route");
  return mod.POST;
}

function post(body: unknown) {
  return new NextRequest("http://localhost/api/buyer/pickup/deal_1", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = { scheduledAt: "2026-02-14T20:00:00Z", location: "123 Dealer Drive, Dallas TX" };

beforeEach(() => {
  dealStatus = "SIGNED";
  esignStatus = "COMPLETED";
  proposeResult = { ok: true, pickup: { id: "pickup_1", status: "PROPOSED" } };
  proposeCalls = [];
});

test("a valid proposal calls proposePickup and returns 200 — NO deal advance here", async () => {
  const POST = await loadPOST();
  const res = await POST(post(VALID_BODY), { params: Promise.resolve({ dealId: "deal_1" }) });
  assert.equal(res.status, 200);
  assert.equal(proposeCalls.length, 1);
  assert.equal(proposeCalls[0]!.dealId, "deal_1");
  assert.equal(proposeCalls[0]!.buyerId, "buyer_1");
  assert.equal(proposeCalls[0]!.location, "123 Dealer Drive, Dallas TX");
});

test("an out-of-availability proposal is rejected (AVAILABILITY → 400)", async () => {
  proposeResult = { ok: false, code: "AVAILABILITY", reason: "Please choose a time during business hours." };
  const POST = await loadPOST();
  const res = await POST(post(VALID_BODY), { params: Promise.resolve({ dealId: "deal_1" }) });
  assert.equal(res.status, 400);
  const body = JSON.parse((await res.text()).trim());
  assert.equal(body.error.code, "VALIDATION_ERROR");
});

test("proposing is blocked until documents are signed (eSign prerequisite)", async () => {
  esignStatus = "SENT";
  const POST = await loadPOST();
  const res = await POST(post(VALID_BODY), { params: Promise.resolve({ dealId: "deal_1" }) });
  assert.equal(res.status, 400);
  const body = JSON.parse((await res.text()).trim());
  assert.equal(body.error.code, "PREREQUISITE_NOT_MET");
  assert.equal(proposeCalls.length, 0);
});

test("only a SIGNED deal may open an initial proposal (already-scheduled → 409)", async () => {
  dealStatus = "PICKUP_SCHEDULED";
  const POST = await loadPOST();
  const res = await POST(post(VALID_BODY), { params: Promise.resolve({ dealId: "deal_1" }) });
  assert.equal(res.status, 409);
  const body = JSON.parse((await res.text()).trim());
  assert.equal(body.error.code, "INVALID_STATE");
  assert.equal(proposeCalls.length, 0);
});
