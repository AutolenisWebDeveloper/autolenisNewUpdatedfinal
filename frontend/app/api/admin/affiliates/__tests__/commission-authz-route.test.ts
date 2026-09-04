// Authorization contract tests for the affiliate commission money routes:
//   POST /api/admin/affiliates/commissions/[commissionId]/approve
//   POST /api/admin/affiliates/commissions/[commissionId]/reject
//   POST /api/admin/affiliates/commissions/[commissionId]/mark-paid
//
// Lives here (not co-located under the [commissionId] segment) because node:test
// treats "[" as a glob metacharacter, so a path containing the [commissionId]
// segment cannot be passed to the runner. Routes are imported via the @/ alias,
// which tsx resolves from tsconfig paths without shell globbing.
//
// Regression target (admin authz audit, batch 1): these three routes ONCE gated
// only on requirePermission("finance.commissions.settle"), which is SHADOW-ONLY —
// under the default runtime (RBAC_ENFORCE unset) a role outside the permission's
// allow-list is recorded as RBAC_SHADOW_DENY and then ALLOWED. A SUPPORT_ADMIN
// (read-only per policy 1) could therefore approve, reject, and settle real
// affiliate money. Their correctly-scoped siblings — reverse/ and clawback/,
// [affiliateId]/commissions/, and referral-milestones/[id]/pay — all hard-enforce
// SUPER_ADMIN or FINANCE_ADMIN. All three now call requirePermissionStrict(),
// which has no enforcing() branch at all: an out-of-matrix role is audited
// RBAC_DENY and answered 403 FORBIDDEN whatever RBAC_ENFORCE says. These tests
// pin that hard gate: an under-privileged admin gets 403 and the mutation is
// NEVER reached, while FINANCE_ADMIN and SUPER_ADMIN keep working.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/admin/affiliates/__tests__/commission-authz-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";
// Hoisted, so it binds the REAL module: mock.module() below replaces the same
// specifier only for the routes' own (later, dynamic) import.
import { roleAllows, rolesFor, type Permission } from "@/lib/auth/permissions";

// ── Controllable caller role + mutation spies ────────────────────────────────
let callerRole = "FINANCE_ADMIN";
let commissionStatus = "PENDING";
let commissionUpdateCalls = 0;
let settleCalls = 0;

const prismaClientMock = {
  commission: {
    findUnique: async () => ({
      id: "com_1",
      status: commissionStatus,
      affiliateId: "aff_1",
      dealId: "deal_1",
      amountCents: 25_000,
    }),
    update: async () => {
      commissionUpdateCalls += 1;
      return { id: "com_1", status: commissionStatus };
    },
    // The routes now flip status via a compare-and-set updateMany inside a
    // $transaction (M5); for this authz contract it counts as "the mutation
    // was reached" exactly like update did.
    updateMany: async () => {
      commissionUpdateCalls += 1;
      return { count: 1 };
    },
  },
  adminAuditLog: { create: async () => ({ id: "log_1" }) },
  notification: { create: async () => ({ id: "notif_1" }) },
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      ...prismaClientMock,
      $transaction: async (cb: (tx: typeof prismaClientMock) => Promise<unknown>) => cb(prismaClientMock),
    },
  },
});

mock.module("@/lib/services/affiliate/affiliate-payout.service", {
  namedExports: {
    settleApprovedCommission: async () => {
      settleCalls += 1;
      return { payoutId: "payout_1" };
    },
    CommissionNotClaimableError: class CommissionNotClaimableError extends Error {},
  },
});

// requirePermissionStrict is the gate the routes actually call, and it is NOT
// shadow-mode: an out-of-allow-list role is denied 403 FORBIDDEN before the
// handler reaches any side effect. The mock reproduces that contract and resolves
// the allow-list through the REAL matrix (roleAllows/rolesFor, imported above and
// unaffected by this mock) rather than a role list restated here — a restated list
// would let the mock agree with itself instead of with the policy the server
// enforces, and a blanket allow would delete the control these tests exist to pin.
mock.module("@/lib/auth/permissions", {
  namedExports: {
    requirePermissionStrict: async (_request: NextRequest, permission: Permission) =>
      roleAllows(permission, callerRole)
        ? {
            ok: true,
            admin: {
              adminId: "admin_1",
              email: "caller@autolenis.com",
              role: callerRole,
              mfaVerified: true,
            },
          }
        : {
            ok: false,
            status: 403,
            code: "FORBIDDEN",
            message: `This action requires ${rolesFor(permission).join(" or ")}.`,
          },
  },
});

mock.module("@/lib/auth/admin-api", {
  namedExports: {
    adminSuccess: (data: unknown, status = 200) =>
      NextResponse.json({ success: true, data }, { status }),
    adminError: (code: string, message: string, status = 400) =>
      NextResponse.json({ error: { code, message }, correlationId: "test-corr-id" }, { status }),
  },
});

async function loadApprove() {
  const mod = await import("@/app/api/admin/affiliates/commissions/[commissionId]/approve/route");
  return mod.POST;
}
async function loadReject() {
  const mod = await import("@/app/api/admin/affiliates/commissions/[commissionId]/reject/route");
  return mod.POST;
}
async function loadMarkPaid() {
  const mod = await import("@/app/api/admin/affiliates/commissions/[commissionId]/mark-paid/route");
  return mod.POST;
}

