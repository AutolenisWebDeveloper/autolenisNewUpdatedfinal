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
//
// PHASE 4: THE ALERT IS AN EXCEPTION, NOT A NOTIFICATION. §26 requires every exception to name
// an owner, a buyer-visible status, a required action, a deadline and a return point, and to be
// written to `queue_items` — and E26-17 ("Provider budget ceiling -> alert before ceiling") is
// one of the 48. This service used to write a bare `Notification` with `type: "SYSTEM_ALERT"`,
// which carries none of those five and lands in a table nothing routes from. It now raises
// INVENTORY_PROVIDER_BUDGET_CEILING through the single §26 writer, and its own local
// `createAlert` — one of the two duplicate helpers in control/DUP-11 — is gone.
//
// The dedup semantics are UNCHANGED. The old key was the alert title, which carried both the
// level and the cycle key; the new one is an explicit idempotency key carrying the same two
// facts, which `raiseException` treats as strict once-ever. WARNING and EXHAUSTED remain
// different events, both worth seeing, neither repeating every sweep, and both re-arming when
// the cycle rolls.

import { logger } from "@/lib/logger";
import { raiseException } from "@/lib/services/operations/queue-item.service";

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

/**
 * The raise, injectable so the decision can be tested without a database.
 *
 * One function, not the old find/create PAIR: deduplication is `raiseException`'s own
 * responsibility now (it is keyed, indexed and race-safe via a P2002 catch), so a separate
 * `findAlert` here would be a second, weaker copy of a rule the writer already enforces.
 */
export interface AlertDeps {
  raise: (input: {
    code: string;
    idempotencyKey: string;
    detail: string;
  }) => Promise<{ created: boolean }>;
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
  raise: async (input) => {
    const { created } = await raiseException({
      code: input.code,
      idempotencyKey: input.idempotencyKey,
      detail: input.detail,
    });
    return { created };
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

  const raise = deps.raise ?? defaultDeps.raise;
  // Both facts in the key, exactly as the retired title carried them: the LEVEL, because a
  // warning and an exhaustion are different events and both should be seen; and the CYCLE,
  // so each re-arms when the month rolls over.
  const idempotencyKey = `INVENTORY_PROVIDER_BUDGET_CEILING:${level}:${snap.cycleKey}`;

  try {
    const { created } = await raise({
      code: "INVENTORY_PROVIDER_BUDGET_CEILING",
      idempotencyKey,
      detail: `${titleFor(level, snap.cycleKey)}. ${bodyFor(level, snap)}`,
    });
    if (!created) return "duplicate";
    logger.warn(`[inventory-budget] ${titleFor(level, snap.cycleKey)}`);
    return "raised";
  } catch (err) {
    // Never throws. This is accounting; it must not be able to break ingestion.
    logger.warn("[inventory-budget] alert write failed:", err);
    return "failed";
  }
}
