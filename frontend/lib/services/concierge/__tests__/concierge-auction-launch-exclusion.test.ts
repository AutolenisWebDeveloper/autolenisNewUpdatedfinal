// Program 2 §10 truthfulness regression: a concierge-converted deposit converges
// to an already-CLOSED auction with offers ready — it never launches a live
// competitive auction. So a `deposit_paid` event carrying `concierge === true`
// must NOT enroll the buyer into the `auction_launch` prebuilt workflow, whose
// copy is "your auction is live. Dealers are now competing for your vehicle."
//
// This pins WorkflowEngine.triggerForEvent's state-eligibility skip. A standard
// (non-concierge) deposit still enrolls auction_launch.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/concierge/__tests__/concierge-auction-launch-exclusion.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});
// workflow.engine imports these at module load; stub so the real (server-only /
// supabase-service) chain is never pulled in the test.
mock.module("@/lib/services/comms/comms-outbox.service", {
  namedExports: { enqueueEmail: async () => {}, enqueueSms: async () => {} },
});

// Two active workflows listen for deposit_paid: the live-auction launch (prebuilt
// key auction_launch) and an unrelated one that must always enroll.
const WORKFLOW_ROWS = [
  { id: "wf_launch", prebuilt_key: "auction_launch" },
  { id: "wf_welcome", prebuilt_key: "buyer_welcome" },
];

function fakeSupabase() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ data: WORKFLOW_ROWS }),
        }),
      }),
    }),
  } as never;
}

let enrollCalls: string[];

async function loadEngine() {
  const mod = await import("@/lib/services/workflow.engine");
  // Stub the (heavy, DB-backed) enrollment so the test isolates the
  // eligibility-skip logic. `this.enrollContact` in triggerForEvent resolves to
  // this static property.
  (mod.WorkflowEngine as unknown as { enrollContact: (...a: unknown[]) => Promise<unknown> }).enrollContact =
    async (...args: unknown[]) => {
      enrollCalls.push(args[1] as string);
      return true;
    };
  return mod.WorkflowEngine;
}

beforeEach(() => {
  enrollCalls = [];
});

test("concierge deposit_paid does NOT enroll auction_launch (truthfulness §10)", async () => {
  const WorkflowEngine = await loadEngine();
  const res = await WorkflowEngine.triggerForEvent(fakeSupabase(), "deposit_paid" as never, "contact1", {
    concierge: true,
  });
  assert.deepEqual(enrollCalls, ["wf_welcome"], "auction_launch must be skipped for a concierge deposit");
  assert.equal(res.enrolled, 1);
  assert.ok(res.skipped >= 1);
});

test("standard (non-concierge) deposit_paid STILL enrolls auction_launch", async () => {
  const WorkflowEngine = await loadEngine();
  const res = await WorkflowEngine.triggerForEvent(fakeSupabase(), "deposit_paid" as never, "contact1", {
    // no concierge flag — a normal launched auction
  });
  assert.ok(enrollCalls.includes("wf_launch"), "auction_launch must enroll for a standard deposit");
  assert.ok(enrollCalls.includes("wf_welcome"));
  assert.equal(res.enrolled, 2);
});

test("explicit concierge:false behaves like a standard deposit", async () => {
  const WorkflowEngine = await loadEngine();
  await WorkflowEngine.triggerForEvent(fakeSupabase(), "deposit_paid" as never, "contact1", { concierge: false });
  assert.ok(enrollCalls.includes("wf_launch"));
});
