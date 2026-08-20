// Route contract for POST /api/admin/financing-reviews/[taskId]/resolve — role
// gate, validation, delegation to resolveReviewTask, and CAS/illegal-move → 409.
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
mock.module("@/lib/services/financing/review-queue.service", {
  namedExports: {
    resolveReviewTask: async (taskId: string, input: Record<string, unknown>) => {
      if (state.resolveThrows) throw state.resolveThrows;
      state.resolveCalls.push({ taskId, ...input });
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

test("resolves and forwards adminId + decision to the service", async () => {
  const res = await POST({ resolution: "stips cleared", decision: "APPROVED" });
  assert.equal(res.status, 200);
  assert.equal(state.resolveCalls.length, 1);
  assert.equal(state.resolveCalls[0]!.taskId, "task_1");
  assert.equal(state.resolveCalls[0]!.adminId, "admin_9");
  assert.equal(state.resolveCalls[0]!.decision, "APPROVED");
});

test("409 when the task was already resolved / an illegal move (service throws)", async () => {
  state.resolveThrows = new Error("Concurrency conflict");
  const res = await POST({ resolution: "x", decision: "APPROVED" });
  assert.equal(res.status, 409);
  assert.equal(res.code, "RESOLVE_FAILED");
});
