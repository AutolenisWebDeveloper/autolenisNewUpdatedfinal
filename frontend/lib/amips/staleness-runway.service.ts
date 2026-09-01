// lib/amips/staleness-runway.service.ts — the I/O half of the runway signal:
// load the servable corpus, compute the runway, and escalate it.
//
// WHY NOT MARK THE CRON RUN FAILED
// The obvious reading of "escalate through cron status" is to throw so the run
// records FAILED. Three reasons that is the wrong mechanism here, in increasing
// order of decisiveness:
//
//   1. It would be untrue. The snapshot work succeeded; only a data condition is
//      concerning. A FAILED row makes a healthy job look broken and trains
//      operators to ignore this cron's failures.
//   2. It would destroy the payload. failCronRun() REPLACES `result` with
//      `{ build }` (cron-monitor.service.ts:143-154), so throwing would discard
//      the runway figures this signal exists to publish.
//   3. SUPERSEDED — it used to be that a FAILED daily cron would not page at all,
//      because detectFailedCrons() demanded 2 failures inside a fixed 180-minute
//      window that a daily cron's runs could never both occupy. That gap has
//      since been fixed: failedStreakThresholdFor() now returns 1 for any cron
//      whose cadence outruns the window, so a daily job failing once DOES alert.
//      Reasons 1 and 2 are unaffected and remain the basis for this decision —
//      they were always the stronger two.
//
// So the run stays COMPLETED with the runway in its result JSONB (queryable, no
// new table), and escalation goes through the platform's actual alerting path —
// createAlertOnce() plus notifyOncall(), the same combination dead-cron.service
// uses for exactly this shape of problem: a scheduled job surfacing a condition
// nobody is watching for.

import { HealthAlertLevel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { notifyOncall } from "@/lib/observability/alert";
import { createAlertOnce } from "@/lib/services/monitoring/health-alert.service";
import { SERVABLE_LIFECYCLE_STATUSES } from "@/lib/amips/tiers";
import {
  computeStalenessRunway,
  runwayAlertBody,
  runwayAlertTitle,
  type RunwaySeverity,
  type StalenessRunway,
} from "@/lib/amips/staleness-runway";

export const RUNWAY_ALERT_SOURCE = "amips-staleness-runway";

/** Severity → platform alert level. P0 is reserved for "dark now". */
export function runwayAlertLevel(r: StalenessRunway): HealthAlertLevel | null {
  switch (r.severity) {
    case "OK":
      return null;
    case "NOTICE":
      return HealthAlertLevel.INFO;
    case "WARN":
      return HealthAlertLevel.P2;
    case "CRITICAL":
      // P0 only once pages are actually returning 404. Before that the platform
      // is serving correctly and the problem is impending, not present.
      return (r.minDaysToWithhold ?? 1) <= 0 ? HealthAlertLevel.P0 : HealthAlertLevel.P1;
  }
}

/** Load the servable corpus and compute its runway. */
export async function loadStalenessRunway(now: number = Date.now()): Promise<StalenessRunway> {
  const pages = await prisma.amipsPage.findMany({
    where: { lifecycleStatus: { in: [...SERVABLE_LIFECYCLE_STATUSES] } },
    select: {
      contentTier: true,
      vehicleDataAsOf: true,
      dealerDataAsOf: true,
      marketDataAsOf: true,
    },
  });
  return computeStalenessRunway(pages, now);
}

/**
 * Compute and escalate. Returns the runway so the caller can put it in the cron
 * result. Alerting is best-effort: it must never fail the host cron's own work.
 */
export async function reportStalenessRunway(now: number = Date.now()): Promise<StalenessRunway> {
  const runway = await loadStalenessRunway(now);

  logger.info(
    `[amips-runway] severity=${runway.severity} minDays=${runway.minDaysToWithhold} ` +
      `first=${runway.firstWithholdDate} cliff=${runway.isSingleDayCliff} ` +
      `servable=${runway.servablePages} within30=${runway.within30}`,
  );

  const level = runwayAlertLevel(runway);
  if (!level) return runway;

  const title = runwayAlertTitle(runway.severity);
  const body = runwayAlertBody(runway);

  try {
    // Idempotent while an identical alert is open; a higher severity carries a
    // different title and therefore still breaks through.
    await createAlertOnce(level, title, body, RUNWAY_ALERT_SOURCE);
  } catch (err) {
    logger.warn("[amips-runway] createAlertOnce failed (continuing):", err);
  }

  // Page for the levels that warrant waking someone.
  if (level === HealthAlertLevel.P0 || level === HealthAlertLevel.P1) {
    notifyOncall(title, {
      source: RUNWAY_ALERT_SOURCE,
      minDaysToWithhold: runway.minDaysToWithhold,
      firstWithholdDate: runway.firstWithholdDate,
      servablePages: runway.servablePages,
      isSingleDayCliff: runway.isSingleDayCliff,
    });
  }

  return runway;
}

export type { RunwaySeverity, StalenessRunway };
