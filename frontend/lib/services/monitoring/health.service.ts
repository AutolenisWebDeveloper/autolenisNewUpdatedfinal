// lib/services/monitoring/health.service.ts — System 23 health monitoring

import { prisma } from "@/lib/prisma";
import { INVENTORY_HEALTH_P1_THRESHOLD } from "@/lib/constants";
import { getStripe } from "@/lib/stripe";

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
