// Route contract for POST /api/admin/financing-reviews/[taskId]/resolve — role gate, validation,
// delegation to the §26 queue writer, and CAS/already-resolved → 409.
//
// RE-POINTED IN PHASE 7 (§13-D25). This suite asserted delegation to `resolveReviewTask` and that
// a `decision` (APPROVED / DECLINED / CONDITIONAL / WITHDRAWN) was forwarded to it. Both are gone
// with the machine they served: `FinancingReviewTask` was keyed on `credit_application_id`, and
// §12 is explicit that AutoLenis "does not accept a lender application, does not pull lender
// credit, does not underwrite" — so there is no application for an admin to decide, and an admin
// picking "APPROVED" here would have been recording a credit decision AutoLenis may not make.
//
// WHAT IS UNCHANGED, AND IS THE POINT OF THIS SUITE: the role gate, the required resolution note,
// the delegation (now to `resolve` in the queue-item service, which owns the compare-and-set), and
// the 409 when the row was already resolved. `control/X-01` records the path this replaces, which
// caught the database error, returned as if the write had happened, and wrote an audit row saying
// "resolved".
//
// Run: pnpm test:financing-routes

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const state = {
  admin: { adminId: "admin_9", role: "FINANCE_ADMIN" } as Record<string, unknown> | null,
  resolveCalls: [] as Array<Record<string, unknown>>,
  resolveThrows: null as Error | null,
};

mock.module("@/lib/auth/admin-api", {
  namedExports: {
    getAdminWithRole: async () => state.admin,
    adminError: (code: string, message: string, status = 400) => ({ __ok: false, status, code, message }),
    adminSuccess: (data: unknown, status = 200) => ({ __ok: true, status, data }),
    OPERATIONAL_ROLES: ["SUPER_ADMIN", "OPERATIONS_ADMIN", "COMPLIANCE_ADMIN", "FINANCE_ADMIN"],
  },
});
mock.module("@/lib/services/financing/financing-follow-up.service", {
  namedExports: {
    resolveFinancingFollowUp: async (input: Record<string, unknown>) => {
      if (state.resolveThrows) throw state.resolveThrows;
      state.resolveCalls.push({ ...input });
      return { id: String(input.queueItemId) };
    },
  },
});

function req(body: unknown) {
  return new NextRequest("http://localhost/api/admin/financing-reviews/task_1/resolve", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}
async function POST(body: unknown, taskId = "task_1") {
  const mod = await import("@/app/api/admin/financing-reviews/[taskId]/resolve/route");
  return (await mod.POST(req(body), { params: Promise.resolve({ taskId }) })) as unknown as { __ok: boolean; status: number; code?: string };
}

beforeEach(() => {
  state.admin = { adminId: "admin_9", role: "FINANCE_ADMIN" };
  state.resolveCalls = [];
  state.resolveThrows = null;
});

test("403 when the admin lacks an operational role", async () => {
  state.admin = null;
  const res = await POST({ resolution: "x" });
  assert.equal(res.status, 403);
});

test("400 on missing resolution", async () => {
  const res = await POST({});
  assert.equal(res.status, 400);
});

test("resolves and forwards the queue item id + the resolving admin", async () => {
  const res = await POST({ resolution: "buyer moved to a credit union pre-approval" });
  assert.equal(res.status, 200);
  assert.equal(state.resolveCalls.length, 1);
  assert.equal(state.resolveCalls[0]!.queueItemId, "task_1");
  assert.equal(state.resolveCalls[0]!.resolvedBy, "admin_9");
  assert.equal(state.resolveCalls[0]!.resolution, "buyer moved to a credit union pre-approval");
});

test("§13-D25 — a `decision` is NOT forwarded; there is no credit decision to record", async () => {
  // The strongest statement of the retirement: even if a caller sends the old field, nothing
  // carries it onward. An admin may resolve a follow-up; they may not adjudicate an application.
  const res = await POST({ resolution: "resolved by phone", decision: "APPROVED" });
  assert.equal(res.status, 200);
  assert.equal(state.resolveCalls[0]!.decision, undefined);
});

test("409 when the row was already resolved (the compare-and-set matched nothing)", async () => {
  state.resolveThrows = new Error("Concurrency conflict");
  const res = await POST({ resolution: "x" });
  assert.equal(res.status, 409);
  assert.equal(res.code, "RESOLVE_FAILED");
});
