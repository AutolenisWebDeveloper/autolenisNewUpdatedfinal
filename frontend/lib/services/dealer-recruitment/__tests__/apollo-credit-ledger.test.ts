// Block B / Apollo — credit ledger: atomic reserve-and-release draw. Injected
// fake prisma models the conditional updateMany (guarded increment) exactly as
// Postgres would, so the concurrency/overspend guarantees are provable offline.
//   npx tsx --test lib/services/dealer-recruitment/__tests__/apollo-credit-ledger.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import {
  drawCredits,
  backfillReserveFloor,
  RESERVE_CREDITS,
} from "../apollo-credit-ledger.service";

interface LedgerRow { id: string; cycleKey: string; capCredits: number; spentCredits: number }

// Fake whose updateMany applies the guarded increment ATOMICALLY (read+check+write
// with no await in between) — the JS single thread then serializes concurrent
// calls exactly as Postgres serializes a conditional UPDATE.
function fakePrisma(row: LedgerRow): { prisma: PrismaClient; row: LedgerRow } {
  const prisma = {
    apolloCreditLedger: {
      findUnique: async ({ where }: { where: { cycleKey: string } }) =>
        where.cycleKey === row.cycleKey ? { ...row } : null,
      updateMany: async ({ where, data }: {
        where: { cycleKey: string; spentCredits?: { lte: number } };
        data: { spentCredits: { increment: number } };
      }) => {
        if (where.cycleKey !== row.cycleKey) return { count: 0 };
        const lte = where.spentCredits?.lte;
        if (lte != null && row.spentCredits > lte) return { count: 0 };
        row.spentCredits += data.spentCredits.increment; // atomic apply
        return { count: 1 };
      },
    },
  } as unknown as PrismaClient;
  return { prisma, row };
}

// ─── reserve/release math ────────────────────────────────────────────────────

test("backfill reserve floor holds the full reserve through day 24, tapers 25→cycle-end", () => {
  assert.equal(backfillReserveFloor(1, 31), RESERVE_CREDITS);
  assert.equal(backfillReserveFloor(24, 31), RESERVE_CREDITS);
  assert.equal(backfillReserveFloor(25, 31), RESERVE_CREDITS); // release begins
  assert.ok(backfillReserveFloor(28, 31) < RESERVE_CREDITS && backfillReserveFloor(28, 31) > 0); // tapering
  assert.equal(backfillReserveFloor(31, 31), 0); // fully released at cycle end
});

// ─── atomic draw: no overspend under concurrency (the money guarantee) ────────

test("two concurrent draws for the LAST credit: exactly one succeeds, never overspends", async () => {
  const { prisma, row } = fakePrisma({ id: "l1", cycleKey: "2026-08", capCredits: 100, spentCredits: 99 });
  const p = { cycleKey: "2026-08", cost: 1, consumer: "live" as const, day: 10, daysInCycle: 31 };
  const [a, b] = await Promise.all([drawCredits(p, { prisma }), drawCredits(p, { prisma })]);
  assert.equal([a.drawn, b.drawn].filter(Boolean).length, 1, "exactly one draw wins");
  assert.equal(row.spentCredits, 100, "balance never exceeds cap");
});

test("a retried draw after the cap is reached is refused (fail closed, no overspend)", async () => {
  const { prisma, row } = fakePrisma({ id: "l1", cycleKey: "2026-08", capCredits: 100, spentCredits: 100 });
  const r = await drawCredits({ cycleKey: "2026-08", cost: 1, consumer: "live", day: 10, daysInCycle: 31 }, { prisma });
  assert.equal(r.drawn, false);
  assert.equal(row.spentCredits, 100);
});

// ─── reserve enforcement: backfill can't touch the live reserve before day 25 ─

test("backfill is blocked at the reserve floor before day 25, while live can still draw", async () => {
  // cap 1000, already 500 spent → only the reserved 500 remains.
  const { prisma, row } = fakePrisma({ id: "l1", cycleKey: "2026-08", capCredits: 1000, spentCredits: 500 });
  const backfill = await drawCredits({ cycleKey: "2026-08", cost: 1, consumer: "backfill", day: 10, daysInCycle: 31 }, { prisma });
  assert.equal(backfill.drawn, false, "backfill cannot draw into the reserved 500 before day 25");
  const live = await drawCredits({ cycleKey: "2026-08", cost: 1, consumer: "live", day: 10, daysInCycle: 31 }, { prisma });
  assert.equal(live.drawn, true, "live demand can always draw against the reserve");
  assert.equal(row.spentCredits, 501);
});

test("no ledger row for the cycle → fail closed", async () => {
  const { prisma } = fakePrisma({ id: "l1", cycleKey: "2026-08", capCredits: 100, spentCredits: 0 });
  const r = await drawCredits({ cycleKey: "2099-01", cost: 1, consumer: "live", day: 10, daysInCycle: 31 }, { prisma });
  assert.equal(r.drawn, false);
});
