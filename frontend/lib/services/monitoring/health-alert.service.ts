// lib/services/monitoring/health-alert.service.ts
import { prisma } from "@/lib/prisma";
import { HealthAlertLevel } from "@prisma/client";

export async function createAlert(level: HealthAlertLevel, title: string, body: string, source: string) {
  return prisma.platformAlert.create({ data: { level, title, body, source } });
}

/**
 * Raise an operational alert at most once while an identical one is still open.
 *
 * A structural outage (an integration erroring on every single call) re-fires on
 * every request. One row per occurrence buries the signal and makes the alert
 * list unusable, so an UNRESOLVED alert with the same `source` + `title`
 * suppresses the duplicate. Resolving the alert re-arms it, so a recurrence
 * after an operator has closed it is surfaced again.
 *
 * Escalation is expressed through the TITLE, not the level: a more severe
 * variant carries its own title and therefore still breaks through while a
 * lower-severity alert is open.
 *
 * There is no unique constraint backing this, so two simultaneous first-failures
 * can both insert. That is benign for an alert (a duplicate row, not a missed
 * signal) and is preferred over an owner-gated migration for a dedup nicety.
 */
export async function createAlertOnce(
  level: HealthAlertLevel,
  title: string,
  body: string,
  source: string,
) {
  const open = await prisma.platformAlert.findFirst({
    where: { source, title, isResolved: false },
    select: { id: true },
  });
  if (open) return open;
  return createAlert(level, title, body, source);
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
