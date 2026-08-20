// Route contract tests for POST /api/admin/deals/[dealId]/pickup/schedule.
//
// D1: the admin path also respects the dealer's real availability — but, unlike
// the buyer path, an admin may deliberately place an off-hours pickup via an
// explicit override. That override is fail-closed (requires a reason) and
// AUDITED (recorded in the audit log), never silent.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/admin/deals/__tests__/pickup-schedule-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";
// availability.service is imported DYNAMICALLY (in the slot helper) so it loads
// after the prisma mock below — a static import would bind the route's resolver
// to a real DB.

let scheduleCalls = 0;
let auditLogs: Array<Record<string, unknown>> = [];

mock.module("@/lib/auth/admin-api", {
  namedExports: {
    getAdminFromRequest: async () => ({ id: "admin_1", email: "admin@autolenis.com" }),
    adminSuccess: (data: unknown, status = 200) => NextResponse.json({ success: true, data }, { status }),
    adminError: (code: string, message: string, status = 400) =>
      NextResponse.json({ error: { code, message } }, { status }),
    createAuditLog: async (_admin: unknown, _req: unknown, entry: Record<string, unknown>) => {
      auditLogs.push(entry);
    },
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deal: {
        findUnique: async () => ({
          id: "deal_1",
          offer: { dealerId: "dealer_1", dealer: { dealershipName: "Test Motors", user: { email: "dealer@x.com" } }, auction: {} },
          buyer: { firstName: "Sam", city: "Dallas", state: "TX", user: { email: "sam@x.com" } },
        }),
      },
      // No stored availability → resolver derives tz from the dealer ZIP (Central).
      dealerAvailability: { findUnique: async () => null },
      dealer: { findUnique: async () => ({ zip: "75201", state: "TX" }) },
    },
  },
});

mock.module("@/lib/services/pickup/pickup.service", {
  namedExports: {
    schedulePickup: async () => {
      scheduleCalls += 1;
      return { id: "pickup_1", status: "SCHEDULED" };
    },
  },
});

mock.module("@/lib/services/email/resend.service", {
  namedExports: {
    sendPickupReadyEmail: async () => undefined,
    sendDealerPickupScheduledEmail: async () => undefined,
  },
});

async function loadPOST() {
  const mod = await import("@/app/api/admin/deals/[dealId]/pickup/schedule/route");
  return mod.POST;
}

function post(body: unknown) {
  return new NextRequest("http://localhost/api/admin/deals/deal_1/pickup/schedule", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// A valid business-day slot in Central time (matches the mocked TX dealer).
async function nextValidSlotISO(): Promise<string> {
  const { platformDefaultAvailability, isWithinAvailability } = await import(
    "@/lib/services/pickup/availability.service"
  );
  const a = platformDefaultAvailability("America/Chicago");
  const now = new Date();
  for (let h = Math.ceil(a.minLeadTimeHours) + 1; h < 24 * 40; h++) {
    const cand = new Date(now.getTime() + h * 3600_000);
    if (isWithinAvailability(a, cand, now).ok) return cand.toISOString();
  }
  throw new Error("no valid slot found");
}

// The next Sunday (a closed day) at ~noon Central, comfortably past the 24h lead
// time and inside the 30-day advance window → fails availability, not lead time.
function nextSundayNoonISO(): string {
  const now = new Date();
  const d = new Date(now.getTime() + 3 * 86_400_000); // at least 3 days out
  d.setUTCHours(18, 0, 0, 0); // 12:00 Central
  while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1); // roll to Sunday
  return d.toISOString();
}

beforeEach(() => {
  scheduleCalls = 0;
  auditLogs = [];
});

test("an off-availability slot with no override is rejected — nothing scheduled", async () => {
  const POST = await loadPOST();
  const res = await POST(post({ scheduledAt: nextSundayNoonISO(), location: "123 Dealer Dr, Dallas TX" }), {
    params: Promise.resolve({ dealId: "deal_1" }),
  });
  assert.equal(res.status, 400);
  const body = JSON.parse((await res.text()).trim());
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.equal(scheduleCalls, 0);
});

test("an override WITHOUT a reason is rejected (fail-closed)", async () => {
  const POST = await loadPOST();
  const res = await POST(post({ scheduledAt: nextSundayNoonISO(), location: "123 Dealer Dr, Dallas TX", override: true }), {
    params: Promise.resolve({ dealId: "deal_1" }),
  });
  assert.equal(res.status, 400);
  assert.equal(scheduleCalls, 0);
});

test("an override WITH a reason places the off-hours pickup and AUDITS it", async () => {
  const POST = await loadPOST();
  const res = await POST(
    post({
      scheduledAt: nextSundayNoonISO(),
      location: "123 Dealer Dr, Dallas TX",
      override: true,
      overrideReason: "Buyer travels weekdays; GM approved a Sunday handoff",
    }),
    { params: Promise.resolve({ dealId: "deal_1" }) },
  );
  assert.equal(res.status, 200);
  assert.equal(scheduleCalls, 1, "pickup scheduled under override");
  const audit = auditLogs.find((e) => e.action === "PICKUP_SCHEDULED");
  assert.ok(audit, "an audit log is written");
  const meta = audit!.metadata as Record<string, unknown>;
  assert.equal(meta.override, true);
  assert.match(String(meta.overrideReason), /GM approved/);
});

test("a valid in-availability slot schedules normally (no override needed)", async () => {
  const POST = await loadPOST();
  const res = await POST(post({ scheduledAt: await nextValidSlotISO(), location: "123 Dealer Dr, Dallas TX" }), {
    params: Promise.resolve({ dealId: "deal_1" }),
  });
  assert.equal(res.status, 200);
  assert.equal(scheduleCalls, 1);
  const audit = auditLogs.find((e) => e.action === "PICKUP_SCHEDULED");
  assert.equal((audit!.metadata as Record<string, unknown>).override, false);
});
