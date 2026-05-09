// lib/services/monitoring/cron-monitor.service.ts
import { prisma } from "@/lib/prisma";
import { CronJobStatus } from "@prisma/client";

export async function startCronRun(cronName: string) {
  return prisma.cronJobLog.create({ data: { cronName, status: CronJobStatus.RUNNING } });
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
