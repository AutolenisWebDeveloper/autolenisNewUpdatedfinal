// M5 + D13 — admin commission transitions must be compare-and-set and atomic
// with their audit record.
//
//   • approve/reject/reverse previously did findUnique → status check →
//     UNCONDITIONAL update: between read and write a concurrent actor (the
//     hourly cron, a second admin tab) could commit a different transition and
//     the unconditional update would silently overwrite it. Now the flip is
//     updateMany({ where: { id, status: <expected> } }) inside a $transaction —
//     count 0 → 409 CONFLICT, nothing written.
//   • reverse could flip a REJECTED commission to REVERSED (only REVERSED/PAID
//     were guarded). REJECTED is terminal — now 400.
//   • the audit row is created INSIDE the same transaction — previously
//     `.catch(() => {})` (approve/reject) silently dropped the only record of
//     who moved money, and reverse audited after the commit (audit failure →
//     500 with the reversal already committed and unlogged).
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/admin/affiliates/__tests__/commission-transition-cas.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";
// Hoisted, so it binds the REAL module: mock.module() below replaces the same
// specifier only for the routes' own (later, dynamic) import.
import { roleAllows, rolesFor, type Permission } from "@/lib/auth/permissions";

// FINANCE_ADMIN is inside both PERMISSION_ROLES["finance.commissions.settle"] and
// ["finance.commissions.reverse"], so the gate below admits it and these CAS
// assertions get to run. Resolving that through roleAllows() rather than asserting
// it keeps this suite honest: if the matrix ever stopped admitting FINANCE_ADMIN,
// these tests would 403 rather than silently keep exercising a path the server no
// longer allows.
const CALLER_ROLE = "FINANCE_ADMIN";

let commissionStatus = "PENDING";
// what the CAS updateMany reports — 0 simulates a concurrent transition winning
let casCount = 1;
let auditThrows = false;

let casCalls: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
let auditCalls: Array<Record<string, unknown>> = [];
let committed: boolean; // did the $transaction callback resolve?

const txClient = {
  commission: {
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      casCalls.push({ where, data });
      return { count: casCount };
    },
  },
  adminAuditLog: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      if (auditThrows) throw new Error("audit write failed");
      auditCalls.push(data);
      return { id: "log_1" };
    },
  },
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      commission: {
        findUnique: async () => ({
          id: "com_1",
          status: commissionStatus,
          affiliateId: "aff_1",
          dealId: "deal_1",
          amountCents: 25_000,
        }),
      },
      $transaction: async (cb: (tx: typeof txClient) => Promise<unknown>) => {
        const result = await cb(txClient); // a throw propagates = rollback
        committed = true;
        return result;
      },
    },
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
      roleAllows(permission, CALLER_ROLE)
        ? {
            ok: true,
            admin: {
              adminId: "admin_1",
              email: "caller@autolenis.com",
              role: CALLER_ROLE,
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
    adminSuccess: (data: unknown, status = 200) => NextResponse.json({ success: true, data }, { status }),
    adminError: (code: string, message: string, status = 400) =>
      NextResponse.json({ error: { code, message } }, { status }),
  },
});

function req(body: unknown) {
  return new NextRequest("http://localhost/api/admin/affiliates/commissions/com_1/x", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ commissionId: "com_1" }) };
const REASON = { reason: "Duplicate submission — already credited." };

beforeEach(() => {
  commissionStatus = "PENDING";
  casCount = 1;
  auditThrows = false;
  casCalls = [];
  auditCalls = [];
  committed = false;
});

test("approve: flip is a status-guarded CAS and the audit row is in the same transaction", async () => {
  const { POST } = await import("@/app/api/admin/affiliates/commissions/[commissionId]/approve/route");
  const res = await POST(req({}), params);
  assert.equal(res.status, 200);
  assert.equal(casCalls.length, 1);
  assert.deepEqual(casCalls[0].where, { id: "com_1", status: "PENDING" });
  assert.equal(casCalls[0].data.status, "APPROVED");
  assert.equal(auditCalls.length, 1, "audit row must be written");
  assert.equal(committed, true);
});

test("approve: concurrent transition (CAS count 0) → 409, no audit row", async () => {
  const { POST } = await import("@/app/api/admin/affiliates/commissions/[commissionId]/approve/route");
  casCount = 0;
  const res = await POST(req({}), params);
  assert.equal(res.status, 409);
  assert.equal(auditCalls.length, 0, "a lost race must not write an audit row");
});

test("approve: audit failure rolls the flip back (500, transaction aborted)", async () => {
  const { POST } = await import("@/app/api/admin/affiliates/commissions/[commissionId]/approve/route");
  auditThrows = true;
  const res = await POST(req({}), params);
  assert.equal(res.status, 500);
  assert.equal(committed, false, "the status flip must not commit without its audit record");
});

test("reject: CAS from PENDING with audit in-transaction", async () => {
  const { POST } = await import("@/app/api/admin/affiliates/commissions/[commissionId]/reject/route");
  const res = await POST(req(REASON), params);
  assert.equal(res.status, 200);
  assert.deepEqual(casCalls[0].where, { id: "com_1", status: "PENDING" });
  assert.equal(casCalls[0].data.status, "REJECTED");
  assert.equal(auditCalls.length, 1);
});

test("reject: concurrent transition → 409", async () => {
  const { POST } = await import("@/app/api/admin/affiliates/commissions/[commissionId]/reject/route");
  casCount = 0;
  const res = await POST(req(REASON), params);
  assert.equal(res.status, 409);
});

test("reverse: REJECTED commission cannot be reversed (terminal state)", async () => {
  const { POST } = await import("@/app/api/admin/affiliates/commissions/[commissionId]/reverse/route");
  commissionStatus = "REJECTED";
  const res = await POST(req(REASON), params);
  assert.equal(res.status, 400);
  assert.equal(casCalls.length, 0, "no mutation may be attempted on a terminal state");
});

test("reverse: CAS is scoped to PENDING/APPROVED and audited in-transaction", async () => {
  const { POST } = await import("@/app/api/admin/affiliates/commissions/[commissionId]/reverse/route");
  commissionStatus = "APPROVED";
  const res = await POST(req(REASON), params);
  assert.equal(res.status, 200);
  const where = casCalls[0].where as { id: string; status: { in: string[] } };
  assert.equal(where.id, "com_1");
  assert.deepEqual([...where.status.in].sort(), ["APPROVED", "PENDING"]);
  assert.equal(casCalls[0].data.status, "REVERSED");
  assert.equal(auditCalls.length, 1);
});

test("reverse: concurrent transition → 409, nothing audited", async () => {
  const { POST } = await import("@/app/api/admin/affiliates/commissions/[commissionId]/reverse/route");
  commissionStatus = "APPROVED";
  casCount = 0;
  const res = await POST(req(REASON), params);
  assert.equal(res.status, 409);
  assert.equal(auditCalls.length, 0);
});
