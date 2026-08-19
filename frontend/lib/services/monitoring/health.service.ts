// lib/services/monitoring/health.service.ts — System 23 health monitoring

import { prisma } from "@/lib/prisma";
import { INVENTORY_HEALTH_P1_THRESHOLD } from "@/lib/constants";
import { getStripe } from "@/lib/stripe";
import { logger } from "@/lib/logger";
import { detectDeadCrons, overdueCrons, reportOverdueCrons } from "./dead-cron.service";
import type { CronLiveness } from "./cron-schedule";

// Monitoring-log retention. health-check ticks every 5 minutes, so the purge is
// throttled to run at most once/day (first tick of PURGE_HOUR_UTC).
export const MONITORING_RETENTION_DAYS = 30;
const PURGE_HOUR_UTC = 3;
const HEALTH_CHECK_INTERVAL_MINUTES = 5;

export interface IntegrationStatus {
  stripe: boolean;
  docusign: boolean;
  resend: boolean;
  microbilt: boolean;
}

export interface HealthReport {
  status: "healthy" | "degraded" | "down";
  database: boolean;
  inventoryHealth: number;
  activeAuctions: number;
  pendingOFAC: number;
  contractFails: number;
  integrations: IntegrationStatus;
  alerts: string[];
  timestamp: Date;
}

async function checkStripe(): Promise<boolean> {
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 3000)
    );
    await Promise.race([getStripe().balance.retrieve(), timeout]);
    return true;
  } catch {
    return false;
  }
}

function checkDocuSign(): boolean {
  const required = ["DOCUSIGN_INTEGRATION_KEY", "DOCUSIGN_ACCOUNT_ID", "DOCUSIGN_USER_ID", "DOCUSIGN_PRIVATE_KEY_BASE64"];
  return required.every(k => !!process.env[k]);
}

function checkResend(): boolean {
  return !!process.env.RESEND_API_KEY;
}

function checkMicroBilt(): boolean {
  return !!(process.env.MICROBILT_CLIENT_ID && process.env.MICROBILT_CLIENT_SECRET);
}

export async function runHealthCheck(): Promise<HealthReport> {
  const alerts: string[] = [];
  let dbOk = false;

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    alerts.push("P0: Database connection failed");
  }

  const [activeAuctions, pendingOFAC, contractFails, inventoryCount, activeInventory, stripeOk] = await Promise.all([
    prisma.auction.count({ where: { status: "ACTIVE" } }),
    prisma.preQualification.count({ where: { checkOfacAlert: true, decision: "OFAC_ESCALATED" } }),
    prisma.contractScan.count({ where: { status: "FAIL" } }),
    prisma.inventoryItem.count(),
    prisma.inventoryItem.count({ where: { isActive: true } }),
    checkStripe(),
  ]);

  const integrations: IntegrationStatus = {
    stripe: stripeOk,
    docusign: checkDocuSign(),
    resend: checkResend(),
    microbilt: checkMicroBilt(),
  };

  const inventoryHealth = inventoryCount > 0 ? Math.round((activeInventory / inventoryCount) * 100) : 100;

  if (pendingOFAC > 0) alerts.push(`P0: ${pendingOFAC} OFAC escalation(s) pending immediate review`);
  if (inventoryHealth < INVENTORY_HEALTH_P1_THRESHOLD) alerts.push(`P1: Inventory health at ${inventoryHealth}% — below threshold`);
  if (contractFails > 5) alerts.push(`P1: ${contractFails} contract scan failures unresolved`);
  if (!integrations.stripe) alerts.push("P1: Stripe API key invalid or unreachable");
  if (!integrations.docusign) alerts.push("P1: DocuSign configuration incomplete — missing required env vars");
  if (!integrations.resend) alerts.push("P1: Resend API key missing");
  if (!integrations.microbilt) alerts.push("P1: MicroBilt credentials missing");

  const status = !dbOk ? "down" : alerts.some(a => a.startsWith("P0")) ? "degraded" : "healthy";

  return { status, database: dbOk, inventoryHealth, activeAuctions, pendingOFAC, contractFails, integrations, alerts, timestamp: new Date() };
}

/**
 * Persist a health report to health_check_logs (channel B — queryable log).
 * The table has no columns for contractFails/integrations; those already surface
 * as alert strings, so the alerts array is the folded record. BEST-EFFORT: a
 * write failure is logged, never thrown, so it can't fail the health-check cron.
 */
