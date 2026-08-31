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

// ── Cadence awareness ────────────────────────────────────────────────────────
//
// THE DEFECT THIS FIXES
// A fixed 180-minute window cannot express "two consecutive runs" for a job that
// runs less often than that. 34 of the 67 scheduled crons have a worst-case
// inter-run gap exceeding the window — every daily and weekly job, plus the
// 4-hourly and 6-hourly ones — so at most ONE of their runs is ever in scope and
// the streak can never reach FAILED_CRON_STREAK_THRESHOLD. They were structurally
// unalertable: `social-market-index` (weekly) has failed 100% of its recorded
// runs and never produced a signal, and dead-cron detection does not cover it
// either (a cron that fires and throws reads as alive there — see
// reportOverdueCrons' note below).
//
// THE CORRECTION
// The threshold-of-2 exists to avoid paging on a blip "that the next scheduled
// run clears". That rationale is TIME-based, not count-based: it only holds if
// the next run arrives soon. When the next run is a week away, waiting for it
// means a week of silence on a job that is down.
//
// So the requirement becomes: demand a second consecutive failure only when the
// second run would actually land inside the base lookback window. Crons at or
// under FAILED_CRON_LOOKBACK_MINUTES keep today's behaviour exactly; slower ones
// alert on a single failed run, because for them one failure already means a
// whole cadence of downtime.
//
// Cadence comes from CRON_STALENESS, the registry dead-cron detection already
// uses and which cron-schedule.test.ts pins to vercel.json in both directions —
// so a newly-scheduled cron cannot escape this either.

/** Consecutive failed runs required before a cron alerts, given its cadence. */
export function failedStreakThresholdFor(cronName: string): number {
  const entry = CRON_STALENESS[cronName];
  // Unregistered cron (e.g. a de-scheduled name still present in the log):
  // keep the conservative default rather than alerting on a single failure.
  if (!entry) return FAILED_CRON_STREAK_THRESHOLD;
  return entry.intervalMinutes <= FAILED_CRON_LOOKBACK_MINUTES
    ? FAILED_CRON_STREAK_THRESHOLD
    : 1;
}

/**
 * How far back to look for a given cron's runs.
 *
 * Two cadences of history is enough to hold the runs the threshold needs plus
 * slack for a late fire. Looking back further would resurrect failures the cron
 * has long since recovered from; a cron that has not run within that window is
 * not a failing cron but an OVERDUE one, which dead-cron detection owns.
 */
export function failedLookbackMinutesFor(cronName: string): number {
  const entry = CRON_STALENESS[cronName];
  if (!entry) return FAILED_CRON_LOOKBACK_MINUTES;
  return Math.max(FAILED_CRON_LOOKBACK_MINUTES, entry.intervalMinutes * 2);
}

/** Crons whose cadence outruns the base window, and therefore need their own. */
function slowCronNames(): string[] {
  return Object.keys(CRON_STALENESS).filter(
    (name) => CRON_STALENESS[name].intervalMinutes > FAILED_CRON_LOOKBACK_MINUTES,
  );
}

// ── Orphaned RUNNING rows ────────────────────────────────────────────────────
//
// THE DEFECT
// startCronRun writes a RUNNING row and only completeCronRun/failCronRun move it
// (cron-monitor.service.ts). A run killed mid-flight — a maxDuration timeout, an
// OOM, a deploy landing mid-execution — therefore leaves RUNNING behind forever,
// and nothing reaps it.
//
// That row then read as "not a failure" and CLEARED the failed streak, exactly as
// a COMPLETED run does. Two consequences, both silent:
//   - a cron alternating FAILED / killed never reaches a streak of 2;
//   - a cron that is killed on EVERY run has no FAILED rows at all, so it is
//     invisible here — while dead-cron detection reads its fresh RUNNING row as
//     proof of life. Neither detector sees it.
//
// A RUNNING row means "outcome unknown", never "succeeded", and past a bound it
// means "this run died".
//
// THE BOUND
// 300 seconds is Vercel's maximum function duration and the highest maxDuration
// any route in this repo declares, so no run can legitimately still be executing
// beyond it. Ten minutes is double that ceiling — margin for clock skew between
// the DB-assigned startedAt and the moment we observe it. Anything older is
// orphaned by construction, not by guess.
export const ORPHANED_RUNNING_AFTER_MINUTES = 10;

/** True when a RUNNING row is too old to still be executing — the run died. */
export function isOrphanedRunning(
  run: { status: string; startedAt: Date },
  now: Date,
): boolean {
  if (run.status !== "RUNNING") return false;
  return now.getTime() - run.startedAt.getTime() > ORPHANED_RUNNING_AFTER_MINUTES * 60_000;
}

