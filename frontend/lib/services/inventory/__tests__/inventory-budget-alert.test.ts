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

/** Records notification reads and writes so dedup can be asserted rather than assumed. */
function deps(existingTitles: string[] = []) {
  const created: Array<{ title: string; body: string; type: string }> = [];
  const titles = new Set(existingTitles);
  return {
    created,
    findAlert: async (title: string) => (titles.has(title) ? { id: "n1" } : null),
    createAlert: async (a: { title: string; body: string; type: string }) => {
      titles.add(a.title);
      created.push(a);
    },
  };
}

test("a warning is raised once and names the cycle", async () => {
  const d = deps();
  assert.equal(await raiseBudgetAlert(snap(320, 400), d), "raised");
  assert.equal(d.created.length, 1);
  assert.match(d.created[0]!.title, /2026-09/);
  assert.equal(d.created[0]!.type, "SYSTEM_ALERT");
  assert.match(d.created[0]!.body, /320/, "the body carries the actual numbers");
  assert.match(d.created[0]!.body, /400/);
});

test("the same warning does not fire twice in one cycle", async () => {
  const d = deps();
  await raiseBudgetAlert(snap(320, 400), d);
  assert.equal(await raiseBudgetAlert(snap(330, 400), d), "duplicate");
  assert.equal(d.created.length, 1, "one warning per cycle, not one per sweep");
});

test("EXHAUSTED still fires after a WARNING already did — they are different events", async () => {
  const d = deps();
  await raiseBudgetAlert(snap(320, 400), d);
  assert.equal(await raiseBudgetAlert(snap(400, 400), d), "raised");
  assert.equal(d.created.length, 2);
  assert.notEqual(d.created[0]!.title, d.created[1]!.title);
});

test("a new cycle re-arms both alerts", async () => {
  const d = deps();
  await raiseBudgetAlert(snap(320, 400), d);
  assert.equal(
    await raiseBudgetAlert({ callsUsedThisCycle: 320, monthlyCallBudget: 400, cycleKey: "2026-10" }, d),
    "raised",
  );
  assert.equal(d.created.length, 2);
});

test("below threshold nothing is written and nothing is read", async () => {
  let reads = 0;
  const d = { ...deps(), findAlert: async () => { reads++; return null; } };
  assert.equal(await raiseBudgetAlert(snap(10, 400), d), "skipped");
  assert.equal(reads, 0, "a healthy budget must not cost a query every sweep");
});

test("an alert-store failure never propagates — accounting must not break ingestion", async () => {
  const d = {
    findAlert: async () => { throw new Error("db down"); },
    createAlert: async () => {},
  };
  assert.equal(await raiseBudgetAlert(snap(400, 400), d), "failed");
});

test("the warning body tells Operations what to actually do", async () => {
  const d = deps();
  await raiseBudgetAlert(snap(320, 400), d);
  const body = d.created[0]!.body;
  assert.match(body, /monthly_call_budget/, "names the knob");
  assert.match(body, /80%/);
});
