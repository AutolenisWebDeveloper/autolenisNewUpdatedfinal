// Retained Inngest worker for buyer intake — now a THIN delegator.
//
// Pins that the worker owns NO orchestration logic of its own: it calls the shared
// `processBuyerOpportunityIntake` service (the single implementation) and only maps
// a business FAILURE onto a throw so Inngest's retry policy still applies. Every
// terminal outcome is returned unchanged.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks lib/inngest/__tests__/intake-process.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let outcome: Record<string, unknown> = { status: "SUCCESS", opportunityId: "opp_1", dealersContacted: 3 };
let processedId: string | null = null;

mock.module("@/lib/services/acquisition/intake-processor.service", {
  namedExports: {
    processBuyerOpportunityIntake: async (id: string) => {
      processedId = id;
      return outcome;
    },
  },
});

async function load() {
  return (await import("@/lib/inngest/intake-functions")).runIntakeProcess;
}

function ctx(buyerOpportunityId: string) {
  return {
    event: { data: { buyerOpportunityId } },
    step: { run: <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn() },
    runId: "run_1",
  };
}

beforeEach(() => {
  outcome = { status: "SUCCESS", opportunityId: "opp_1", dealersContacted: 3 };
  processedId = null;
});

test("delegates to the shared service with the event's opportunity id", async () => {
  const runIntakeProcess = await load();
  const res = await runIntakeProcess(ctx("opp_1"));
  assert.equal(processedId, "opp_1");
  assert.equal(res.status, "SUCCESS");
  assert.equal(res.dealersContacted, 3);
});

test("a business FAILURE is thrown so Inngest retries", async () => {
  outcome = { status: "FAILED", opportunityId: "opp_1", category: "PIPELINE_ERROR", error: "boom" };
  const runIntakeProcess = await load();
  await assert.rejects(() => runIntakeProcess(ctx("opp_1")), /intake failed for opp_1: boom/);
});

test("DUPLICATE_BLOCKED is terminal — returned, not thrown", async () => {
  outcome = { status: "DUPLICATE_BLOCKED", opportunityId: "opp_1" };
  const runIntakeProcess = await load();
  const res = await runIntakeProcess(ctx("opp_1"));
  assert.equal(res.status, "DUPLICATE_BLOCKED");
});

test("ALREADY_PROCESSED is terminal — returned, not thrown", async () => {
  outcome = { status: "ALREADY_PROCESSED", opportunityId: "opp_1" };
  const runIntakeProcess = await load();
  const res = await runIntakeProcess(ctx("opp_1"));
  assert.equal(res.status, "ALREADY_PROCESSED");
});
