// Unit tests for the workflow-resume drain — migrated off the Inngest
// `workflowResumeFn` onto the internal Vercel-Cron substrate with durable
// resume_at state. Pins:
//   • NO_DUE_RESUMES when nothing is due;
//   • a due row is claimed, resumed, and its resume_at cleared (conditional on the
//     value being unchanged — a re-suspend at a later delay survives);
//   • a lost claim (claimJob=false) is skipped, resumeEnrollment NOT called;
//   • a failed resume does NOT clear resume_at (re-driven next tick) and marks the
//     guard 'failed';
//   • a malformed row (resume_at without a node) is cleared and skipped;
//   • a query error throws (→ cron FAILED / HTTP 500).
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/crm/__tests__/workflow-resume-drain.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let dueRows: Array<Record<string, unknown>> = [];
let queryError: { message: string } | null = null;
let claimResult = true;
let resumeThrows = false;
let engineEnabled = true;

const resumeCalls: Array<{ enrollmentId: string; nodeId: string }> = [];
const updateCalls: Array<{ data: Record<string, unknown>; eq: Array<[string, unknown]> }> = [];
const idempotencyStates: Array<{ key: string; status: string }> = [];

function makeBuilder() {
  let isUpdate = false;
  let updateData: Record<string, unknown> = {};
  const eqArgs: Array<[string, unknown]> = [];
  const b: Record<string, unknown> = {
    select: () => b,
    update: (d: Record<string, unknown>) => { isUpdate = true; updateData = d; return b; },
    eq: (col: string, val: unknown) => { eqArgs.push([col, val]); return b; },
    not: () => b,
    lte: () => b,
    order: () => b,
    limit: () => b,
    then: (resolve: (v: unknown) => void) => {
      if (isUpdate) {
        updateCalls.push({ data: updateData, eq: eqArgs });
        resolve({ data: null, error: null });
      } else {
        resolve({ data: dueRows, error: queryError });
      }
    },
  };
  return b;
}

mock.module("@/lib/supabase-service", {
  namedExports: { getServiceSupabase: () => ({ from: () => makeBuilder() }) },
});

mock.module("@/lib/jobs/idempotency", {
  namedExports: {
    claimJob: async () => claimResult,
    updateIdempotencyState: async (_s: unknown, key: string, status: string) => {
      idempotencyStates.push({ key, status });
    },
  },
});

mock.module("@/lib/services/workflow.engine", {
  namedExports: {
    isInAppEngineEnabled: () => engineEnabled,
    WorkflowEngine: {
      resumeEnrollment: async (_s: unknown, enrollmentId: string, nodeId: string) => {
        resumeCalls.push({ enrollmentId, nodeId });
        if (resumeThrows) throw new Error("resume boom");
      },
    },
  },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

async function load() {
  return import("@/lib/services/crm/workflow-resume-drain.service");
}

beforeEach(() => {
  dueRows = [];
  queryError = null;
  claimResult = true;
  resumeThrows = false;
  engineEnabled = true;
  resumeCalls.length = 0;
  updateCalls.length = 0;
  idempotencyStates.length = 0;
});

test("returns ENGINE_DISABLED and touches nothing when the in-app engine is off", async () => {
  engineEnabled = false;
  dueRows = [{ id: "e1", resume_node_id: "n2", resume_at: "2026-01-01T00:00:00.000Z" }];
  const { drainDueWorkflowResumes } = await load();
  const r = await drainDueWorkflowResumes();
  assert.equal(r.status, "ENGINE_DISABLED");
  assert.equal(resumeCalls.length, 0);
  assert.equal(updateCalls.length, 0, "pending resumes are preserved for re-enablement, not cleared");
});

test("returns NO_DUE_RESUMES when nothing is due", async () => {
  const { drainDueWorkflowResumes } = await load();
  const r = await drainDueWorkflowResumes();
  assert.equal(r.status, "NO_DUE_RESUMES");
  assert.equal(r.due, 0);
  assert.equal(resumeCalls.length, 0);
});

test("claims a due row, resumes it, and clears resume_at conditionally", async () => {
  dueRows = [{ id: "e1", resume_node_id: "n2", resume_at: "2026-01-01T00:00:00.000Z" }];
  const { drainDueWorkflowResumes } = await load();
  const r = await drainDueWorkflowResumes();
  assert.equal(r.status, "OK");
  assert.equal(r.resumed, 1);
  assert.deepEqual(resumeCalls, [{ enrollmentId: "e1", nodeId: "n2" }]);
  // The clear update: sets resume_at/resume_node_id null, guarded on id + the
  // original resume_at (so a re-suspend at a later delay survives).
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].data.resume_at, null);
  assert.equal(updateCalls[0].data.resume_node_id, null);
  assert.ok(updateCalls[0].eq.some(([c, v]) => c === "id" && v === "e1"));
  assert.ok(updateCalls[0].eq.some(([c, v]) => c === "resume_at" && v === "2026-01-01T00:00:00.000Z"));
  assert.deepEqual(idempotencyStates, [{ key: "workflow-resume:e1:n2:2026-01-01T00:00:00.000Z", status: "completed" }]);
});

test("skips a row whose claim is lost (does not resume)", async () => {
  dueRows = [{ id: "e1", resume_node_id: "n2", resume_at: "2026-01-01T00:00:00.000Z" }];
  claimResult = false;
  const { drainDueWorkflowResumes } = await load();
  const r = await drainDueWorkflowResumes();
  assert.equal(r.skipped, 1);
  assert.equal(r.resumed, 0);
  assert.equal(resumeCalls.length, 0);
  assert.equal(updateCalls.length, 0, "no clear when the claim was lost");
});

test("a failed resume does NOT clear resume_at and marks the guard failed", async () => {
  dueRows = [{ id: "e1", resume_node_id: "n2", resume_at: "2026-01-01T00:00:00.000Z" }];
  resumeThrows = true;
  const { drainDueWorkflowResumes } = await load();
  const r = await drainDueWorkflowResumes();
  assert.equal(r.failed, 1);
  assert.equal(r.resumed, 0);
  assert.equal(updateCalls.length, 0, "resume_at left set so a later tick re-drives it");
  assert.deepEqual(idempotencyStates, [{ key: "workflow-resume:e1:n2:2026-01-01T00:00:00.000Z", status: "failed" }]);
});

test("a malformed row (no node) is cleared and skipped without claiming", async () => {
  dueRows = [{ id: "e1", resume_node_id: null, resume_at: "2026-01-01T00:00:00.000Z" }];
  const { drainDueWorkflowResumes } = await load();
  const r = await drainDueWorkflowResumes();
  assert.equal(r.skipped, 1);
  assert.equal(resumeCalls.length, 0);
  assert.equal(updateCalls.length, 1, "malformed row is cleared so it isn't re-selected");
  assert.equal(idempotencyStates.length, 0, "no claim attempted");
});

test("throws when the due-resume query errors", async () => {
  queryError = { message: "connection reset" };
  const { drainDueWorkflowResumes } = await load();
  await assert.rejects(() => drainDueWorkflowResumes(), /workflow_resume_query_failed: connection reset/);
});
