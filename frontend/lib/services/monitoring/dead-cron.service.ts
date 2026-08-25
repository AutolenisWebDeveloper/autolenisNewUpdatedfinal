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

// ── Failing-cron detection ───────────────────────────────────────────────────
//
// The dead-cron detector above finds crons that did not FIRE. It deliberately
// reads a cron that fired-but-threw as "alive" (a recent FAILED run keeps the
// last-run cursor fresh). That is the load-bearing blind spot documented on
// reportOverdueCrons: a reconciler returning HTTP 500 every tick — the ONLY
// human-escalation channel most reconcilers have — writes a FAILED CronJobLog row
// and pages nobody, because nothing scans CronJobLog for status=FAILED.
//
// This closes that gap using the SAME idempotent SYSTEM_ALERT mechanism: detect a
// cron whose most-recent runs are a consecutive FAILED streak (so a single
// transient blip that self-heals on the next run never pages), and alert once per
// window until it recovers. A cron that fires but persistently fails now becomes an
// actionable operational exception instead of a silent red row.

// A cron must fail this many runs in a row before it pages — a single failure that
// the next scheduled run clears is not alert-worthy.
export const FAILED_CRON_STREAK_THRESHOLD = 2;
// Only inspect recent runs; older failures that have since recovered are irrelevant.
export const FAILED_CRON_LOOKBACK_MINUTES = 180;

export interface FailedCronSignal {
  cronName: string;
  consecutiveFailures: number;
  lastError: string | null;
  lastRunAt: Date | null;
}

/**
 * Detect crons whose most-recent run FAILED, with the length of the trailing
 * consecutive-FAILED streak (newest runs first; the streak stops at the first
 * COMPLETED/RUNNING run — a success clears it). Returns every cron currently in a
 * failing state (streak ≥ 1); the reporter applies the paging threshold. Degrades
 * to [] (never throws) if the log table is unreachable.
 */
export async function detectFailedCrons(now: Date = new Date()): Promise<FailedCronSignal[]> {
  let rows: Array<{ cronName: string; status: string; error: string | null; startedAt: Date }>;
  try {
    rows = await prisma.cronJobLog.findMany({
      where: { startedAt: { gte: new Date(now.getTime() - FAILED_CRON_LOOKBACK_MINUTES * 60_000) } },
      select: { cronName: true, status: true, error: true, startedAt: true },
      orderBy: { startedAt: "desc" },
      take: 2000,
    });
  } catch (e) {
    logger.warn("[dead-cron] detectFailedCrons query failed (best-effort):", e);
    return [];
  }

  // Group preserving DESC order, then count the leading FAILED streak per cron.
  const byName = new Map<string, Array<{ status: string; error: string | null; startedAt: Date }>>();
  for (const r of rows) {
    const list = byName.get(r.cronName) ?? [];
    list.push({ status: r.status, error: r.error, startedAt: r.startedAt });
    byName.set(r.cronName, list);
  }

  const out: FailedCronSignal[] = [];
  for (const [cronName, runs] of byName) {
    let streak = 0;
    let lastError: string | null = null;
    let lastRunAt: Date | null = null;
    for (const run of runs) {
      if (run.status !== "FAILED") break; // a COMPLETED/RUNNING run clears the streak
      if (streak === 0) { lastError = run.error; lastRunAt = run.startedAt; }
      streak += 1;
    }
    if (streak > 0) out.push({ cronName, consecutiveFailures: streak, lastError, lastRunAt });
  }
  return out;
}

// Per-cron alert title, keyed on the cron so a second failing cron pages
// immediately rather than being suppressed by the first's still-open alert.
function failedCronAlertTitle(cronName: string): string {
  return `Failing cron: ${cronName}`;
}

// Trim a handler error to a bounded, operator-readable summary for the alert body.
function sanitizeCronError(error: string | null): string {
  if (!error) return "no error message recorded";
  const firstLine = error.split("\n")[0].trim();
  return firstLine.length > 200 ? `${firstLine.slice(0, 197)}…` : firstLine;
}

/**
 * Proactive-push surfacing for crons that are persistently failing (streak ≥
 * FAILED_CRON_STREAK_THRESHOLD). Per-cron idempotent within
 * DEAD_CRON_ALERT_WINDOW_MINUTES (shared with dead-cron paging, but a distinct
 * title namespace so a cron that is failing is never conflated with one that is
 * not firing). Best-effort per cron. Returns the count of fresh alerts raised.
 */
export async function reportFailedCrons(
  failing: FailedCronSignal[],
  now: Date = new Date(),
): Promise<{ alerted: number }> {
  const eligible = failing.filter((c) => c.consecutiveFailures >= FAILED_CRON_STREAK_THRESHOLD);
  if (eligible.length === 0) return { alerted: 0 };

  const windowStart = new Date(now.getTime() - DEAD_CRON_ALERT_WINDOW_MINUTES * 60_000);
  let alerted = 0;

  for (const c of eligible) {
    const title = failedCronAlertTitle(c.cronName);
    try {
      const recent = await prisma.notification.findFirst({
        where: { title, type: "SYSTEM_ALERT", createdAt: { gte: windowStart } },
        select: { id: true },
      });
      if (recent) continue;

      await prisma.notification.create({
        data: {
          title,
          body: `Cron '${c.cronName}' has failed ${c.consecutiveFailures} run(s) in a row — its handler is throwing, not merely not firing. Last error: ${sanitizeCronError(c.lastError)}. Review via /admin/operations.`,
          type: "SYSTEM_ALERT",
          actionUrl: "/admin/operations",
        },
      });
      notifyOncall(`Failing cron detected: ${c.cronName}`, {
        cron: c.cronName,
        consecutiveFailures: c.consecutiveFailures,
      });
      alerted += 1;
    } catch (e) {
      logger.error(`[dead-cron] reportFailedCrons failed for ${c.cronName} (best-effort):`, e);
    }
  }

  return { alerted };
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
