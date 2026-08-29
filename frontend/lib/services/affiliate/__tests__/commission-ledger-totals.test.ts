// M1 — one ledger rule for "earned" money across every surface.
//
// Two reversal mechanisms coexist:
//   • in-place reverse: a PENDING/APPROVED row is flipped to REVERSED, amount
//     stays POSITIVE → it must NOT count as earned;
//   • clawback: the PAID original stays PAID and an offsetting NEGATIVE
//     REVERSED row is appended → the offset MUST count (it nets the original).
//
// The shared rule (decision 4): earned = rows with status PENDING/APPROVED/PAID
// plus REVERSED rows with amountCents < 0. Excluding all REVERSED rows (the old
// affiliate-facing rule) permanently overstates earnings after a clawback;
// excluding only REJECTED (the old admin rule) overstates after an in-place
// reversal. Every aggregation goes through countsTowardEarned /
// ledgerEarnedWhere so both mechanisms net correctly everywhere.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks lib/services/affiliate/__tests__/commission-ledger-totals.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});
mock.module("@/lib/events/emit", {
  namedExports: { emitDomainEvent: async () => {} },
});

// getCommissionSummary aggregates by (status[, amount sign]); the mock routes
// each aggregate call to a sum computed from this seeded ledger so the test
// exercises the REAL grouping/filter arguments the service sends.
type Row = { status: string; amountCents: number; level?: number };
let ledger: Row[];

function matches(row: Row, where: Record<string, unknown>): boolean {
  if (typeof where.status === "string" && row.status !== where.status) return false;
  if (
    where.status &&
    typeof where.status === "object" &&
    Array.isArray((where.status as { in?: string[] }).in) &&
    !(where.status as { in: string[] }).in.includes(row.status)
  ) {
    return false;
  }
  const amt = where.amountCents as { lt?: number; gt?: number } | undefined;
  if (amt?.lt !== undefined && !(row.amountCents < amt.lt)) return false;
  if (amt?.gt !== undefined && !(row.amountCents > amt.gt)) return false;
  if (Array.isArray(where.OR)) {
    if (!(where.OR as Record<string, unknown>[]).some((clause) => matches(row, clause))) return false;
  }
  return true;
}

const prismaMock = {
  commission: {
    aggregate: async ({ where }: { where: Record<string, unknown> }) => ({
      _sum: {
        amountCents: ledger
          .filter((r) => matches(r, where))
          .reduce((s, r) => s + r.amountCents, 0),
      },
    }),
    groupBy: async ({ by, where }: { by: string[]; where: Record<string, unknown> }) => {
      if (!by.includes("level")) throw new Error("test mock only groups by level");
      const rows = ledger.filter((r) => matches(r, where));
      const levels = [...new Set(rows.map((r) => (r as Row & { level?: number }).level ?? 1))];
      return levels.map((lvl) => {
        const ofLevel = rows.filter((r) => ((r as Row & { level?: number }).level ?? 1) === lvl);
        return {
          level: lvl,
          _sum: { amountCents: ofLevel.reduce((s, r) => s + r.amountCents, 0) },
          _count: { id: ofLevel.length },
        };
      });
    },
  },
};
mock.module("@/lib/prisma", { namedExports: { prisma: prismaMock } });

beforeEach(() => {
  ledger = [];
});

async function svc() {
  return import("@/lib/services/affiliate/commission.service");
}

test("countsTowardEarned: PENDING/APPROVED/PAID count; positive REVERSED does not; negative REVERSED does; REJECTED never", async () => {
  const { countsTowardEarned } = await svc();
  assert.equal(countsTowardEarned({ status: "PENDING", amountCents: 100 }), true);
  assert.equal(countsTowardEarned({ status: "APPROVED", amountCents: 100 }), true);
  assert.equal(countsTowardEarned({ status: "PAID", amountCents: 100 }), true);
  // in-place reversal: positive amount, REVERSED status — no longer earned
  assert.equal(countsTowardEarned({ status: "REVERSED", amountCents: 5000 }), false);
  // clawback offset: negative amount — must net the still-PAID original
  assert.equal(countsTowardEarned({ status: "REVERSED", amountCents: -6000 }), true);
  assert.equal(countsTowardEarned({ status: "REJECTED", amountCents: 100 }), false);
  assert.equal(countsTowardEarned({ status: "REJECTED", amountCents: -100 }), false);
});

test("ledgerEarnedWhere selects exactly the rows countsTowardEarned accepts", async () => {
  const { ledgerEarnedWhere, countsTowardEarned } = await svc();
  const rows: Row[] = [
    { status: "PENDING", amountCents: 100 },
    { status: "APPROVED", amountCents: 200 },
    { status: "PAID", amountCents: 6000 },
    { status: "REVERSED", amountCents: 5000 }, // in-place
    { status: "REVERSED", amountCents: -6000 }, // clawback offset
    { status: "REJECTED", amountCents: 300 },
  ];
  const where = ledgerEarnedWhere();
  for (const row of rows) {
    assert.equal(
      matches(row, where as unknown as Record<string, unknown>),
      countsTowardEarned(row),
      `where/predicate disagree for ${row.status} ${row.amountCents}`,
    );
  }
});

test("getCommissionSummary.totalCents nets a clawback to zero (PAID 6000 + REVERSED -6000)", async () => {
  const { getCommissionSummary } = await svc();
  ledger = [
    { status: "PAID", amountCents: 6000 },
    { status: "REVERSED", amountCents: -6000 }, // clawback offset of that PAID row
  ];
  const summary = await getCommissionSummary("aff_1");
  assert.equal(summary.totalCents, 0, "clawed-back money must not count as lifetime earned");
  // the offset nets lifetime earnings but is not "awaiting payout"
  assert.equal(summary.pendingCents, 0);
  assert.equal(summary.paidCents, 6000, "the PAID original is preserved (append-only ledger)");
});

test("getCommissionLevelBreakdown: DB-side groupBy over the WHOLE ledger under the shared rule (M15)", async () => {
  const { getCommissionLevelBreakdown } = await svc();
  ledger = [
    { status: "PAID", amountCents: 6000, level: 1 },
    { status: "PENDING", amountCents: 1000, level: 1 },
    { status: "REVERSED", amountCents: -6000, level: 1 }, // clawback offset — nets
    { status: "REVERSED", amountCents: 500, level: 2 }, // in-place — excluded
    { status: "APPROVED", amountCents: 1200, level: 2 },
    { status: "REJECTED", amountCents: 999, level: 3 }, // excluded
  ];
  const byLevel = await getCommissionLevelBreakdown("aff_1");
  assert.deepEqual(byLevel, [
    { level: 1, total: 1000, count: 3 },
    { level: 2, total: 1200, count: 1 },
    { level: 3, total: 0, count: 0 },
  ]);
});

test("getCommissionSummary.totalCents still excludes in-place reversals and counts live rows", async () => {
  const { getCommissionSummary } = await svc();
  ledger = [
    { status: "PENDING", amountCents: 1000 },
    { status: "APPROVED", amountCents: 2000 },
    { status: "PAID", amountCents: 6000 },
    { status: "REVERSED", amountCents: 5000 }, // in-place reversal — excluded
    { status: "REJECTED", amountCents: 700 }, // never earned
  ];
  const summary = await getCommissionSummary("aff_1");
  assert.equal(summary.totalCents, 9000);
  assert.equal(summary.pendingCents, 3000);
  assert.equal(summary.approvedCents, 2000);
  assert.equal(summary.pendingReviewCents, 1000);
});
