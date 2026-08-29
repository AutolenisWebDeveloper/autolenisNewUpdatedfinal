// lib/services/monitoring/cron-monitor.service.ts
import { prisma } from "@/lib/prisma";
import { CronJobStatus } from "@prisma/client";
import { logger } from "@/lib/logger";

// ── Build identity ──────────────────────────────────────────────────────────
//
// On 2026-08-28 production served a build predating the e-sign schema gate for
// ~25 minutes. Proving that took cross-referencing two unrelated crons — one
// failing with a pre-gate error, another missing a result key a PR had added an
// hour earlier — and even then the serving deployment was never identified.
//
// cron_job_logs is already the oracle every cron writes to, so the build that
// served each run is recorded in the row itself. That turns the same question
// into one query:
//
//   SELECT result->'build'->>'commitSha' AS sha, count(*),
//          min(started_at) AS first_seen, max(started_at) AS last_seen
//     FROM cron_job_logs
//    WHERE started_at > now() - interval '6 hours'
//    GROUP BY 1 ORDER BY first_seen;
//
// A build swap shows up as one SHA's last_seen abutting the next SHA's
// first_seen — the shape today's incident had to be inferred from.
//
// Nested under a single `build` key rather than spread across the payload, so
// it touches exactly one name in a namespace 32 crons share. No cron currently
// returns a `build` key (checked); if one ever does, this stamp wins — treat
// `build` as reserved in a cron result.

/**
 * When THIS serverless instance's module graph initialized — a cold start, not
 * the deploy time. Vercel exposes no deploy-timestamp variable; the useful
 * property here is that the earliest `bootedAt` carrying a given deploymentId
 * is a tight upper bound on when that deployment began serving.
 */
const BOOTED_AT = new Date().toISOString();

/**
 * Read one build-identity variable, treating absent, blank, and the literal
 * strings "undefined"/"null" alike as NOT SET.
 *
 * The literal check is not paranoia: `process.env.X = undefined` stores the
 * four-character string "undefined", which already bit this codebase once in
 * the terms resolver. A row claiming to have been served by commit "undefined"
 * is worse than a row that admits it does not know.
 */
function readBuildEnv(name: string): string | null {
  const raw = process.env[name];
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (trimmed.length === 0 || trimmed === "undefined" || trimmed === "null") return null;
  return trimmed;
}

export interface CronBuildIdentity {
  /** VERCEL_GIT_COMMIT_SHA — the commit this build was made from. */
  commitSha?: string;
  /** VERCEL_DEPLOYMENT_ID — the deployment, which is what a rollback changes. */
  deploymentId?: string;
  vercelEnv?: string;
  bootedAt: string;
}

/**
 * The serving build, or null when nothing is knowable (local dev, CI, tests).
 *
 * Null rather than a stamp of nulls: off Vercel there is no identity to record,
 * and omitting the key keeps every existing cron's persisted result shape
 * byte-identical instead of adding an empty object to all 32 of them.
 */
export function getCronBuildIdentity(): CronBuildIdentity | null {
  const commitSha = readBuildEnv("VERCEL_GIT_COMMIT_SHA");
  const deploymentId = readBuildEnv("VERCEL_DEPLOYMENT_ID");
  const vercelEnv = readBuildEnv("VERCEL_ENV");
  if (!commitSha && !deploymentId && !vercelEnv) return null;
  return {
    ...(commitSha ? { commitSha } : {}),
    ...(deploymentId ? { deploymentId } : {}),
    ...(vercelEnv ? { vercelEnv } : {}),
    bootedAt: BOOTED_AT,
  };
}

export async function startCronRun(cronName: string) {
  return prisma.cronJobLog.create({ data: { cronName, status: CronJobStatus.RUNNING } });
}

export type CronRunOutcome<T> = { ok: true; result: T } | { ok: false; error: unknown };

/**
 * Wrap a cron's WORK so every invocation is recorded in CronJobLog
 * (RUNNING → COMPLETED/FAILED). Monitoring is BEST-EFFORT: a cron_job_logs DB
 * error never fails the actual cron — the wrapped work still runs and its
 * result/throw is returned unchanged. Callers keep their own HTTP response shape.
 */
export async function withCronRun<T>(cronName: string, work: () => Promise<T>): Promise<CronRunOutcome<T>> {
  let logId: string | null = null;
  try {
    const log = await startCronRun(cronName);
    logId = log.id;
  } catch (e) {
    logger.warn(`[cron-monitor] startCronRun failed for ${cronName} (continuing):`, e);
  }

  try {
    const result = await work();
    if (logId) {
      const payload = result && typeof result === "object" ? (result as Record<string, unknown>) : { value: result };
      // Stamped onto the PERSISTED payload only. `result` is returned to the
      // caller untouched below because routes spread it straight into their HTTP
      // body (esign-artifact-reconcile does `{ success: true, ...run.result }`),
      // and augmenting it would change 32 public response shapes.
      const build = getCronBuildIdentity();
      try {
        await completeCronRun(logId, build ? { ...payload, build } : payload);
      } catch (e) {
        logger.warn(`[cron-monitor] completeCronRun failed for ${cronName}:`, e);
      }
    }
    return { ok: true, result };
  } catch (error) {
    logger.error(`[cron:${cronName}] failed:`, error);
    if (logId) {
      try {
        // A FAILED run is precisely where the build matters: the six runs that
        // motivated this all failed, so a success-only stamp would leave exactly
        // the rows the investigation needed unidentified.
        await failCronRun(logId, String(error), getCronBuildIdentity());
      } catch (e) {
        logger.warn(`[cron-monitor] failCronRun failed for ${cronName}:`, e);
      }
    }
    return { ok: false, error };
  }
}

export async function completeCronRun(logId: string, result: Record<string, unknown>) {
  const log = await prisma.cronJobLog.findUnique({ where: { id: logId } });
  const duration = log ? Date.now() - log.startedAt.getTime() : 0;
  return prisma.cronJobLog.update({ where: { id: logId }, data: { status: CronJobStatus.COMPLETED, result: result as object, completedAt: new Date(), duration } });
}

export async function failCronRun(logId: string, error: string, build?: CronBuildIdentity | null) {
  return prisma.cronJobLog.update({
    where: { id: logId },
    data: {
      status: CronJobStatus.FAILED,
      error,
      completedAt: new Date(),
      // Only when there is something to say — a failed run off Vercel keeps the
      // null `result` it has always had.
      ...(build ? { result: { build } as object } : {}),
    },
  });
}

export async function getRecentCronLogs(cronName?: string, limit = 20) {
  return prisma.cronJobLog.findMany({
    where: cronName ? { cronName } : {},
    orderBy: { startedAt: "desc" },
    take: limit,
  });
}
