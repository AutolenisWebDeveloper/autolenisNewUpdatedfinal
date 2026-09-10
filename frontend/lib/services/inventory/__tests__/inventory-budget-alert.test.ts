// Operations must hear about the call budget at 80%, not after the catalogue has gone stale.
//
// The failure this prevents is the one that already happened: 305 consecutive rejected calls
// over 11 days behind a silently frozen catalogue, with every cron run recording COMPLETED. An
// exhausted-budget alert fires when it is already too late to act; the warning is the one that
// leaves room to raise the cap, narrow the market, or accept the freeze deliberately.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/inventory/__tests__/inventory-budget-alert.test.ts

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  BUDGET_WARNING_RATIO,
  budgetAlertLevel,
  raiseBudgetAlert,
  type BudgetSnapshot,
} from "../inventory-budget-alert.service";

const snap = (used: number, budget: number | null): BudgetSnapshot => ({
  callsUsedThisCycle: used,
  monthlyCallBudget: budget,
  cycleKey: "2026-09",
});

test("the warning threshold is 80% of the configured budget", () => {
  assert.equal(BUDGET_WARNING_RATIO, 0.8);
});

describe("threshold selection", () => {
  const cases: Array<[string, BudgetSnapshot, string | null]> = [
    ["well under budget", snap(100, 400), null],
    ["just under 80%", snap(319, 400), null],
    ["exactly 80%", snap(320, 400), "WARNING"],
    ["between 80 and 100", snap(399, 400), "WARNING"],
    ["exactly at budget", snap(400, 400), "EXHAUSTED"],
    ["over budget", snap(415, 400), "EXHAUSTED"],
    ["unmetered budget never alerts", snap(9999, null), null],
    ["a deliberate freeze (budget 0) is not a warning", snap(0, 0), null],
    ["a negative budget is treated as a freeze, not a division", snap(5, -1), null],
  ];
  for (const [name, s, expected] of cases) {
    test(name, () => assert.equal(budgetAlertLevel(s), expected));
  }
});

/**
 * Records the raises so dedup can be asserted rather than assumed.
 *
 * PHASE 4 RE-FIXTURE. The deps were a find/create PAIR because the service owned its own
 * dedup, matching on a notification TITLE. The alert is now a §26 exception raised through
 * the single `queue_items` writer, which owns deduplication itself — keyed, indexed and
 * race-safe — so the harness models one function and the key it is called with. A second
 * `findAlert` here would be a weaker copy of a rule the writer already enforces, and the
 * point of routing through it was to stop having two of everything.
 */
function deps(existingKeys: string[] = []) {
  const raised: Array<{ code: string; idempotencyKey: string; detail: string }> = [];
  const keys = new Set(existingKeys);
  return {
    raised,
    raise: async (input: { code: string; idempotencyKey: string; detail: string }) => {
      if (keys.has(input.idempotencyKey)) return { created: false };
      keys.add(input.idempotencyKey);
      raised.push(input);
      return { created: true };
    },
  };
}

test("a warning is raised once, as a §26 exception, and names the cycle", async () => {
  const d = deps();
  assert.equal(await raiseBudgetAlert(snap(320, 400), d), "raised");
  assert.equal(d.raised.length, 1);
  assert.equal(d.raised[0]!.code, "INVENTORY_PROVIDER_BUDGET_CEILING",
    "the §26 register's code — the owner, deadline and return point come from the catalogue");
  assert.match(d.raised[0]!.idempotencyKey, /2026-09/);
  assert.match(d.raised[0]!.detail, /320/, "the detail carries the actual numbers");
  assert.match(d.raised[0]!.detail, /400/);
});

test("the same warning does not fire twice in one cycle", async () => {
  const d = deps();
  await raiseBudgetAlert(snap(320, 400), d);
  assert.equal(await raiseBudgetAlert(snap(330, 400), d), "duplicate");
  assert.equal(d.raised.length, 1, "one warning per cycle, not one per sweep");
});

test("EXHAUSTED still fires after a WARNING already did — they are different events", async () => {
  const d = deps();
  await raiseBudgetAlert(snap(320, 400), d);
  assert.equal(await raiseBudgetAlert(snap(400, 400), d), "raised");
  assert.equal(d.raised.length, 2);
  assert.notEqual(d.raised[0]!.idempotencyKey, d.raised[1]!.idempotencyKey,
    "the LEVEL is in the key, so the exhaustion is not deduped against the warning");
});

test("a new cycle re-arms both alerts", async () => {
  const d = deps();
  await raiseBudgetAlert(snap(320, 400), d);
  assert.equal(
    await raiseBudgetAlert({ callsUsedThisCycle: 320, monthlyCallBudget: 400, cycleKey: "2026-10" }, d),
    "raised",
  );
  assert.equal(d.raised.length, 2);
});

test("below threshold nothing is raised and the writer is never called", async () => {
  let calls = 0;
  const d = { raise: async () => { calls++; return { created: true }; } };
  assert.equal(await raiseBudgetAlert(snap(10, 400), d), "skipped");
  assert.equal(calls, 0, "a healthy budget must not cost a query every sweep");
});

test("a writer failure never propagates — accounting must not break ingestion", async () => {
  const d = { raise: async () => { throw new Error("db down"); } };
  assert.equal(await raiseBudgetAlert(snap(400, 400), d), "failed");
});

test("the warning detail tells Operations what to actually do", async () => {
  const d = deps();
  await raiseBudgetAlert(snap(320, 400), d);
  const detail = d.raised[0]!.detail;
  assert.match(detail, /monthly_call_budget/, "names the knob");
  assert.match(detail, /80%/);
});

test("the code it raises is in the §26 catalogue, with Phase 4 as its raise site", async () => {
  // A raise with an uncatalogued code throws inside raiseException, so a typo here would
  // surface only in production. Assert the entry exists and says this phase wires it.
  const { requireException } = await import("@/lib/services/operations/exception-catalogue");
  const def = requireException("INVENTORY_PROVIDER_BUDGET_CEILING");
  assert.equal(def.ownerRole, "OPERATIONS");
  assert.equal(def.raisedByPhase, 4);
  assert.equal(def.type, "INVENTORY_EXCEPTION");
  assert.ok(def.deadlineHours && def.deadlineHours > 0, "an alert with no clock is a list, not a queue");
});
