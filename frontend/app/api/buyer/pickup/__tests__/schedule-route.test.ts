// Route contract tests for POST /api/buyer/pickup/[dealId] — buyer self-scheduling.
//
// Lives here (not under the [dealId] segment) because node:test treats "[" as a
// glob metacharacter. The route is imported via the @/ alias, which tsx resolves
// from tsconfig paths without shell globbing.
//
// G3 pins: a valid buyer-chosen slot schedules the pickup AND drives the guarded
// SIGNED → PICKUP_SCHEDULED transition with NO admin action anywhere in the path;
// an out-of-availability slot is rejected before anything is written; and the
// eSign prerequisite still holds.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/buyer/pickup/__tests__/schedule-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";
import { resolveDealerAvailability, isWithinAvailability } from "@/lib/services/pickup/availability.service";

// ── Controllable state + spies ───────────────────────────────────────────────
let dealStatus = "SIGNED";
let esignStatus: string | null = "COMPLETED";
let scheduleCalls = 0;
let advanceCalls: Array<{ to: string; force: boolean | undefined }> = [];

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
          status: dealStatus,
          eSignEnvelope: esignStatus ? { status: esignStatus } : null,
          offer: { dealerId: "dealer_1" },
        }),
      },
      notification: {
        create: async () => ({}),
      },
    },
  },
});

mock.module("@/lib/services/pickup/scheduling.service", {
  namedExports: {
    scheduleVehiclePickup: async () => {
      scheduleCalls += 1;
      return { id: "pickup_1", status: "SCHEDULED" };
    },
    reschedulePickup: async () => undefined,
  },
});

mock.module("@/lib/services/deal/deal.service", {
  namedExports: {
    advanceDealStatus: async (_dealId: string, to: string, opts?: { force?: boolean }) => {
      advanceCalls.push({ to, force: opts?.force });
    },
  },
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

// A guaranteed-valid and guaranteed-invalid instant relative to the real "now"
// used by the route, computed via the same pure validator the route uses.
function nextValidSlotISO(): string {
  const a = resolveDealerAvailability(null);
  const now = new Date();
  for (let h = Math.ceil(a.minLeadTimeHours) + 1; h < 24 * 40; h++) {
    const cand = new Date(now.getTime() + h * 3600_000);
    if (isWithinAvailability(a, cand, now).ok) return cand.toISOString();
  }
  throw new Error("no valid slot found");
}

beforeEach(() => {
  dealStatus = "SIGNED";
  esignStatus = "COMPLETED";
  scheduleCalls = 0;
  advanceCalls = [];
});

test("valid buyer slot schedules the pickup AND advances SIGNED → PICKUP_SCHEDULED (no admin)", async () => {
  const POST = await loadPOST();
  const res = await POST(post({ scheduledAt: nextValidSlotISO(), location: "123 Dealer Drive, Dallas TX" }), {
    params: Promise.resolve({ dealId: "deal_1" }),
  });

  assert.equal(res.status, 200);
  assert.equal(scheduleCalls, 1, "pickup scheduled once");
  assert.equal(advanceCalls.length, 1, "deal advanced once");
  assert.equal(advanceCalls[0]!.to, "PICKUP_SCHEDULED");
  assert.notEqual(advanceCalls[0]!.force, true, "buyer path uses the guarded (non-forced) seam");
});

test("an out-of-availability slot is rejected before anything is written", async () => {
  const POST = await loadPOST();
  // 1 hour from now — inside the 24h lead time → invalid.
  const tooSoon = new Date(Date.now() + 3600_000).toISOString();
  const res = await POST(post({ scheduledAt: tooSoon, location: "123 Dealer Drive, Dallas TX" }), {
    params: Promise.resolve({ dealId: "deal_1" }),
  });

  assert.equal(res.status, 400);
  const body = JSON.parse((await res.text()).trim());
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.equal(scheduleCalls, 0, "nothing scheduled on invalid slot");
  assert.equal(advanceCalls.length, 0, "no transition on invalid slot");
});

test("scheduling is blocked until documents are signed (eSign prerequisite)", async () => {
  esignStatus = "SENT"; // not COMPLETED
  const POST = await loadPOST();
  const res = await POST(post({ scheduledAt: nextValidSlotISO(), location: "123 Dealer Drive, Dallas TX" }), {
    params: Promise.resolve({ dealId: "deal_1" }),
  });

  assert.equal(res.status, 400);
  const body = JSON.parse((await res.text()).trim());
  assert.equal(body.error.code, "PREREQUISITE_NOT_MET");
  assert.equal(scheduleCalls, 0);
  assert.equal(advanceCalls.length, 0);
});

test("re-scheduling a deal already past SIGNED does not attempt an illegal transition", async () => {
  dealStatus = "PICKUP_SCHEDULED"; // already advanced
  const POST = await loadPOST();
  const res = await POST(post({ scheduledAt: nextValidSlotISO(), location: "123 Dealer Drive, Dallas TX" }), {
    params: Promise.resolve({ dealId: "deal_1" }),
  });

  assert.equal(res.status, 200);
  assert.equal(scheduleCalls, 1, "pickup still (re)scheduled");
  assert.equal(advanceCalls.length, 0, "no transition attempted when not in SIGNED");
});
