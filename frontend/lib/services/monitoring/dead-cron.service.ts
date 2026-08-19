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
// reporting degrades to { alerted: false }.

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { notifyOncall } from "@/lib/observability/alert";
import { CRON_STALENESS, classifyCronLiveness, type CronLiveness } from "./cron-schedule";

const DEAD_CRON_ALERT_TITLE = "Dead cron detected";

// health-check runs every 5m; without throttling a persistently-dead cron would
// re-page 12×/hour. Suppress duplicate alerts within this window.
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
 * Proactive-push surfacing for OVERDUE crons. Idempotent within
 * DEAD_CRON_ALERT_WINDOW_MINUTES so a still-dead cron does not re-page every tick.
 * Best-effort: swallows any DB error and reports it did not alert.
 */
export async function reportOverdueCrons(
  overdue: CronLiveness[],
  now: Date = new Date(),
): Promise<{ alerted: boolean }> {
  if (overdue.length === 0) return { alerted: false };

  const names = overdue.map((c) => c.cronName).sort();
  const detail = overdue
    .map((c) => `${c.cronName} (last run ${c.ageMinutes}m ago, expected within ${c.maxAgeMinutes}m)`)
    .join("; ");

  try {
    const windowStart = new Date(now.getTime() - DEAD_CRON_ALERT_WINDOW_MINUTES * 60_000);
    const recent = await prisma.notification.findFirst({
      where: { title: DEAD_CRON_ALERT_TITLE, type: "SYSTEM_ALERT", createdAt: { gte: windowStart } },
      select: { id: true },
    });
    if (recent) return { alerted: false };

    await prisma.notification.create({
      data: {
        title: DEAD_CRON_ALERT_TITLE,
        body: `Overdue cron(s): ${detail}. No run recorded within the expected window — the scheduler or handler may be failing. Review via /admin/operations.`,
        type: "SYSTEM_ALERT",
        actionUrl: "/admin/operations",
      },
    });
    // Medium-severity notify (dashboard/Slack via Sentry rule); does not page.
    notifyOncall(`Dead cron(s) detected: ${names.join(", ")}`, {
      overdue: overdue.map((c) => ({ cron: c.cronName, ageMinutes: c.ageMinutes, maxAgeMinutes: c.maxAgeMinutes })),
    });
    return { alerted: true };
  } catch (e) {
    logger.error("[dead-cron] reportOverdueCrons failed (best-effort):", e);
    return { alerted: false };
  }
}
