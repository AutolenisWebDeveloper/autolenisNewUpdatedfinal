// lib/services/monitoring/dead-cron.service.ts
//
// Dead-cron detection: a cron that SHOULD have run but hasn't. Reads the latest
// recorded run per cron (one groupBy over cron_job_logs), classifies each entry in
// the CRON_STALENESS registry, and surfaces the OVERDUE ones.
//
// Surfacing (the three approved channels):
//   (C) proactive push — idempotent SYSTEM_ALERT Notification + notifyOncall/Sentry
//   (B) queryable log   — folded into HealthCheckLog.alerts by the health cycle
//   (A) ops widget      — the operations page annotates overdue rows from the registry
//
// Everything here is BEST-EFFORT: a cron_job_logs / notification DB hiccup must
// never throw into the health-check cron. Detection degrades to [] on error;
// reporting degrades to alerted: 0.

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { notifyOncall } from "@/lib/observability/alert";
import { CRON_STALENESS, classifyCronLiveness, type CronLiveness } from "./cron-schedule";

// Per-cron alert title. Idempotency keys on the specific cron (not a constant
// title) so a SECOND cron dying mid-window pages immediately instead of being
// suppressed by the first cron's still-open alert — while a single dead cron
// still alerts at most once per window (no 5-min re-page storm), and a recovering
// cron simply stops without emitting anything.
function deadCronAlertTitle(cronName: string): string {
  return `Dead cron: ${cronName}`;
}

// health-check runs every 5m; without throttling a persistently-dead cron would
// re-page 12×/hour. Suppress duplicate alerts for the SAME cron within this window.
export const DEAD_CRON_ALERT_WINDOW_MINUTES = 60;

/**
 * Classify every registry cron by its most-recent recorded run. One groupBy;
 * degrades to [] (never throws) if the log table is unreachable.
 */
export async function detectDeadCrons(now: Date = new Date()): Promise<CronLiveness[]> {
  const lastRun = new Map<string, Date | null>();
  try {
    const groups = await prisma.cronJobLog.groupBy({
      by: ["cronName"],
      _max: { startedAt: true },
      orderBy: { cronName: "asc" },
    });
    for (const g of groups) lastRun.set(g.cronName, g._max.startedAt ?? null);
  } catch (e) {
    logger.warn("[dead-cron] detectDeadCrons groupBy failed (best-effort):", e);
    return [];
  }
  return Object.keys(CRON_STALENESS).map((cronName) =>
    classifyCronLiveness(cronName, lastRun.get(cronName) ?? null, now),
  );
}

export function overdueCrons(list: CronLiveness[]): CronLiveness[] {
  return list.filter((c) => c.state === "OVERDUE");
}

/**
 * Proactive-push surfacing for OVERDUE crons. Per-cron idempotent within
 * DEAD_CRON_ALERT_WINDOW_MINUTES: each dead cron alerts at most once per window
 * (no 5-min re-page storm), yet a newly-dead cron pages immediately regardless of
 * other still-open alerts. Best-effort: a DB error on one cron is swallowed and
 * does not block the others. Returns the count of fresh alerts raised.
 *
 * NOTE: the phrasing is deliberately "no run recorded" — this detects a cron that
 * did not FIRE (its latest run is stale). A cron that fires but its handler throws
 * still writes a recent (FAILED) run, so it reads as alive here; that failure mode
 * surfaces via the FAILED status on the run itself, not via dead-cron detection.
 */
export async function reportOverdueCrons(
  overdue: CronLiveness[],
  now: Date = new Date(),
): Promise<{ alerted: number }> {
  if (overdue.length === 0) return { alerted: 0 };

  const windowStart = new Date(now.getTime() - DEAD_CRON_ALERT_WINDOW_MINUTES * 60_000);
  let alerted = 0;

  for (const c of overdue) {
    const title = deadCronAlertTitle(c.cronName);
    try {
      const recent = await prisma.notification.findFirst({
        where: { title, type: "SYSTEM_ALERT", createdAt: { gte: windowStart } },
        select: { id: true },
      });
      if (recent) continue;

      await prisma.notification.create({
        data: {
          title,
          body: `Cron '${c.cronName}' is overdue — last run ${c.ageMinutes}m ago, expected within ${c.maxAgeMinutes}m. No run recorded within the expected window; the scheduled trigger may not be firing. Review via /admin/operations.`,
          type: "SYSTEM_ALERT",
          actionUrl: "/admin/operations",
        },
      });
      // Medium-severity notify (dashboard/Slack via Sentry rule); does not page.
      notifyOncall(`Dead cron detected: ${c.cronName}`, {
        cron: c.cronName,
        ageMinutes: c.ageMinutes,
        maxAgeMinutes: c.maxAgeMinutes,
      });
      alerted += 1;
    } catch (e) {
      logger.error(`[dead-cron] reportOverdueCrons failed for ${c.cronName} (best-effort):`, e);
    }
  }

  return { alerted };
}
