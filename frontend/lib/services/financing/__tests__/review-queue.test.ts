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
  updateManyCalls: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
  audit: [] as Array<Record<string, unknown>>,
  advanceCalls: [] as Array<{ to: string; force?: boolean }>,
  createThrowsP2002: false,
  advanceThrows: false,
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
          if (state.createThrowsP2002) {
            const err = new Error("Unique constraint failed") as Error & { code?: string };
            err.code = "P2002";
            throw err;
          }
          const row = { id: `task_${state.tasks.length + 1}`, ...data };
          state.created.push(data);
          state.tasks.push(row);
          return row;
        },
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          state.updateManyCalls.push({ where, data });
          return { count: state.updateManyResult };
        },
        findMany: async ({ where }: { where?: { status?: { in?: string[] } } }) => {
          const wanted = where?.status?.in;
          return wanted ? state.tasks.filter((t) => wanted.includes(t.status as string)) : state.tasks;
        },
      },
    },
  },
});
mock.module("@/lib/services/financing/financing-audit.service", {
  namedExports: { appendFinancingAuditEvent: async (e: Record<string, unknown>) => { state.audit.push(e); return { id: "e" }; } },
});
mock.module("@/lib/services/financing/credit-application.service", {
  namedExports: {
    advanceApplication: async (_id: string, to: string, opts?: { force?: boolean }) => {
      if (state.advanceThrows) throw new Error("app CAS conflict");
      state.advanceCalls.push({ to, force: opts?.force });
    },
  },
});

beforeEach(() => {
  state.tasks = [];
  state.created = [];
  state.updateManyResult = 1;
  state.updateManyCalls = [];
  state.audit = [];
  state.advanceCalls = [];
  state.createThrowsP2002 = false;
  state.advanceThrows = false;
});

test("routeToReview handles the create race (P2002) by returning the winner, not duplicating", async () => {
  const { routeToReview } = await import("@/lib/services/financing/review-queue.service");
  // Simulate: findFirst saw nothing, but a concurrent create already inserted the
  // winner (which the partial-unique index then rejects for us).
  state.createThrowsP2002 = true;
  state.tasks.push({ id: "winner", creditApplicationId: "app_1", taskType: "STIP_REVIEW", status: "OPEN" });
  const t = await routeToReview({ creditApplicationId: "app_1", taskType: "STIP_REVIEW" as never });
  assert.equal(t.id, "winner", "returns the concurrently-created task instead of throwing/duplicating");
});

test("claimReviewTask CAS: OPEN→IN_PROGRESS, and throws when the claim is lost", async () => {
  const { claimReviewTask } = await import("@/lib/services/financing/review-queue.service");
  await claimReviewTask("task_1", "admin_1");
  assert.equal(state.updateManyCalls[0]!.data.status, "IN_PROGRESS");
  assert.equal(state.updateManyCalls[0]!.data.assignedAdminId, "admin_1");
  state.updateManyResult = 0;
  await assert.rejects(() => claimReviewTask("task_1", "admin_2"), /already|concurren|conflict/i);
});

test("resolveReviewTask COMPENSATES (reverts the RESOLVED mark) if advancing the app fails — stays retryable", async () => {
  const { resolveReviewTask } = await import("@/lib/services/financing/review-queue.service");
  state.tasks.push({ id: "task_1", creditApplicationId: "app_1", taskType: "STIP_REVIEW", status: "OPEN" });
  state.advanceThrows = true;
  await assert.rejects(() => resolveReviewTask("task_1", { adminId: "a", resolution: "x", decision: "APPROVED" as never }), /CAS conflict/);
  // Two updateMany calls: the RESOLVED CAS, then the compensating revert back to OPEN.
  assert.equal(state.updateManyCalls.length, 2);
  assert.equal(state.updateManyCalls[0]!.data.status, "RESOLVED");
  assert.equal(state.updateManyCalls[1]!.data.status, "OPEN", "the RESOLVED mark is reverted so the resolve can be retried");
  assert.equal(state.audit.some((e) => e.eventType === "REVIEW_RESOLVED"), false, "no REVIEW_RESOLVED written when it failed");
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
  // the human decision drives the application forward — VALIDATED by default (no force)
  assert.deepEqual(state.advanceCalls, [{ to: "DECLINED", force: false }]);
  assert.ok(state.audit.some((e) => e.eventType === "HUMAN_OVERRIDE" && (e.actorType === "ADMIN")));
  assert.ok(state.audit.some((e) => e.eventType === "REVIEW_RESOLVED"));
});

test("resolveReviewTask with override:true forces the transition (deliberate illegal-move override)", async () => {
  const { resolveReviewTask } = await import("@/lib/services/financing/review-queue.service");
  state.tasks.push({ id: "task_1", creditApplicationId: "app_1", taskType: "MANUAL_DECISION_REVIEW", status: "OPEN" });
  await resolveReviewTask("task_1", { adminId: "admin_9", resolution: "manual override", decision: "APPROVED" as never, override: true });
  assert.deepEqual(state.advanceCalls, [{ to: "APPROVED", force: true }]);
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

test("listOpenReviewTasks includes IN_PROGRESS (a claimed task must stay visible)", async () => {
  const { listOpenReviewTasks } = await import("@/lib/services/financing/review-queue.service");
  state.tasks.push({ id: "t_open", creditApplicationId: "app_1", taskType: "STIP_REVIEW", status: "OPEN" });
  state.tasks.push({ id: "t_claimed", creditApplicationId: "app_2", taskType: "STIP_REVIEW", status: "IN_PROGRESS" });
  state.tasks.push({ id: "t_done", creditApplicationId: "app_3", taskType: "STIP_REVIEW", status: "RESOLVED" });
  const open = await listOpenReviewTasks();
  const ids = open.map((t) => t.id);
  assert.ok(ids.includes("t_open"), "OPEN listed");
  assert.ok(ids.includes("t_claimed"), "IN_PROGRESS listed");
  assert.equal(ids.includes("t_done"), false, "RESOLVED excluded");
});
