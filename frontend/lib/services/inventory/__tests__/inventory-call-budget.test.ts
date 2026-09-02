// Monthly MarketCheck call ledger.
//
// There was no call accounting anywhere before this. 28 calls/day against a 500/month plan
// produced 191 consecutive HTTP 429 runs (2026-08-24..31) behind a silently frozen catalogue.
//
//   npx tsx --test lib/services/inventory/__tests__/inventory-call-budget.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  cycleKeyFor, rollCycleForward, tryConsumeCall, makeCallBudget, makeStaticBudget,
} from "@/lib/services/inventory/inventory-call-budget.service";

/** A ledger double that behaves like Postgres: the conditional updateMany only matches
 *  when the guard holds, and the increment is applied atomically to committed state. */
function ledger(initial: { budgetCycleKey: string | null; callsUsedThisCycle: number }) {
  const row = { ...initial };
  const calls: Array<Record<string, unknown>> = [];
  return {
    row,
    calls,
    client: {
      inventorySource: {
        async updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }) {
          calls.push(args);
          const w = args.where as Record<string, any>;

          // Rollover shape: OR [ key null, key < cycleKey ]
          if (Array.isArray(w.OR)) {
            const target = (args.data as Record<string, any>).budgetCycleKey as string;
            const matches = row.budgetCycleKey === null || row.budgetCycleKey < target;
            if (!matches) return { count: 0 };
            row.budgetCycleKey = target;
            row.callsUsedThisCycle = 0;
            return { count: 1 };
          }

          // Draw shape: key equality + callsUsedThisCycle lte
          if (w.budgetCycleKey !== row.budgetCycleKey) return { count: 0 };
          const cap = w.callsUsedThisCycle?.lte;
          if (typeof cap === "number" && row.callsUsedThisCycle > cap) return { count: 0 };
          row.callsUsedThisCycle += 1;
          return { count: 1 };
        },
        async findUnique() { return row; },
      },
    },
  };
}

test("cycleKeyFor is UTC YYYY-MM, so lexicographic order is chronological", () => {
  assert.equal(cycleKeyFor(new Date("2026-09-02T18:00:00Z")), "2026-09");
  assert.equal(cycleKeyFor(new Date("2026-01-01T00:00:00Z")), "2026-01");
  // The boundary that makes UTC matter: 23:30 on the 31st in a negative-offset zone is
  // still the next month in UTC. The ledger must not straddle two definitions of "month".
  assert.equal(cycleKeyFor(new Date("2026-09-01T00:30:00Z")), "2026-09");
  assert.ok("2026-08" < "2026-09" && "2026-09" < "2026-10");
});

test("a draw is refused at the cap, and the counter never exceeds the budget", async () => {
  const l = ledger({ budgetCycleKey: "2026-09", callsUsedThisCycle: 399 });
  assert.equal(await tryConsumeCall("src_1", "2026-09", 400, { prisma: l.client }), true);
  assert.equal(l.row.callsUsedThisCycle, 400);
  assert.equal(await tryConsumeCall("src_1", "2026-09", 400, { prisma: l.client }), false,
    "the 401st call must be refused");
  assert.equal(l.row.callsUsedThisCycle, 400, "a refused draw must not increment");
});

test("two sequential draws at cap-1 authorise exactly one", async () => {
  const l = ledger({ budgetCycleKey: "2026-09", callsUsedThisCycle: 9 });
  const a = await tryConsumeCall("src_1", "2026-09", 10, { prisma: l.client });
  const b = await tryConsumeCall("src_1", "2026-09", 10, { prisma: l.client });
  assert.deepEqual([a, b], [true, false]);
  assert.equal(l.row.callsUsedThisCycle, 10);
});

test("a draw against the WRONG cycle is refused (never spends another month's budget)", async () => {
  const l = ledger({ budgetCycleKey: "2026-08", callsUsedThisCycle: 0 });
  assert.equal(await tryConsumeCall("src_1", "2026-09", 400, { prisma: l.client }), false);
});