export async function persistHealthReport(report: HealthReport): Promise<void> {
  try {
    await prisma.healthCheckLog.create({
      data: {
        status: report.status,
        database: report.database,
        inventoryHealth: report.inventoryHealth,
        activeAuctions: report.activeAuctions,
        pendingOFAC: report.pendingOFAC,
        alerts: report.alerts,
      },
    });
  } catch (e) {
    logger.warn("[health] persistHealthReport failed (best-effort):", e);
  }
}

/**
 * Retention purge for the monitoring log tables, throttled to at most once/day.
 * Guarded on hour-of-day: only the first health-check tick of PURGE_HOUR_UTC each
 * day purges (health-check runs every 5m, so a minute-window of one interval
 * selects exactly one tick). If that tick is missed the purge simply waits a day —
 * retention is not time-critical. Deletes are best-effort at the call site.
 */
export async function maybeRunRetentionPurge(
  now: Date = new Date(),
): Promise<{ purged: boolean; healthDeleted?: number; cronDeleted?: number }> {
  if (now.getUTCHours() !== PURGE_HOUR_UTC || now.getUTCMinutes() >= HEALTH_CHECK_INTERVAL_MINUTES) {
    return { purged: false };
  }
  const cutoff = new Date(now.getTime() - MONITORING_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const [health, cron] = await Promise.all([
    prisma.healthCheckLog.deleteMany({ where: { checkedAt: { lt: cutoff } } }),
    prisma.cronJobLog.deleteMany({ where: { startedAt: { lt: cutoff } } }),
  ]);
  return { purged: true, healthDeleted: health.count, cronDeleted: cron.count };
}

/**
 * One full health-check cycle, run by the health-check cron (through withCronRun):
 *   1. compute the health report
 *   2. detect dead crons, fold OVERDUE into report.alerts, and proactively push
 *   3. persist the report (channel B)
 *   4. throttled retention purge (≤ once/day)
 * Steps 2–4 are best-effort and individually guarded so a monitoring-write hiccup
 * never fails the cycle; step 1's own errors propagate (the health check genuinely
 * couldn't run) and are recorded by withCronRun.
 */
export async function runHealthCheckCycle(
  now: Date = new Date(),
): Promise<{ report: HealthReport; deadCrons: CronLiveness[] }> {
  const report = await runHealthCheck();

  let deadCrons: CronLiveness[] = [];
  try {
    deadCrons = await detectDeadCrons(now);
    const overdue = overdueCrons(deadCrons);
    for (const c of overdue) {
      report.alerts.push(
        `P1: cron '${c.cronName}' overdue — last run ${c.ageMinutes}m ago (expected within ${c.maxAgeMinutes}m)`,
      );
    }
    await reportOverdueCrons(overdue, now);
  } catch (e) {
    logger.warn("[health] dead-cron detection failed (best-effort):", e);
  }

  await persistHealthReport(report);

  try {
    await maybeRunRetentionPurge(now);
  } catch (e) {
    logger.warn("[health] retention purge failed (best-effort):", e);
  }

  return { report, deadCrons };
}

export async function checkSLAs(): Promise<{ breached: number; warnings: number }> {
  let breached = 0, warnings = 0;

  // Auctions closing in < 2 hours with 0 offers
  const urgentAuctions = await prisma.auction.findMany({
    where: { status: "ACTIVE", endsAt: { lte: new Date(Date.now() + 2 * 3600000) } },
    include: { _count: { select: { offers: true } } },
  });

  for (const a of urgentAuctions) {
    if (a._count.offers === 0) {
      warnings++;
      await prisma.notification.create({
        data: { title: "SLA Warning: Auction closing with no offers", body: `Auction ${a.id.slice(-8)} closes in <2h with zero offers`, type: "SYSTEM_ALERT" },
      }).catch(() => {});
    }
  }

  // Deals stuck > 14 days
  const cutoff = new Date(Date.now() - 14 * 24 * 3600000);
  const stuckDeals = await prisma.deal.count({
    where: { createdAt: { lt: cutoff }, status: { notIn: ["COMPLETED", "CANCELLED", "REFUNDED"] } },
  });

  if (stuckDeals > 0) {
    breached += stuckDeals;
    await prisma.notification.create({
      data: { title: `SLA Breach: ${stuckDeals} deal(s) stalled > 14 days`, body: "Review stuck deals in the admin console.", type: "SYSTEM_ALERT" },
    }).catch(() => {});
  }

  return { breached, warnings };
}
