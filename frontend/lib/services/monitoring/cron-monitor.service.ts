// lib/services/monitoring/cron-monitor.service.ts
import { prisma } from "@/lib/prisma";
import { CronJobStatus } from "@prisma/client";
import { logger } from "@/lib/logger";

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
      try {
        await completeCronRun(logId, payload);
      } catch (e) {
        logger.warn(`[cron-monitor] completeCronRun failed for ${cronName}:`, e);
      }
    }
    return { ok: true, result };
  } catch (error) {
    logger.error(`[cron:${cronName}] failed:`, error);
    if (logId) {
      try {
        await failCronRun(logId, String(error));
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

export async function failCronRun(logId: string, error: string) {
  return prisma.cronJobLog.update({ where: { id: logId }, data: { status: CronJobStatus.FAILED, error, completedAt: new Date() } });
}

export async function getRecentCronLogs(cronName?: string, limit = 20) {
  return prisma.cronJobLog.findMany({
    where: cronName ? { cronName } : {},
    orderBy: { startedAt: "desc" },
    take: limit,
  });
}
