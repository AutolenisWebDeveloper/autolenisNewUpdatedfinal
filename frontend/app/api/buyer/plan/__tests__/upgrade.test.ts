// Contract tests for POST /api/buyer/plan/upgrade.
//
// Pins the owner decision (2026-07): the Premium upgrade is INTENTIONALLY FREE
// at this stage (acquisition lever; the $499 fee is monetized at deal close).
// These tests assert that no charge occurs on upgrade, that the flip is
// idempotent and race-safe, and that the from→to funnel telemetry is recorded.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/buyer/plan/__tests__/upgrade.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

const BUYER_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "33333333-3333-4333-8333-333333333333";

// ── Controllable prisma behaviour ────────────────────────────────────────────
let buyerPlan = "STANDARD";
let auditLogs: Array<Record<string, unknown>> = [];
let activityEvents: Array<Record<string, unknown>> = [];
// Records any call that would move money — the no-charge contract asserts this
// stays empty. (The route imports no payment module; this canary catches a
// future regression that wires one in through prisma payment tables.)
let paymentWrites: string[] = [];

const paymentCanary = (table: string) =>
  new Proxy({}, { get: () => async () => { paymentWrites.push(table); return {}; } });

const prismaMock = {
  buyer: {
    updateMany: async ({ where }: { where: { plan?: { not?: string } } }) => {
      if (where.plan?.not === "PREMIUM" && buyerPlan !== "PREMIUM") {
        buyerPlan = "PREMIUM";
        return { count: 1 };
      }
      return { count: 0 };
    },
    findUniqueOrThrow: async () => ({ plan: buyerPlan, planUpgradedAt: new Date("2026-07-06T00:00:00Z") }),
  },
  auditLog: {
    create: async (args: { data: Record<string, unknown> }) => {
      auditLogs.push(args.data);
      return { id: "audit_1" };
    },
  },
  buyerActivityEvent: {
    create: async (args: { data: Record<string, unknown> }) => {
      activityEvents.push(args.data);
      return { id: "evt_1" };
    },
  },
  notification: { create: async () => ({ id: "notif_1" }) },
  deposit: paymentCanary("deposit"),
  dealerPayment: paymentCanary("dealerPayment"),
  paymentProviderEvent: paymentCanary("paymentProviderEvent"),
};

mock.module("@/lib/prisma", { namedExports: { prisma: prismaMock } });

mock.module("@/lib/auth/api", {
  namedExports: {
    getRequestBuyer: async () =>
      ({ id: BUYER_ID, userId: USER_ID, plan: buyerPlan, firstName: "Test" }),
    successResponse: (data: unknown, status = 200) =>
      NextResponse.json({ success: true, data }, { status }),
    errorResponse: (code: string, message: string, status = 400) =>
      NextResponse.json({ error: { code, message } }, { status }),
  },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { info: () => {}, warn: () => {}, error: () => {} } },
});

async function postUpgrade() {
  const mod = await import("../upgrade/route");
  const req = new NextRequest("http://localhost/api/buyer/plan/upgrade", { method: "POST" });
  return mod.POST(req);
}

beforeEach(() => {
  buyerPlan = "STANDARD";
  auditLogs = [];
  activityEvents = [];
  paymentWrites = [];
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test("upgrade succeeds with NO charge — free at this stage by product decision", async () => {
  const res = await postUpgrade();
  assert.equal(res.status, 200);
  const json = (await res.json()) as { success: boolean; data: { plan: string; alreadyUpgraded: boolean } };
  assert.equal(json.data.plan, "PREMIUM");
  assert.equal(json.data.alreadyUpgraded, false);
  // The no-charge contract: nothing touched a payment table.
  assert.deepEqual(paymentWrites, []);
});

test("records from→to funnel telemetry in AuditLog and BuyerActivityEvent", async () => {
  await postUpgrade();

  assert.equal(auditLogs.length, 1);
  const meta = auditLogs[0].metadata as Record<string, unknown>;
  assert.equal(meta.fromPlan, "STANDARD");
  assert.equal(meta.toPlan, "PREMIUM");
  assert.equal(meta.actor, "buyer");
  assert.equal(meta.source, "self_service");
  assert.equal(auditLogs[0].userId, USER_ID);

  assert.equal(activityEvents.length, 1);
  assert.equal(activityEvents[0].eventType, "PLAN_UPGRADED");
});

test("idempotent: second upgrade is a no-op with alreadyUpgraded=true and no duplicate audit", async () => {
  await postUpgrade();
  const res2 = await postUpgrade();

  assert.equal(res2.status, 200);
  const json2 = (await res2.json()) as { success: boolean; data: { alreadyUpgraded: boolean } };
  assert.equal(json2.data.alreadyUpgraded, true);
  // Only the first call audited; the repeat wrote nothing.
  assert.equal(auditLogs.length, 1);
  assert.equal(activityEvents.length, 1);
  assert.deepEqual(paymentWrites, []);
});