// Bound on the bulk recent-runs query. The fleet currently writes roughly 1,300
// rows per 180 minutes, so this is ~3x headroom; rows are ordered newest-first
// and only the leading streak per cron is read, so truncation would drop the
// oldest rows rather than hide a cron.
const RECENT_RUNS_QUERY_LIMIT = 4000;
// Bound on the slow-cron query. ~34 crons over at most 14 days of their own
// history is a few hundred rows; this is deliberate headroom, not a target.
const SLOW_RUNS_QUERY_LIMIT = 4000;

export interface FailedCronSignal {
  cronName: string;
  consecutiveFailures: number;
  lastError: string | null;
  lastRunAt: Date | null;
  /**
   * How many runs in the streak were orphaned RUNNING rows rather than recorded
   * failures. Optional so existing callers that hand-build a signal still
   * type-check; absent means none. Worth reporting because it separates two very
   * different root causes: a handler that throws, versus runs being killed
   * mid-flight (timeout / OOM / deploy).
   */
  abandonedRuns?: number;
}

// NOTE: the per-cron threshold is deliberately NOT carried on the signal. It is
// derived from CRON_STALENESS via failedStreakThresholdFor(), and every consumer
// derives it at the point of use. Storing it here would duplicate derived state
// alongside its source and invite the two to drift.

interface RunRow {
  cronName: string;
  status: string;
  error: string | null;
  startedAt: Date;
}

/**
 * Count the leading unsuccessful streak in a newest-first run list.
 *
 * Three dispositions, because a run has three meanings and not two:
 *
 *   FAILED             the handler threw — counts toward the streak.
 *   RUNNING, orphaned  the run died mid-flight (see ORPHANED_RUNNING_AFTER_MINUTES)
 *                      — counts toward the streak. It is an unsuccessful run whose
 *                      error was never recorded, not a success.
 *   RUNNING, in flight the outcome is not known yet — SKIPPED, neither counting
 *                      nor clearing. An in-flight run is not evidence of recovery,
 *                      and treating it as one is what let an alternating
 *                      FAILED/killed cron sit permanently below the threshold.
 *                      It also matters for health-check itself: its own row is
 *                      RUNNING while this very scan executes, so breaking on it
 *                      meant health-check could never report itself as failing.
 *   anything else      COMPLETED/SKIPPED — a real outcome that clears the streak.
 */
function leadingFailedStreak(
  runs: readonly Omit<RunRow, "cronName">[],
  now: Date,
): {
  streak: number;
  abandoned: number;
  lastError: string | null;
  lastRunAt: Date | null;
} {
  let streak = 0;
  let abandoned = 0;
  let lastError: string | null = null;
  let lastRunAt: Date | null = null;

  for (const run of runs) {
    if (run.status === "RUNNING") {
      // Still within the platform's execution ceiling: unknown, not recovered.
      if (!isOrphanedRunning(run, now)) continue;
      abandoned += 1;
    } else if (run.status !== "FAILED") {
      break; // a genuine non-failure outcome clears the streak
    }
    // Capture from the newest COUNTED run, not the newest run — an in-flight run
    // that was skipped above must not become the reported one.
    if (streak === 0) {
      lastError = run.error;
      lastRunAt = run.startedAt;
    }
    streak += 1;
  }
  return { streak, abandoned, lastError, lastRunAt };
}

/**
 * Detect crons whose most-recent run FAILED, with the length of the trailing
 * consecutive-FAILED streak (newest runs first; the streak stops at the first
 * COMPLETED/RUNNING run — a success clears it). Returns every cron currently in a
 * failing state (streak ≥ 1); the reporter applies the paging threshold. Degrades
 * to [] (never throws) if the log table is unreachable.
 */
