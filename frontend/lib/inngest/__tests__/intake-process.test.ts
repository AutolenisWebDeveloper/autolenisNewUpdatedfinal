// S1 — durable intake worker (autolenis/intake.process).
//
// Pins the reliability contract the funnel depends on:
//   • duplicate delivery is blocked by the idempotency guard (no double-run);
//   • success stamps intakeProcessedAt and marks the guard completed;
//   • a thrown step re-throws (so Inngest retries) and, on a NON-final attempt,
//     the guard is HELD (a concurrent reconciler must not double-run it) and it
//     does NOT dead-letter;
//   • on the FINAL attempt it dead-letters AND releases the guard, so the S2
//     reconciler can later re-drive a permanently-failed intake.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks lib/inngest/__tests__/intake-process.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Controllable idempotency toolkit + spies ─────────────────────────────────
let acquireResult = true;
const calls = {
  acquire: 0,
  update: [] as Array<{ status: string }>,
  release: 0,
  deadLetter: 0,
};
let isFinal = false;

mock.module("@/lib/inngest/idempotency", {
  namedExports: {
    getSupabase: () => ({}),
    acquireIdempotencyGuard: async () => {
      calls.acquire += 1;
      return acquireResult;
    },
    updateIdempotencyState: async (_s: unknown, _k: string, status: string) => {
      calls.update.push({ status });
    },
    releaseIdempotencyGuard: async () => {
      calls.release += 1;
    },
    moveJobToDeadLetter: async () => {
      calls.deadLetter += 1;
    },
    isFinalAttempt: () => isFinal,
  },
});

// Pipeline runner — controllable success/throw.
let pipelineImpl: (id: string) => Promise<{ dealersContacted: number }> = async () => ({
  dealersContacted: 3,
});
mock.module("@/lib/services/acquisition/intake-pipeline.service", {
  namedExports: {
    runIntakePipeline: (id: string) => pipelineImpl(id),
  },
});

let intakeProcessedStamps = 0;
mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      buyerOpportunity: {
        update: async ({ data }: { data: Record<string, unknown> }) => {
          if ("intakeProcessedAt" in data) intakeProcessedStamps += 1;
          return {};
        },
      },
    },
  },
});

async function load() {
  const mod = await import("@/lib/inngest/intake-functions");
  return mod.runIntakeProcess;
}

// Minimal ctx mirroring Inngest's shape; step.run just invokes the thunk.
function ctx(buyerOpportunityId: string) {
  return {
    event: { data: { buyerOpportunityId } },
    step: { run: <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn() },
    runId: "run_1",
  };
}

beforeEach(() => {
  acquireResult = true;
  isFinal = false;
  calls.acquire = 0;
  calls.update = [];
  calls.release = 0;
  calls.deadLetter = 0;
  intakeProcessedStamps = 0;
  pipelineImpl = async () => ({ dealersContacted: 3 });
});

test("duplicate delivery is blocked by the guard — pipeline never runs", async () => {
  acquireResult = false;
  let ran = false;
  pipelineImpl = async () => {
    ran = true;
    return { dealersContacted: 0 };
  };
  const runIntakeProcess = await load();
  const res = await runIntakeProcess(ctx("opp_1"));
  assert.equal(res.status, "DUPLICATE_BLOCKED");
  assert.equal(ran, false, "pipeline must not run on a duplicate");
  assert.equal(intakeProcessedStamps, 0);
});

test("success runs the pipeline, stamps intakeProcessedAt, marks the guard completed", async () => {
  const runIntakeProcess = await load();
  const res = await runIntakeProcess(ctx("opp_1"));
  assert.equal(res.status, "SUCCESS");
  assert.equal(res.dealersContacted, 3);
  assert.equal(intakeProcessedStamps, 1, "intakeProcessedAt stamped exactly once");
  assert.deepEqual(calls.update.map((u) => u.status), ["completed"]);
  assert.equal(calls.release, 0, "a completed guard is never released");
  assert.equal(calls.deadLetter, 0);
});

test("non-final failure: re-throws, HOLDS the guard, does not dead-letter", async () => {
  isFinal = false;
  pipelineImpl = async () => {
    throw new Error("enrichment boom");
  };
  const runIntakeProcess = await load();
  await assert.rejects(() => runIntakeProcess(ctx("opp_1")), /enrichment boom/);
  assert.deepEqual(calls.update.map((u) => u.status), ["failed"]);
  assert.equal(calls.release, 0, "guard held during retries so a reconciler can't double-run");
  assert.equal(calls.deadLetter, 0, "no dead-letter until the final attempt");
  assert.equal(intakeProcessedStamps, 0, "never stamped on failure");
});

test("final failure: dead-letters AND releases the guard so the reconciler can re-drive", async () => {
  isFinal = true;
  pipelineImpl = async () => {
    throw new Error("outreach boom");
  };
  const runIntakeProcess = await load();
  await assert.rejects(() => runIntakeProcess(ctx("opp_1")), /outreach boom/);
  assert.deepEqual(calls.update.map((u) => u.status), ["failed"]);
  assert.equal(calls.deadLetter, 1, "dead-lettered on the final attempt");
  assert.equal(calls.release, 1, "guard released on final failure → re-drivable");
  assert.equal(intakeProcessedStamps, 0);
});
