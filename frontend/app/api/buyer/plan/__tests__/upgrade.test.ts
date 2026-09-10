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
let planSnapshots: Array<Record<string, unknown>> = [];

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
  // §23.1 — the request-bound election, and the pointer that binds it. The composite
  // foreign key on `vehicle_requests.current_plan_snapshot_id` means a request can only
  // point at a snapshot bound to that request; these are the writes that make it true.
  vehicleRequest: { updateMany: async () => ({ count: 1 }) },
  deal: { updateMany: async () => ({ count: 0 }) },
  // Phase 2 — the election is now also recorded as a `plan_snapshots` row.
  // `Buyer.plan` answers "what plan now" and destroys "what plan when"; §23's
  // upgrade window and post-settlement downgrade review are adjudicated from the
  // history, not the flag. The flag write above is unchanged, which is what the
  // no-charge assertions below still pin.
  planSnapshot: {
    // Scoped, because the two writers ask DIFFERENT questions: the buyer-level one
    // dedupes against the buyer's latest plan, the request-level one against this
    // request's. A fake that answered both from one list would make the request-bound
    // election look like a duplicate of the buyer-level default and silently drop it.
    findFirst: async ({ where }: { where?: { vehicleRequestId?: string } } = {}) => {
      const scoped = where?.vehicleRequestId
        ? planSnapshots.filter((s) => s.vehicleRequestId === where.vehicleRequestId)
        : planSnapshots;
      return scoped[scoped.length - 1] ?? null;
    },
    create: async (args: { data: Record<string, unknown> }) => {
      planSnapshots.push(args.data);
      return args.data;
    },
  },
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

// PHASE 3 — the election now also binds to the buyer's open request (§23.1) and the
// response carries the window and the balance so a client cannot render "you are
// Premium" from a free flag flip. The rules themselves are pinned in
// `lib/services/plan/__tests__/upgrade-window.test.ts`; here they are recorded so this
// file stays about the route's own contract.
mock.module("@/lib/services/vehicle-request/open-request.service", {
  namedExports: { findOpenRequest: async () => ({ id: "vr_1" }) },
});
mock.module("@/lib/services/plan/upgrade-window.service", {
  namedExports: {
    isUpgradeWindowOpen: async () => ({ open: true }),
    quotePremiumBalance: async () => ({
      grossCents: 49900, creditCents: 9900, dueCents: 40000,
      creditBasis: "settled_deposit", explanation: "test quote",
    }),
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
  planSnapshots = [];
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

// ── PHASE 3 — §23.1 / PAY-57 ────────────────────────────────────────────────

test("the election binds to the buyer's open request, not only to the buyer", async () => {
  await postUpgrade();

  // Two snapshots: the buyer-level DEFAULT (§23.1 "the buyer record carries the current
  // default") and the request-bound election ("the Vehicle Request and the Deal carry
  // the binding snapshot"). The buyer-level writer would not have written the second
  // even given the request id — it dedupes on the buyer's latest plan, and the first row
  // already made them PREMIUM. That dedupe is right at buyer level and wrong here.
  const bound = planSnapshots.filter((s) => s.vehicleRequestId === "vr_1");
  assert.equal(bound.length, 1, "the election is recorded for the transaction, not just the person");
  assert.equal(bound[0]!.plan, "PREMIUM");
  assert.equal(bound[0]!.touchpoint, "buyer_dashboard_upgrade");
});

test("the response says the election is NOT an entitlement", async () => {
  const body = (await (await postUpgrade()).json()) as {
    data: { entitled: boolean; balance: { dueCents: number } | null; upgradeWindow: { open: boolean } | null };
  };
  const res = body;

  assert.equal(
    res.data.entitled,
    false,
    "electing is free by owner decision; being entitled is not. A client must not render " +
      "\"you are Premium\" from a flag flip (§23.1, PAY-57).",
  );
  assert.equal(res.data.balance?.dueCents, 40000, "and it says what is still owed");
  assert.equal(res.data.upgradeWindow?.open, true);
});
