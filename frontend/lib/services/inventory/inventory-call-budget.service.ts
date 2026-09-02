// lib/services/inventory/inventory-call-budget.service.ts
//
// A monthly provider-call ledger kept on the inventory_sources row.
//
// Before this file there was NO call accounting anywhere. 28 calls/day against a
// 500/month plan produced 191 consecutive runs answered "MarketCheck HTTP 429: Too Many
// Requests" (2026-08-24 05:00 .. 2026-08-31 00:01, verified read-only) behind a catalogue
// that had silently frozen a week earlier.
//
// Design notes that are load-bearing, not incidental:
//
//   DRAW IMMEDIATELY BEFORE THE FETCH, NEVER RESERVE-THEN-REFUND. acquire() is the last
//   statement before every HTTP call, so there is no drawn-but-not-dispatched state and
//   therefore no refund surface at all. A dispatched request that comes back 429 was still
//   billed upstream, so refunding it is the unsafe direction.
//
//   ROLL FORWARD ONLY. The cycle key is "YYYY-MM" in UTC, where lexicographic order IS
//   chronological order. The rollover is guarded on `budgetCycleKey < cycleKey`, so a run
//   holding a stale `now` across a month boundary can never rewind the key and zero the new
//   month's recorded spend.
//
//   NO ROLLOVER CRON. Rollover is lazy, on first draw of a new cycle. A missed scheduled
//   rollover would fail the whole month closed — which is precisely why apollo-ledger-rollover
//   exists as a separate cron and why this ledger deliberately does not copy that shape.

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export interface CallBudget {
  /** Draw exactly one call. Returns false when the budget refuses — never throws. */
  acquire(): Promise<boolean>;
  /** How many calls this budget has authorised so far in this process. */
  spent(): number;
}

/** "YYYY-MM" in UTC. The caller always supplies the date — never `new Date()` in here, so
 *  a run's cycle is decided once, at its start, rather than drifting mid-walk. */
export function cycleKeyFor(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

interface SourceDelegate {
  updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  findUnique(args: { where: { id: string }; select: Record<string, boolean> }): Promise<unknown>;
}
type Db = { inventorySource: SourceDelegate };

function resolveDb(prisma?: PrismaClient | Db): Db {
  return (prisma ?? defaultPrisma) as unknown as Db;
}

/**
 * Advance the source's budget cycle, zeroing the counter, if and only if the stored key is
 * NULL or strictly older than `cycleKey`.
 *
 * The `lt` guard is the whole point. Without it, two runs racing across a month boundary —
 * or one run built from a stale clock — could set the key backwards and reset a counter that
 * had already recorded real spend, handing back a full month's budget inside one month.
 */
export async function rollCycleForward(
  sourceId: string,
  cycleKey: string,
  deps?: { prisma?: PrismaClient | Db },
): Promise<void> {
  const db = resolveDb(deps?.prisma);
  try {
    await db.inventorySource.updateMany({
      where: {
        id: sourceId,
        OR: [{ budgetCycleKey: null }, { budgetCycleKey: { lt: cycleKey } }],
      },
      data: { budgetCycleKey: cycleKey, callsUsedThisCycle: 0 },
    });
  } catch (e) {
    // A schema gap (migration unapplied) is expected here; the caller falls back to a
    // static in-process budget, which is still bounded by MAX_CALLS_PER_SWEEP.
    logger.warn("[inventory-budget] cycle rollover skipped:", e);
  }
}

/**
 * Atomically draw ONE call against the cycle budget.
 *
 * Follows the proven in-repo pattern (apollo-credit-ledger.service.ts drawCredits): read
 * nothing, write conditionally. The `callsUsedThisCycle: { lte: budget - 1 }` guard plus
 * Postgres's atomic increment means two concurrent draws at the cap cannot both succeed —
 * the second re-evaluates against committed state and matches zero rows.
 *
 * Fail-closed: a missing row, a wrong cycle, an over-cap counter, or any error returns false.
 */
export async function tryConsumeCall(
  sourceId: string | null,
  cycleKey: string,
  budget: number | null,
  deps?: { prisma?: PrismaClient | Db },
): Promise<boolean> {
  // null budget = unmetered. Reserved for non-MarketCheck (CUSTOM dealer feed) sources;
  // resolveMonthlyBudget never returns null for a metered provider.
  if (budget === null) return true;
  if (!sourceId) return false;
  if (!Number.isFinite(budget) || budget <= 0) return false;

  const db = resolveDb(deps?.prisma);
  try {
    const res = await db.inventorySource.updateMany({
      where: {
        id: sourceId,
        budgetCycleKey: cycleKey,
        callsUsedThisCycle: { lte: budget - 1 },
      },
      data: { callsUsedThisCycle: { increment: 1 } },
    });
    return res.count === 1;
  } catch (e) {
    // Fail CLOSED. An unreadable ledger must stop spending, not wave it through — the
    // failure mode this whole file exists to prevent is an unbounded spend.
    logger.error("[inventory-budget] draw failed, refusing the call:", e);
    return false;
  }
}

/** Calls left in the cycle, or null when it cannot be determined. */
export async function remainingCalls(
  sourceId: string,
  cycleKey: string,
  deps?: { prisma?: PrismaClient | Db },
): Promise<number | null> {
  const db = resolveDb(deps?.prisma);
  try {
    const row = (await db.inventorySource.findUnique({
      where: { id: sourceId },
      select: { monthlyCallBudget: true, callsUsedThisCycle: true, budgetCycleKey: true },
    })) as { monthlyCallBudget: number | null; callsUsedThisCycle: number; budgetCycleKey: string | null } | null;
    if (!row || row.monthlyCallBudget === null) return null;
    const used = row.budgetCycleKey === cycleKey ? row.callsUsedThisCycle : 0;
    return Math.max(0, row.monthlyCallBudget - used);
  } catch {
    return null;
  }
}

/**
 * A budget backed by the DB ledger, wrapped in a process-local ceiling.
 *
 * `granted` is a second, independent bound: even a broken or hostile ledger that authorised
 * every draw could not push this sweep past the compiled per-sweep cap.
 */
export function makeCallBudget(
  sourceId: string | null,
  cycleKey: string,
  budget: number | null,
  granted: number,
  deps?: { prisma?: PrismaClient | Db },
): CallBudget {
  let used = 0;
  return {
    async acquire() {
      if (used >= granted) return false;
      const ok = await tryConsumeCall(sourceId, cycleKey, budget, deps);
      if (ok) used++;
      return ok;
    },
    spent: () => used,
  };
}

/**
 * An in-process budget that touches no Prisma delegate. Used when config came from env
 * (the migration is not applied yet, so the ledger columns do not exist), and in tests.
 */
export function makeStaticBudget(granted: number): CallBudget {
  let used = 0;
  return {
    async acquire() {
      if (used >= granted) return false;
      used++;
      return true;
    },
    spent: () => used,
  };
}