function req(body: unknown) {
  return new NextRequest("http://localhost/api/admin/affiliates/commissions/com_1/x", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ commissionId: "com_1" }) };

const REJECT_BODY = { reason: "Duplicate submission — already credited." };
const MARK_PAID_BODY = { paymentMethod: "ACH Transfer", paymentReference: "ref-123" };

// Roles that must NOT be able to move affiliate money, per the FINANCE-only
// policy already hard-enforced by reverse/ and clawback/.
const UNDER_PRIVILEGED = ["SUPPORT_ADMIN", "OPERATIONS_ADMIN", "COMPLIANCE_ADMIN"] as const;

beforeEach(() => {
  callerRole = "FINANCE_ADMIN";
  commissionStatus = "PENDING";
  commissionUpdateCalls = 0;
  settleCalls = 0;
});

// ── approve ──────────────────────────────────────────────────────────────────
for (const role of UNDER_PRIVILEGED) {
  test(`approve: ${role} → 403 and the commission is NEVER updated`, async () => {
    callerRole = role;

    const POST = await loadApprove();
    const res = await POST(req({}), params);

    assert.equal(res.status, 403);
    const body = JSON.parse((await res.text()).trim());
    assert.equal(body.error.code, "FORBIDDEN");
    assert.equal(commissionUpdateCalls, 0, `${role} must not approve a commission`);
  });
}

test("approve: FINANCE_ADMIN still approves (no regression)", async () => {
  callerRole = "FINANCE_ADMIN";

  const POST = await loadApprove();
  const res = await POST(req({}), params);

  assert.equal(res.status, 200);
  assert.equal(commissionUpdateCalls, 1);
});

test("approve: SUPER_ADMIN still approves (no regression)", async () => {
  callerRole = "SUPER_ADMIN";

  const POST = await loadApprove();
  const res = await POST(req({}), params);

  assert.equal(res.status, 200);
  assert.equal(commissionUpdateCalls, 1);
});

// ── reject ───────────────────────────────────────────────────────────────────
for (const role of UNDER_PRIVILEGED) {
  test(`reject: ${role} → 403 and the commission is NEVER updated`, async () => {
    callerRole = role;

    const POST = await loadReject();
    const res = await POST(req(REJECT_BODY), params);

    assert.equal(res.status, 403);
    const body = JSON.parse((await res.text()).trim());
    assert.equal(body.error.code, "FORBIDDEN");
    assert.equal(commissionUpdateCalls, 0, `${role} must not reject a commission`);
  });
}

test("reject: FINANCE_ADMIN still rejects (no regression)", async () => {
  callerRole = "FINANCE_ADMIN";

  const POST = await loadReject();
  const res = await POST(req(REJECT_BODY), params);

  assert.equal(res.status, 200);
  assert.equal(commissionUpdateCalls, 1);
});

test("reject: SUPER_ADMIN still rejects (no regression)", async () => {
  callerRole = "SUPER_ADMIN";

  const POST = await loadReject();
  const res = await POST(req(REJECT_BODY), params);

  assert.equal(res.status, 200);
  assert.equal(commissionUpdateCalls, 1);
});

// ── mark-paid (real payout settlement) ───────────────────────────────────────
for (const role of UNDER_PRIVILEGED) {
  test(`mark-paid: ${role} → 403 and settlement is NEVER reached`, async () => {
    callerRole = role;
    commissionStatus = "APPROVED";

    const POST = await loadMarkPaid();
    const res = await POST(req(MARK_PAID_BODY), params);

    assert.equal(res.status, 403);
    const body = JSON.parse((await res.text()).trim());
    assert.equal(body.error.code, "FORBIDDEN");
    assert.equal(settleCalls, 0, `${role} must not settle an affiliate payout`);
  });
}

test("mark-paid: FINANCE_ADMIN still settles (no regression)", async () => {
  callerRole = "FINANCE_ADMIN";
  commissionStatus = "APPROVED";

  const POST = await loadMarkPaid();
  const res = await POST(req(MARK_PAID_BODY), params);

  assert.equal(res.status, 200);
  assert.equal(settleCalls, 1);
});

test("mark-paid: SUPER_ADMIN still settles (no regression)", async () => {
  callerRole = "SUPER_ADMIN";
  commissionStatus = "APPROVED";

  const POST = await loadMarkPaid();
  const res = await POST(req(MARK_PAID_BODY), params);

  assert.equal(res.status, 200);
  assert.equal(settleCalls, 1);
});

// The authorization gate must precede state/validation work, so an
// under-privileged caller learns nothing about the record it targeted.
test("authorization is checked BEFORE commission state validation", async () => {
  callerRole = "SUPPORT_ADMIN";
  commissionStatus = "PAID"; // would otherwise produce INVALID_STATUS (400)

  const POST = await loadApprove();
  const res = await POST(req({}), params);

  assert.equal(res.status, 403, "role check must short-circuit ahead of the status check");
  const body = JSON.parse((await res.text()).trim());
  assert.equal(body.error.code, "FORBIDDEN");
});
