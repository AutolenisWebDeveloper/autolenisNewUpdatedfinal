// S3 — the durable dealer-award dispatch worker (autolenis/dealer.award).
// Mirrors the intake worker's idempotency lifecycle.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks lib/inngest/__tests__/dealer-award-fn.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let acquireResult = true;
let isFinal = false;
const calls = { emit: 0, update: [] as string[], release: 0, deadLetter: 0 };
let emitImpl: () => Promise<void> = async () => {};

mock.module("@/lib/inngest/idempotency", {
  namedExports: {
    getSupabase: () => ({}),
    acquireIdempotencyGuard: async () => acquireResult,
    updateIdempotencyState: async (_s: unknown, _k: string, status: string) => {
      calls.update.push(status);
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

mock.module("@/lib/services/notifications/dealer-award", {
  namedExports: {
    emitDealerAwardOutcomes: async () => {
      calls.emit += 1;
      return emitImpl();
    },
  },
});

async function load() {
  const mod = await import("@/lib/inngest/dealer-award-functions");
  return mod.runDealerAward;
}

function ctx() {
  return {
    event: { data: { auctionId: "a1", winningOfferId: "off_1", dealId: "deal_1" } },
    step: { run: <T>(_n: string, fn: () => Promise<T>): Promise<T> => fn() },
    runId: "run_1",
  };
}

beforeEach(() => {
  acquireResult = true;
  isFinal = false;
  calls.emit = 0;
  calls.update = [];
  calls.release = 0;
  calls.deadLetter = 0;
  emitImpl = async () => {};
});

test("duplicate delivery is blocked — outcomes not emitted", async () => {
  acquireResult = false;
  const runDealerAward = await load();
  const res = await runDealerAward(ctx());
  assert.equal(res.status, "DUPLICATE_BLOCKED");
  assert.equal(calls.emit, 0);
});

test("success emits outcomes once and marks the guard completed", async () => {
  const runDealerAward = await load();
  const res = await runDealerAward(ctx());
  assert.equal(res.status, "SUCCESS");
  assert.equal(calls.emit, 1);
  assert.deepEqual(calls.update, ["completed"]);
  assert.equal(calls.release, 0);
  assert.equal(calls.deadLetter, 0);
});

test("non-final failure holds the guard and does not dead-letter", async () => {
  isFinal = false;
  emitImpl = async () => { throw new Error("boom"); };
  const runDealerAward = await load();
  await assert.rejects(() => runDealerAward(ctx()), /boom/);
  assert.deepEqual(calls.update, ["failed"]);
  assert.equal(calls.release, 0);
  assert.equal(calls.deadLetter, 0);
});

test("final failure dead-letters and releases the guard", async () => {
  isFinal = true;
  emitImpl = async () => { throw new Error("boom"); };
  const runDealerAward = await load();
  await assert.rejects(() => runDealerAward(ctx()), /boom/);
  assert.deepEqual(calls.update, ["failed"]);
  assert.equal(calls.deadLetter, 1);
  assert.equal(calls.release, 1);
});
