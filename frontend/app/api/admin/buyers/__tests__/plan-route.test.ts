// Route tests for POST /api/admin/buyers/[buyerId]/plan — §23.1 / §23.3.
//
// This route writes a money-adjacent flag and then does follow-up work that can fail
// independently of it. Three properties are pinned here, all three found missing by the
// second independent review:
//
//   1. `conciergeAdminId` is validated BEFORE anything is written. It is a client-supplied
//      string that lands in `vehicle_requests.assigned_admin_id`, FK'd to `admins`; a typo
//      used to raise P2003 AFTER the plan flag had committed, leaving the buyer changed
//      with no audit row and no way to retry — the next attempt answers NO_CHANGE.
//   2. The audit row is written IMMEDIATELY after the flag, not after the services. It is
//      the record that an admin made this decision and must not be contingent on the work
//      that follows succeeding.
//   3. The response carries the OUTCOME: `downgrade.kind` and `planServiceError`. The admin
//      command center renders both (`describePlanChange`), so a REFUND_REVIEW_RAISED is
//      never reported to an admin as a plain success — §22.1 refunds are a manual review
//      and NO money has moved at that point.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//   "app/api/admin/buyers/__tests__/plan-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

type Downgrade =
  | { kind: "ELECTION_ONLY"; conciergeReleased: boolean; snapshotId: string | null }
  | { kind: "REFUND_REVIEW_RAISED"; settledPremiumCents: number; snapshotId: string | null };

interface Ctrl {
  admin: { adminId: string; email: string; role: string } | null;
  buyer: Record<string, unknown> | null;
  conciergeAdmin: { id: string } | null;
  openRequest: { id: string } | null;
  body: Record<string, unknown>;
  downgradeResult: Downgrade;
  downgradeThrows: Error | null;
  electionThrows: Error | null;
  /** Every write, in order — this is how the audit-before-services ordering is asserted. */
  calls: string[];
  audits: Array<Record<string, unknown>>;
  updates: Array<Record<string, unknown>>;
  concierges: Array<Record<string, unknown>>;
}
let ctrl: Ctrl;

mock.module("@/lib/auth/admin-api", {
  namedExports: {
    getAdminFromRequest: async () => ctrl.admin,
    adminError: (code: string, message: string, status: number) => ({ __kind: "error", code, message, status }),
    adminSuccess: (data: unknown) => ({ __kind: "success", data }),
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      buyer: {
        findUnique: async () => ctrl.buyer,
        update: async ({ data }: { data: Record<string, unknown> }) => {
          ctrl.calls.push("buyer.update");
          ctrl.updates.push(data);
          return { id: "b1", plan: data.plan, planUpgradedAt: data.planUpgradedAt ?? null };
        },
      },
      admin: {
        findUnique: async () => { ctrl.calls.push("admin.findUnique"); return ctrl.conciergeAdmin; },
      },
      adminAuditLog: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          ctrl.calls.push("audit.create");
          ctrl.audits.push(data);
          return {};
        },
      },
    },
  },
});

mock.module("@/lib/services/plan/plan-change.service", {
  namedExports: {
    downgradeToStandard: async () => {
      ctrl.calls.push("downgradeToStandard");
      if (ctrl.downgradeThrows) throw ctrl.downgradeThrows;
      return ctrl.downgradeResult;
    },
    assignConcierge: async (input: Record<string, unknown>) => {
      ctrl.calls.push("assignConcierge");
      ctrl.concierges.push(input);
      return { changed: true };
    },
  },
});

mock.module("@/lib/services/buyer/plan-snapshot.service", {
  namedExports: {
    recordRequestPlanElection: async () => {
      ctrl.calls.push("recordRequestPlanElection");
      if (ctrl.electionThrows) throw ctrl.electionThrows;
      return { id: "snap_1" };
    },
  },
});

