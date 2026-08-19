// Route contract tests for PATCH /api/buyer/pickup/[dealId] — buyer reschedule.
//
// Pins the fix for the live bypass: the PATCH handler no longer writes
// prisma.pickup.update inline. It routes through the gated reschedulePickup
// service and maps a rejection to a 400 — so an out-of-availability reschedule
// cannot be written, and the route never touches pickup.update directly.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/buyer/pickup/__tests__/reschedule-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

let pickupStatus = "SCHEDULED";
let rescheduleResult: unknown = { ok: true, pickup: { id: "pickup_1", status: "RESCHEDULED" } };
let rescheduleCalls: Array<{ dealId: string; newDate: Date; opts: unknown }> = [];
let directUpdateCalls = 0;

mock.module("@/lib/auth/api", {
  namedExports: {
    getRequestBuyer: async () => ({ id: "buyer_1" }),
    successResponse: (data: unknown, status = 200) =>
      NextResponse.json({ success: true, data }, { status }),
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
          pickup: { id: "pickup_1", status: pickupStatus },
        }),
      },
      // If the route ever writes the pickup directly, this spy catches the
      // regression (it must go through the gated service instead).
      pickup: {
        update: async () => {
          directUpdateCalls += 1;
          return { id: "pickup_1" };
        },
      },
      notification: { create: async () => ({}) },
    },
  },
});

mock.module("@/lib/services/pickup/scheduling.service", {
  namedExports: {
    scheduleVehiclePickup: async () => ({ id: "pickup_1" }),
    reschedulePickup: async (dealId: string, newDate: Date, opts: unknown) => {
      rescheduleCalls.push({ dealId, newDate, opts });
      return rescheduleResult;
    },
  },
});

mock.module("@/lib/services/deal/deal.service", {
  namedExports: { advanceDealStatus: async () => undefined },
});

async function loadPATCH() {
  const mod = await import("@/app/api/buyer/pickup/[dealId]/route");
  return mod.PATCH;
}

function patch(body: unknown) {
  return new NextRequest("http://localhost/api/buyer/pickup/deal_1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = { scheduledAt: "2026-01-14T20:00:00Z", location: "123 Dealer Drive, Dallas TX" };

beforeEach(() => {
  pickupStatus = "SCHEDULED";
  rescheduleResult = { ok: true, pickup: { id: "pickup_1", status: "RESCHEDULED" } };
  rescheduleCalls = [];
  directUpdateCalls = 0;
});

test("an out-of-availability reschedule is rejected (gate result → 400) with NO direct write", async () => {
  rescheduleResult = { ok: false, reason: "Please choose a business day the dealership is open for pickups." };
  const PATCH = await loadPATCH();
  const res = await PATCH(patch(VALID_BODY), { params: Promise.resolve({ dealId: "deal_1" }) });

  assert.equal(res.status, 400);
  const body = JSON.parse((await res.text()).trim());
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.equal(rescheduleCalls.length, 1, "delegated to the gated service");
  assert.equal(directUpdateCalls, 0, "route must NOT write pickup.update directly");
});

test("a valid reschedule returns 200 and the gated service's pickup", async () => {
  const PATCH = await loadPATCH();
  const res = await PATCH(patch(VALID_BODY), { params: Promise.resolve({ dealId: "deal_1" }) });

  assert.equal(res.status, 200);
  assert.equal(rescheduleCalls.length, 1);
  assert.equal(directUpdateCalls, 0, "no inline write — the service owns the write");
});

test("a buyer-supplied override in the PATCH body is ignored (never forwarded to the service)", async () => {
  const PATCH = await loadPATCH();
  const res = await PATCH(patch({ ...VALID_BODY, override: true, overrideReason: "let me in" }), {
    params: Promise.resolve({ dealId: "deal_1" }),
  });
  assert.equal(res.status, 200);
  assert.equal(rescheduleCalls.length, 1);
  const opts = rescheduleCalls[0]!.opts as Record<string, unknown>;
  assert.equal("override" in opts, false, "route must never forward a client override to the gate");
});

test("a completed pickup cannot be rescheduled (short-circuits before the service)", async () => {
  pickupStatus = "COMPLETED";
  const PATCH = await loadPATCH();
  const res = await PATCH(patch(VALID_BODY), { params: Promise.resolve({ dealId: "deal_1" }) });

  assert.equal(res.status, 400);
  const body = JSON.parse((await res.text()).trim());
  assert.equal(body.error.code, "ALREADY_COMPLETED");
  assert.equal(rescheduleCalls.length, 0, "no reschedule attempted on a completed pickup");
});