test("ROLL FORWARD ONLY: an older cycle rolls, a newer one is never rewound", async () => {
  const stale = ledger({ budgetCycleKey: "2026-08", callsUsedThisCycle: 380 });
  await rollCycleForward("src_1", "2026-09", { prisma: stale.client });
  assert.equal(stale.row.budgetCycleKey, "2026-09");
  assert.equal(stale.row.callsUsedThisCycle, 0, "a new month starts at zero");

  // The defect this guards: a run holding a stale `now` across the boundary must not
  // rewind the key and hand back a month's already-recorded spend.
  const current = ledger({ budgetCycleKey: "2026-09", callsUsedThisCycle: 120 });
  await rollCycleForward("src_1", "2026-08", { prisma: current.client });
  assert.equal(current.row.budgetCycleKey, "2026-09", "the key must not move backwards");
  assert.equal(current.row.callsUsedThisCycle, 120, "recorded spend must survive");
});

test("a NULL cycle key rolls over on first use", async () => {
  const l = ledger({ budgetCycleKey: null, callsUsedThisCycle: 0 });
  await rollCycleForward("src_1", "2026-09", { prisma: l.client });
  assert.equal(l.row.budgetCycleKey, "2026-09");
});

test("FAIL CLOSED: an unreadable ledger refuses the call rather than waving it through", async () => {
  const broken = {
    inventorySource: {
      async updateMany(): Promise<{ count: number }> { throw new Error("connection reset"); },
      async findUnique() { return null; },
    },
  };
  assert.equal(await tryConsumeCall("src_1", "2026-09", 400, { prisma: broken }), false);
});

test("a zero budget freezes spend; a missing sourceId refuses", async () => {
  const l = ledger({ budgetCycleKey: "2026-09", callsUsedThisCycle: 0 });
  assert.equal(await tryConsumeCall("src_1", "2026-09", 0, { prisma: l.client }), false);
  assert.equal(await tryConsumeCall(null, "2026-09", 400, { prisma: l.client }), false);
  assert.equal(l.row.callsUsedThisCycle, 0);
});

test("a null budget is unmetered — reserved for non-MarketCheck feeds", async () => {
  const l = ledger({ budgetCycleKey: "2026-09", callsUsedThisCycle: 0 });
  assert.equal(await tryConsumeCall("src_1", "2026-09", null, { prisma: l.client }), true);
  assert.equal(l.calls.length, 0, "an unmetered draw must not touch the ledger at all");
});

test("makeCallBudget bounds the sweep even when the ledger would authorise more", async () => {
  const l = ledger({ budgetCycleKey: "2026-09", callsUsedThisCycle: 0 });
  const budget = makeCallBudget("src_1", "2026-09", 400, 10, { prisma: l.client });
  for (let i = 0; i < 10; i++) {
    assert.equal(await budget.acquire(), true, `call ${i + 1} of 10`);
  }
  assert.equal(await budget.acquire(), false, "the compiled per-sweep grant is a hard second bound");
  assert.equal(budget.spent(), 10);
  assert.equal(l.row.callsUsedThisCycle, 10, "exactly ten were drawn from the monthly ledger");
});

test("makeStaticBudget authorises exactly its grant and touches no delegate", async () => {
  const budget = makeStaticBudget(3);
  assert.deepEqual(
    [await budget.acquire(), await budget.acquire(), await budget.acquire(), await budget.acquire()],
    [true, true, true, false],
  );
  assert.equal(budget.spent(), 3);
});

test("ARITHMETIC: one daily sweep at the cap stays inside the provider allowance", () => {
  const perSweep = 10;
  const worstCaseMonth = perSweep * 31;
  assert.equal(worstCaseMonth, 310);
  assert.ok(worstCaseMonth < 400, "inside the ledger cap");
  assert.ok(400 < 500, "and the ledger cap is inside the provider cap, with headroom");
  // The old shape, for the record: 24 hourly + 4 six-hourly = 28/day.
  assert.ok(28 * 30 > 500, "the previous cadence exceeded the provider cap on its own");
});