mock.module("@/lib/services/vehicle-request/open-request.service", {
  namedExports: { findOpenRequest: async () => ctrl.openRequest },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

async function loadPOST() {
  return (await import("@/app/api/admin/buyers/[buyerId]/plan/route")).POST;
}

function req() {
  return {
    json: async () => ctrl.body,
    headers: { get: () => null },
  } as unknown as Parameters<Awaited<ReturnType<typeof loadPOST>>>[0];
}
const params = Promise.resolve({ buyerId: "b1" });

beforeEach(() => {
  ctrl = {
    admin: { adminId: "adm_1", email: "admin@autolenis.com", role: "SUPER_ADMIN" },
    buyer: { id: "b1", plan: "PREMIUM", user: { email: "buyer@example.com" } },
    conciergeAdmin: { id: "adm_9" },
    openRequest: { id: "vr_1" },
    body: { plan: "STANDARD", reason: "buyer asked to move back to Standard" },
    downgradeResult: { kind: "ELECTION_ONLY", conciergeReleased: true, snapshotId: "snap_1" },
    downgradeThrows: null,
    electionThrows: null,
    calls: [],
    audits: [],
    updates: [],
    concierges: [],
  };
});

test("an unknown conciergeAdminId is refused BEFORE anything is written", async () => {
  ctrl.buyer = { ...ctrl.buyer!, plan: "STANDARD" };
  ctrl.body = { plan: "PREMIUM", reason: "upgrading to Premium concierge", conciergeAdminId: "adm_typo" };
  ctrl.conciergeAdmin = null;

  const POST = await loadPOST();
  const res = (await POST(req(), { params })) as unknown as { __kind: string; code: string; status: number };

  assert.equal(res.__kind, "error");
  assert.equal(res.code, "VALIDATION_ERROR");
  assert.equal(res.status, 400);
  assert.ok(!ctrl.calls.includes("buyer.update"), "the plan flag is never written on a bad concierge id");
  assert.equal(ctrl.audits.length, 0);
});

test("a valid conciergeAdminId is checked first, then the upgrade proceeds and assigns", async () => {
  ctrl.buyer = { ...ctrl.buyer!, plan: "STANDARD" };
  ctrl.body = { plan: "PREMIUM", reason: "upgrading to Premium concierge", conciergeAdminId: "adm_9" };

  const POST = await loadPOST();
  const res = (await POST(req(), { params })) as unknown as { __kind: string; data: { planServiceError: string | null } };

  assert.equal(res.__kind, "success");
  assert.equal(ctrl.calls[0], "admin.findUnique", "the FK is validated before the first write");
  assert.equal(ctrl.calls[1], "buyer.update");
  assert.equal(ctrl.calls[2], "audit.create");
  assert.equal(ctrl.concierges[0]?.adminId, "adm_9");
  assert.equal(res.data.planServiceError, null);
});

test("the audit row is written BEFORE the plan services run", async () => {
  const POST = await loadPOST();
  await POST(req(), { params });

  const auditAt = ctrl.calls.indexOf("audit.create");
  const serviceAt = ctrl.calls.indexOf("downgradeToStandard");
  assert.ok(auditAt >= 0 && serviceAt >= 0, "both ran");
  assert.ok(auditAt < serviceAt, "an admin decision is recorded before the work that can fail");
  assert.equal(ctrl.audits[0]!.action, "BUYER_PLAN_CHANGED");
  assert.deepEqual(ctrl.audits[0]!.previousState, { plan: "PREMIUM" });
  assert.deepEqual(ctrl.audits[0]!.newState, { plan: "STANDARD" });
});

test("REFUND_REVIEW_RAISED reaches the caller — the admin UI must not report a plain success", async () => {
  ctrl.downgradeResult = { kind: "REFUND_REVIEW_RAISED", settledPremiumCents: 40000, snapshotId: "snap_1" };

  const POST = await loadPOST();
  const res = (await POST(req(), { params })) as unknown as {
    data: { downgrade: { kind: string; settledPremiumCents: number }; planServiceError: string | null };
  };

  assert.equal(res.data.downgrade.kind, "REFUND_REVIEW_RAISED");
  assert.equal(res.data.downgrade.settledPremiumCents, 40000, "the settled amount is what the toast quotes");
  assert.equal(res.data.planServiceError, null);
});

test("a failing plan service is REPORTED, not thrown — the flag and audit row still stand", async () => {
  ctrl.downgradeThrows = new Error("snapshot write failed");

  const POST = await loadPOST();
  const res = (await POST(req(), { params })) as unknown as {
    __kind: string;
    data: { buyer: { plan: string }; downgrade: unknown; planServiceError: string | null };
  };

  assert.equal(res.__kind, "success", "the flag committed; failing the whole call would misreport it");
  assert.equal(res.data.buyer.plan, "STANDARD");
  assert.equal(res.data.downgrade, null);
  assert.equal(res.data.planServiceError, "snapshot write failed", "the admin is told the follow-up did not land");
  assert.equal(ctrl.audits.length, 1, "the audit row survives the service failure");
});

test("a buyer with no open request still gets the flag and the audit row", async () => {
  ctrl.openRequest = null;

  const POST = await loadPOST();
  const res = (await POST(req(), { params })) as unknown as { __kind: string; data: { downgrade: unknown; planServiceError: string | null } };

  assert.equal(res.__kind, "success");
  assert.equal(ctrl.audits.length, 1);
  assert.equal(res.data.downgrade, null, "there is no request to bind an election to");
  assert.equal(res.data.planServiceError, null, "and that is not an error");
  assert.ok(!ctrl.calls.includes("downgradeToStandard"));
});

test("a non-privileged admin role is refused", async () => {
  ctrl.admin = { adminId: "adm_2", email: "ops@autolenis.com", role: "OPS_ADMIN" };

  const POST = await loadPOST();
  const res = (await POST(req(), { params })) as unknown as { code: string; status: number };

  assert.equal(res.code, "FORBIDDEN");
  assert.equal(res.status, 403);
  assert.equal(ctrl.calls.length, 0);
});

test("changing to the plan the buyer already has is refused with no write", async () => {
  ctrl.body = { plan: "PREMIUM", reason: "no actual change here" };

  const POST = await loadPOST();
  const res = (await POST(req(), { params })) as unknown as { code: string; status: number };

  assert.equal(res.code, "NO_CHANGE");
  assert.equal(res.status, 400);
  assert.equal(ctrl.calls.length, 0);
});
