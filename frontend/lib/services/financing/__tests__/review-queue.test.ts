// Phase 5 Block 4 — human-in-the-loop review queue. When the engine cannot (or must
// not) auto-decide — a CONDITIONAL approval's stips, a decline needing an adverse-
// action notice with no injected rule, an unexpected outcome, or a lender failure —
// it routes to a FinancingReviewTask. A human's decision is recorded into the
// tamper-evident audit trail (HUMAN_OVERRIDE + REVIEW_RESOLVED) and drives the
// application forward. Routing is idempotent (no duplicate OPEN task per app+type).
//
// Run: pnpm test:financing

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const state = {
  tasks: [] as Array<Record<string, unknown>>,
  created: [] as Array<Record<string, unknown>>,
  updateManyResult: 1,
  updateManyCalls: [] as Array<Record<string, unknown>>,
  audit: [] as Array<Record<string, unknown>>,
  advanceCalls: [] as Array<{ to: string; force?: boolean }>,
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      financingReviewTask: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) =>
          state.tasks.find(
            (t) => t.creditApplicationId === where.creditApplicationId && t.taskType === where.taskType && (where.status ? (where.status as { in?: string[] }).in?.includes(t.status as string) ?? t.status === where.status : true),
          ) ?? null,
        findUnique: async ({ where }: { where: { id: string } }) => state.tasks.find((t) => t.id === where.id) ?? null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `task_${state.tasks.length + 1}`, ...data };
          state.created.push(data);
          state.tasks.push(row);
          return row;
        },
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          state.updateManyCalls.push({ where, data });
          return { count: state.updateManyResult };
        },
        findMany: async () => state.tasks.filter((t) => t.status === "OPEN"),
      },
    },
  },
});
mock.module("@/lib/services/financing/financing-audit.service", {
  namedExports: { appendFinancingAuditEvent: async (e: Record<string, unknown>) => { state.audit.push(e); return { id: "e" }; } },
});
mock.module("@/lib/services/financing/credit-application.service", {
  namedExports: { advanceApplication: async (_id: string, to: string, opts?: { force?: boolean }) => { state.advanceCalls.push({ to, force: opts?.force }); } },
});

beforeEach(() => {
  state.tasks = [];
  state.created = [];
  state.updateManyResult = 1;
  state.updateManyCalls = [];
  state.audit = [];
  state.advanceCalls = [];
});

test("routeToReview creates a task and records REVIEW_ROUTED", async () => {
  const { routeToReview } = await import("@/lib/services/financing/review-queue.service");
  const t = await routeToReview({ creditApplicationId: "app_1", dealId: "deal_1", buyerId: "b1", taskType: "STIP_REVIEW" as never, reason: "stips" });
  assert.equal(state.created.length, 1);
  assert.equal(state.created[0]!.taskType, "STIP_REVIEW");
  assert.equal(state.created[0]!.status, "OPEN");
  assert.equal(t.id, "task_1");
  assert.ok(state.audit.some((e) => e.eventType === "REVIEW_ROUTED"));
});

test("routeToReview is idempotent — no duplicate OPEN task for the same app+type", async () => {
  const { routeToReview } = await import("@/lib/services/financing/review-queue.service");
  await routeToReview({ creditApplicationId: "app_1", taskType: "ADVERSE_ACTION_REVIEW" as never });
  await routeToReview({ creditApplicationId: "app_1", taskType: "ADVERSE_ACTION_REVIEW" as never });
  assert.equal(state.created.length, 1, "second route reuses the open task");
  // a DIFFERENT type for the same app is a distinct task
  await routeToReview({ creditApplicationId: "app_1", taskType: "STIP_REVIEW" as never });
  assert.equal(state.created.length, 2);
});

test("resolveReviewTask records HUMAN_OVERRIDE + REVIEW_RESOLVED and advances the app on the human decision (force)", async () => {
  const { resolveReviewTask } = await import("@/lib/services/financing/review-queue.service");
  state.tasks.push({ id: "task_1", creditApplicationId: "app_1", dealId: "deal_1", buyerId: "b1", taskType: "ADVERSE_ACTION_REVIEW", status: "OPEN" });
  await resolveReviewTask("task_1", { adminId: "admin_9", resolution: "notice mailed manually", decision: "DECLINED" as never });
  const call = state.updateManyCalls[0]!;
  assert.equal((call.where as Record<string, unknown>).id, "task_1");
  assert.equal((call.data as Record<string, unknown>).status, "RESOLVED");
  assert.equal((call.data as Record<string, unknown>).resolvedBy, "admin_9");
  // the human decision drives the application forward (force — a human can override the machine)
  assert.deepEqual(state.advanceCalls, [{ to: "DECLINED", force: true }]);
  assert.ok(state.audit.some((e) => e.eventType === "HUMAN_OVERRIDE" && (e.actorType === "ADMIN")));
  assert.ok(state.audit.some((e) => e.eventType === "REVIEW_RESOLVED"));
});

test("resolveReviewTask without a decision resolves the task but does NOT move the application", async () => {
  const { resolveReviewTask } = await import("@/lib/services/financing/review-queue.service");
  state.tasks.push({ id: "task_1", creditApplicationId: "app_1", taskType: "STIP_REVIEW", status: "OPEN" });
  await resolveReviewTask("task_1", { adminId: "admin_9", resolution: "info only" });
  assert.equal(state.advanceCalls.length, 0);
  assert.ok(state.audit.some((e) => e.eventType === "REVIEW_RESOLVED"));
});

test("resolveReviewTask throws a concurrency error when the task was already resolved (CAS 0 rows)", async () => {
  const { resolveReviewTask } = await import("@/lib/services/financing/review-queue.service");
  state.tasks.push({ id: "task_1", creditApplicationId: "app_1", taskType: "STIP_REVIEW", status: "OPEN" });
  state.updateManyResult = 0;
  await assert.rejects(() => resolveReviewTask("task_1", { adminId: "a", resolution: "x" }), /concurren|already|conflict/i);
});
