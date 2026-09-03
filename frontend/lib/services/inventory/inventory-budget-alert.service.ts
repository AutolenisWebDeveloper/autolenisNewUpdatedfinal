// lib/services/inventory/inventory-budget-alert.service.ts
//
// Tell Operations the provider call budget is running out while there is still time to act.
//
// The failure this exists to prevent already happened: 305 consecutive rejected calls over 11
// days behind a catalogue that had silently frozen, with every cron run recording COMPLETED. An
// exhausted-budget alert fires when the month is already lost. The 80% warning is the one that
// leaves room to raise the cap, narrow the swept market, or accept the freeze deliberately.
//
// One primitive, two thresholds — the exhausted alert the orchestrator already raised is now a
// level of this, not a second copy of the dedup logic.

import { logger } from "@/lib/logger";
import { prisma as defaultPrisma } from "@/lib/prisma";

/** Warn once the cycle has spent this share of its budget. */
export const BUDGET_WARNING_RATIO = 0.8;

export type BudgetAlertLevel = "WARNING" | "EXHAUSTED";

export interface BudgetSnapshot {
  callsUsedThisCycle: number;
  /** `null` means unmetered — deliberately no cap, so nothing to warn about. */
  monthlyCallBudget: number | null;
  /** UTC "YYYY-MM". Scopes dedup so each cycle re-arms both alerts. */
  cycleKey: string;
}

export interface AlertDeps {
  findAlert: (title: string) => Promise<{ id: string } | null>;
  createAlert: (a: { title: string; body: string; type: string }) => Promise<void>;
}

/**
 * Which alert this snapshot warrants, if any.
 *
 * A budget of zero or less is a DELIBERATE freeze — the documented no-deploy kill switch — not a
 * quota emergency. Warning about it every sweep would train Operations to ignore the channel,
 * and the sweep already reports BUDGET_EXHAUSTED as its own outcome. It also keeps the ratio
 * from being a division by zero.
 */
export function budgetAlertLevel(snap: BudgetSnapshot): BudgetAlertLevel | null {
  const budget = snap.monthlyCallBudget;
  if (budget == null || !Number.isFinite(budget) || budget <= 0) return null;
  const ratio = snap.callsUsedThisCycle / budget;
  if (ratio >= 1) return "EXHAUSTED";
  if (ratio >= BUDGET_WARNING_RATIO) return "WARNING";
  return null;
}

function titleFor(level: BudgetAlertLevel, cycleKey: string): string {
  return level === "EXHAUSTED"
    ? `Inventory call budget exhausted (${cycleKey})`
    : `Inventory call budget at ${Math.round(BUDGET_WARNING_RATIO * 100)}% (${cycleKey})`;
}

function bodyFor(level: BudgetAlertLevel, snap: BudgetSnapshot): string {
  const { callsUsedThisCycle: used, monthlyCallBudget: budget, cycleKey } = snap;
  if (level === "EXHAUSTED") {
    return (
      `The MarketCheck monthly call budget for ${cycleKey} is spent (${used} of ${budget}), so the ` +
      `inventory sweep makes no provider calls and the catalogue will not refresh until the cycle ` +
      `rolls over. Raise inventory_sources.monthly_call_budget only if the provider plan allows ` +
      `it — the cap exists because 28 calls/day previously produced 191 consecutive HTTP 429 runs.`
    );
  }
  return (
    `The MarketCheck call budget for ${cycleKey} has passed ${Math.round(BUDGET_WARNING_RATIO * 100)}%: ` +
    `${used} of ${budget} calls used. At the current cadence the catalogue will stop refreshing ` +
    `before the cycle rolls over. Act now rather than after the freeze: raise ` +
    `inventory_sources.monthly_call_budget if the provider plan allows it, narrow the swept ` +
    `market (center_zip / radius_miles / filters) so each call returns more of what buyers want, ` +
    `or accept the freeze knowingly. Setting monthly_call_budget to 0 stops spend without a deploy.`
  );
}

const defaultDeps: AlertDeps = {
  findAlert: (title) =>
    defaultPrisma.notification.findFirst({
      where: { title, type: "SYSTEM_ALERT" },
      select: { id: true },
    }),
  createAlert: async (a) => {
    await defaultPrisma.notification.create({
      data: { title: a.title, body: a.body, type: "SYSTEM_ALERT" },
    });
  },
};

export type AlertOutcome = "raised" | "duplicate" | "skipped" | "failed";

/**
 * Raise the budget alert this snapshot warrants, at most once per cycle per level.
 *
 * Deduped on the title, which carries both the level and the cycle key: WARNING and EXHAUSTED
 * are different events and both should be seen, but neither should repeat every sweep.
 *
 * Never throws. This is accounting; it must not be able to break ingestion.
 */
export async function raiseBudgetAlert(
  snap: BudgetSnapshot,
  deps: Partial<AlertDeps> = {},
): Promise<AlertOutcome> {
  const level = budgetAlertLevel(snap);
  // Return before touching the store: a healthy budget must not cost a query every sweep.
  if (!level) return "skipped";

  const findAlert = deps.findAlert ?? defaultDeps.findAlert;
  const createAlert = deps.createAlert ?? defaultDeps.createAlert;
  const title = titleFor(level, snap.cycleKey);

  try {
    if (await findAlert(title)) return "duplicate";
    await createAlert({ title, body: bodyFor(level, snap), type: "SYSTEM_ALERT" });
    logger.warn(`[inventory-budget] ${title}`);
    return "raised";
  } catch (err) {
    logger.warn("[inventory-budget] alert write failed:", err);
    return "failed";
  }
}
