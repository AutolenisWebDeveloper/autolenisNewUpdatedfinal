// Block B / Apollo — reserve-and-release monthly credit ledger.
//
// One ApolloCreditLedger row per billing cycle. The draw is a single conditional
// updateMany guarded on spentCredits (increment is atomic in Postgres), so two
// concurrent or retried draws can NEVER overspend the cap — the second draw's
// WHERE re-evaluates against the first's committed spentCredits and matches zero
// rows. Fail-closed: a missing ledger or an over-cap draw returns { drawn:false }.
//
// Reserve/release: RESERVE_CREDITS are held for LIVE demand through day 24 so
// backfill (B′) can't drain the last of the budget before live requests get it;
// from day 25 the reserve tapers to zero at cycle end. Live demand is never
// floored — it can always draw against the whole cap.

import type { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";
import { prisma as defaultPrisma } from "@/lib/prisma";

export const RESERVE_CREDITS = 500;
export const RESERVE_RELEASE_DAY = 25;

export type CreditConsumer = "live" | "backfill";

export interface LedgerDeps {
  prisma: PrismaClient;
}

/**
 * Credits that must remain untouched by BACKFILL on a given cycle day. Full
 * reserve through day 24; linear taper to 0 across days 25..cycle-end. Live
 * demand ignores this (floor 0) — it can always draw against the whole cap.
 */
export function backfillReserveFloor(day: number, daysInCycle: number): number {
  if (day <= RESERVE_RELEASE_DAY - 1) return RESERVE_CREDITS;
  if (day >= daysInCycle) return 0;
  const span = daysInCycle - RESERVE_RELEASE_DAY;
  if (span <= 0) return 0;
  return Math.round((RESERVE_CREDITS * (daysInCycle - day)) / span);
}

export interface DrawParams {
  cycleKey: string;
  cost: number;
  consumer: CreditConsumer;
  day: number;
  daysInCycle: number;
}

export interface DrawResult {
  drawn: boolean;
  reason?: "no_ledger" | "insufficient" | "bad_cost";
}

/**
 * Atomically draw `cost` credits for the cycle, respecting the backfill reserve
 * floor. Returns { drawn:true } only when the credits were actually deducted.
 */
export async function drawCredits(
  params: DrawParams,
  deps?: Partial<LedgerDeps>,
): Promise<DrawResult> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const { cycleKey, cost, consumer, day, daysInCycle } = params;

  if (!Number.isFinite(cost) || cost <= 0) return { drawn: false, reason: "bad_cost" };

  const ledger = await prisma.apolloCreditLedger.findUnique({ where: { cycleKey } });
  if (!ledger) return { drawn: false, reason: "no_ledger" };

  const floor = consumer === "backfill" ? backfillReserveFloor(day, daysInCycle) : 0;
  // Highest pre-existing spent that still leaves room for `cost` above the floor.
  const maxSpent = ledger.capCredits - cost - floor;
  if (maxSpent < 0) return { drawn: false, reason: "insufficient" };

  // Atomic conditional draw: only succeeds if current spent is within budget.
  const res = await prisma.apolloCreditLedger.updateMany({
    where: { cycleKey, spentCredits: { lte: maxSpent } },
    data: { spentCredits: { increment: cost } },
  });
  return res.count === 1 ? { drawn: true } : { drawn: false, reason: "insufficient" };
}

/**
 * Refund `cost` credits (best-effort) — used when a draw succeeded but the reveal
 * then failed, so the budget isn't permanently consumed for a no-op.
 */
export async function refundCredits(
  cycleKey: string,
  cost: number,
  deps?: Partial<LedgerDeps>,
): Promise<void> {
  const prisma = deps?.prisma ?? defaultPrisma;
  if (cost <= 0) return;
  try {
    // Guarded so a mis-paired refund can never drive spentCredits negative (which
    // would inflate available budget). Only refunds credits that were actually spent.
    await prisma.apolloCreditLedger.updateMany({
      where: { cycleKey, spentCredits: { gte: cost } },
      data: { spentCredits: { decrement: cost } },
    });
  } catch (err) {
    logger.warn(`[apollo-ledger] refund failed for ${cycleKey}:`, err);
  }
}

/**
 * Credits a consumer may still draw this cycle (cap − spent − floor, ≥ 0). 0 when
 * no ledger row exists. Used by the backfill (B′) to stop at budget exhaustion
 * without claiming/releasing a reveal per exhausted rooftop.
 */
export async function remainingCredits(
  cycleKey: string,
  consumer: CreditConsumer,
  now: Date,
  deps?: Partial<LedgerDeps>,
): Promise<number> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const ledger = await prisma.apolloCreditLedger.findUnique({ where: { cycleKey } });
  if (!ledger) return 0;
  const floor = consumer === "backfill" ? backfillReserveFloor(now.getUTCDate(), daysInCycleFor(now)) : 0;
  return Math.max(0, ledger.capCredits - ledger.spentCredits - floor);
}

/** "YYYY-MM" cycle key for a date. Caller passes the date (never new Date() here). */
export function cycleKeyFor(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function daysInCycleFor(date: Date): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * Ensure a ledger row exists for the cycle with the given cap. The cap is set on
 * creation only (from the live probe) — an existing row's cap is never changed
 * here. Returns the row.
 */
export async function getOrCreateCycle(
  cycleKey: string,
  capCredits: number,
  deps?: Partial<LedgerDeps>,
): Promise<{ id: string; cycleKey: string; capCredits: number; spentCredits: number }> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const existing = await prisma.apolloCreditLedger.findUnique({ where: { cycleKey } });
  if (existing) return existing;
  try {
    return await prisma.apolloCreditLedger.create({ data: { cycleKey, capCredits, spentCredits: 0 } });
  } catch {
    // Lost a create race — read the row the winner created.
    const row = await prisma.apolloCreditLedger.findUnique({ where: { cycleKey } });
    if (row) return row;
    throw new Error(`apollo ledger create/read failed for ${cycleKey}`);
  }
}

/**
 * Default monthly cap for a new cycle: 2,000 lead credits — headroom under the
 * account's 2,500 Apollo lead-credit plan limit so manual/dashboard use isn't
 * starved. Overridable via APOLLO_CYCLE_CAP_CREDITS.
 */
export const DEFAULT_CYCLE_CAP_CREDITS = 2000;

function resolveCycleCap(): number {
  const raw = Number(process.env.APOLLO_CYCLE_CAP_CREDITS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_CYCLE_CAP_CREDITS;
}

/**
 * Ensure THIS cycle's ledger row exists (idempotent), so the paid tier never
 * fails closed for a whole month just because nobody manually seeded the new
 * calendar-month row. Safe to run on any cadence — getOrCreateCycle never changes
 * an existing row's cap. Caller passes `now` (never new Date() here). Returns the row.
 */
export async function ensureCurrentCycleLedger(
  now: Date,
  deps?: Partial<LedgerDeps>,
): Promise<{ id: string; cycleKey: string; capCredits: number; spentCredits: number }> {
  return getOrCreateCycle(cycleKeyFor(now), resolveCycleCap(), deps);
}
