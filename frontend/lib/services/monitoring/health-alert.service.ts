// lib/services/monitoring/health-alert.service.ts
import { prisma } from "@/lib/prisma";
import { HealthAlertLevel } from "@prisma/client";

export async function createAlert(level: HealthAlertLevel, title: string, body: string, source: string) {
  return prisma.platformAlert.create({ data: { level, title, body, source } });
}

export async function resolveAlert(alertId: string, resolvedBy: string) {
  return prisma.platformAlert.update({ where: { id: alertId }, data: { isResolved: true, resolvedAt: new Date(), resolvedBy } });
}

export async function getActiveAlerts(level?: HealthAlertLevel) {
  return prisma.platformAlert.findMany({
    where: { isResolved: false, ...(level && { level }) },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}