export async function detectFailedCrons(now: Date = new Date()): Promise<FailedCronSignal[]> {
  const slow = slowCronNames();
  // The widest per-cron window in play, so one query covers every slow cron and
  // each is then trimmed to its own lookback below. Two queries total — a
  // per-cron fan-out would be ~34 round trips on every 5-minute health cycle.
  const widestSlowLookback = slow.reduce(
    (max, name) => Math.max(max, failedLookbackMinutesFor(name)),
    FAILED_CRON_LOOKBACK_MINUTES,
  );

  let rows: RunRow[];
  try {
    const [recent, slowRuns] = await Promise.all([
      // Fast crons: unchanged base window.
      prisma.cronJobLog.findMany({
        where: { startedAt: { gte: new Date(now.getTime() - FAILED_CRON_LOOKBACK_MINUTES * 60_000) } },
        select: { cronName: true, status: true, error: true, startedAt: true },
        orderBy: { startedAt: "desc" },
        take: RECENT_RUNS_QUERY_LIMIT,
      }),
      // Slow crons: their own history, which the base window cannot reach.
      slow.length > 0
        ? prisma.cronJobLog.findMany({
            where: {
              cronName: { in: slow },
              startedAt: { gte: new Date(now.getTime() - widestSlowLookback * 60_000) },
            },
            select: { cronName: true, status: true, error: true, startedAt: true },
            orderBy: { startedAt: "desc" },
            take: SLOW_RUNS_QUERY_LIMIT,
          })
        : Promise.resolve([] as RunRow[]),
    ]);
    // A slow cron's runs can appear in both result sets; dedupe on identity so a
    // single run is never counted twice toward its own streak.
    const seen = new Set<string>();
    rows = [...recent, ...slowRuns].filter((r) => {
      const key = `${r.cronName}|${r.startedAt.getTime()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    rows.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  } catch (e) {
    logger.warn("[dead-cron] detectFailedCrons query failed (best-effort):", e);
    return [];
  }

  // Group preserving DESC order, then count the leading FAILED streak per cron
  // within that cron's OWN lookback.
  const byName = new Map<string, Array<Omit<RunRow, "cronName">>>();
  for (const r of rows) {
    const cutoff = now.getTime() - failedLookbackMinutesFor(r.cronName) * 60_000;
    if (r.startedAt.getTime() < cutoff) continue;
    const list = byName.get(r.cronName) ?? [];
    list.push({ status: r.status, error: r.error, startedAt: r.startedAt });
    byName.set(r.cronName, list);
  }

  const out: FailedCronSignal[] = [];
  for (const [cronName, runs] of byName) {
    const { streak, abandoned, lastError, lastRunAt } = leadingFailedStreak(runs, now);
    if (streak > 0) {
      out.push({
        cronName,
        consecutiveFailures: streak,
        lastError,
        lastRunAt,
        abandonedRuns: abandoned,
      });
    }
  }
  return out;
}

// Per-cron alert title, keyed on the cron so a second failing cron pages
// immediately rather than being suppressed by the first's still-open alert.
function failedCronAlertTitle(cronName: string): string {
  return `Failing cron: ${cronName}`;
}

// Describe the streak in the terms an operator needs to start debugging: a
// handler that throws and a run that is killed mid-flight look identical in the
// count but have completely different causes (a bug vs a timeout/OOM/deploy).
//
// Two forms of the same three cases, because they serve two surfaces: this
// compact one goes in the health report's one-line alert list, and the verbose
// describeUnsuccessfulRuns() below goes in the out-of-band notification body,
// where the operator has no other context and the jargon needs unpacking. Both
// must name mid-flight deaths whenever abandonedRuns > 0 — saying "failed" of a
// run that recorded no error sends the reader hunting for a FAILED row that does
// not exist. A test pins that agreement.
export function unsuccessfulRunSummary(c: FailedCronSignal): string {
  const n = c.consecutiveFailures;
  const abandoned = c.abandonedRuns ?? 0;
  if (abandoned === 0) return `${n} consecutive failed run(s)`;
  if (abandoned === n) return `${n} consecutive run(s) killed mid-flight (no error recorded)`;
  return `${n} consecutive unsuccessful run(s), ${abandoned} killed mid-flight`;
}

function describeUnsuccessfulRuns(c: FailedCronSignal): string {
  const n = c.consecutiveFailures;
  const abandoned = c.abandonedRuns ?? 0;
  if (abandoned === 0) return `failed ${n} run(s) in a row`;
  if (abandoned === n) {
    return (
      `${n} run(s) in a row that started and never finished — no error was ` +
      `recorded, so they were killed mid-flight (timeout / OOM / deploy), not thrown`
    );
  }
  return `failed ${n} run(s) in a row, ${abandoned} of which died mid-flight without recording an error`;
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
  const eligible = failing.filter(
    (c) => c.consecutiveFailures >= failedStreakThresholdFor(c.cronName),
  );
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
          body:
            `Cron '${c.cronName}' has ${describeUnsuccessfulRuns(c)} ` +
            `(alert threshold ${failedStreakThresholdFor(c.cronName)} for its ` +
            `${CRON_STALENESS[c.cronName]?.intervalMinutes ?? "unknown"}-minute cadence) — ` +
            `it is firing, not merely absent. ` +
            `Last error: ${sanitizeCronError(c.lastError)}. Review via /admin/operations.`,
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
 * did not FIRE (its latest run is stale). A cron that fires but does not succeed
 * still writes a recent run, so it reads as alive here — whether that run is FAILED
 * (the handler threw) or a RUNNING row left behind by a run killed mid-flight.
 * Both failure modes surface via detectFailedCrons(), which reads the run's status
 * rather than merely its freshness; neither is dead-cron detection's to catch.
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
