// lib/services/admin/admin-queue.service.ts
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

export type QueueType = "OFAC_ALERT" | "CONTRACT_FAIL" | "INSURANCE_EXCEPTION" | "ESIGN_EXCEPTION" | "PICKUP_EXCEPTION" | "PREQUAL_MANUAL" | "SUPPORT_TICKET" | "SYSTEM_ALERT";

export async function getQueueItems(queueType: QueueType, limit = 20) {
  switch (queueType) {
    case "OFAC_ALERT": return prisma.preQualification.findMany({ where: { checkOfacAlert: true, decision: { in: ["OFAC_REVIEW", "OFAC_ESCALATED"] } }, include: { buyer: { select: { firstName: true, lastName: true } } }, take: limit, orderBy: { updatedAt: "desc" } });
    case "CONTRACT_FAIL": return prisma.contractScan.findMany({ where: { status: "FAIL" }, include: { deal: { include: { buyer: { select: { firstName: true, lastName: true } } } } }, take: limit });
    case "PREQUAL_MANUAL": return prisma.preQualification.findMany({ where: { decision: "MANUAL_REVIEW" }, take: limit });
    case "SYSTEM_ALERT": return prisma.notification.findMany({ where: { type: "SYSTEM_ALERT", readAt: null }, take: limit, orderBy: { createdAt: "desc" } });
    case "INSURANCE_EXCEPTION":
      return prisma.deal.findMany({
        where: { status: "INSURANCE_PENDING", updatedAt: { lt: new Date(Date.now() - 72 * 60 * 60 * 1000) } },
        include: { buyer: { select: { firstName: true, lastName: true } } },
        take: limit,
      });
    case "ESIGN_EXCEPTION":
      return prisma.deal.findMany({
        where: { status: "SIGNING_PENDING", updatedAt: { lt: new Date(Date.now() - 48 * 60 * 60 * 1000) } },
        include: { buyer: { select: { firstName: true, lastName: true } } },
        take: limit,
      });
    case "PICKUP_EXCEPTION":
      return prisma.deal.findMany({
        where: { status: "PICKUP_SCHEDULED", updatedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        include: { buyer: { select: { firstName: true, lastName: true } } },
        take: limit,
      });
    case "SUPPORT_TICKET":
      return prisma.notification.findMany({
        where: { type: "SUPPORT_TICKET", readAt: null },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
    default: return [];
  }
}

export async function resolveQueueItem(queueType: QueueType, itemId: string, adminId: string, adminEmail: string, resolution: string) {
  try {
    switch (queueType) {
      case "OFAC_ALERT": {
        const upperRes = resolution.toUpperCase();
        const words = new Set(upperRes.split(/\W+/));
        const decision = words.has("CLEAR") ? "APPROVED"
          : words.has("CONFIRM") ? "DECLINED"
          : null;
        if (!decision) {
          logger.warn(`[queue] OFAC_ALERT resolve requires explicit "CLEAR" or "CONFIRM" in resolution for ${itemId}. Resolution: "${resolution}"`);
          break;
        }
        await prisma.preQualification.update({ where: { id: itemId }, data: { decision } });
        break;
      }
      case "CONTRACT_FAIL":
        await prisma.contractScan.update({ where: { id: itemId }, data: { status: "WARNING" } });
        break;
      case "SYSTEM_ALERT":
        await prisma.notification.update({ where: { id: itemId }, data: { readAt: new Date() } });
        break;
      case "SUPPORT_TICKET":
        await prisma.notification.update({ where: { id: itemId }, data: { readAt: new Date() } });
        break;
      case "PREQUAL_MANUAL": {
        // Resolution text must contain explicit decision: APPROVE or DECLINE.
        // Auto-approval on resolve was a marketplace integrity risk — admins
        // must now state the human decision in the resolution note.
        const upperRes = resolution.toUpperCase();
        const decision = upperRes.includes("APPROVE") ? "APPROVED"
          : upperRes.includes("DECLINE") ? "DECLINED"
          : null;
        if (!decision) {
          logger.warn(`[admin-queue] PREQUAL_MANUAL resolve missing explicit decision for ${itemId}. Resolution: "${resolution}"`);
          // Still log the resolution attempt below but do not change prequal status.
          break;
        }
        await prisma.preQualification.update({
          where: { id: itemId },
          data: { decision },
        });
        break;
      }
      // For queue types without real DB items, just log the resolution
      default:
        break;
    }
  } catch (err) {
    // Non-throwing — caller does not handle errors. Audit log is still written
    // below even if the DB update failed, so the resolution attempt is visible.
    // TODO: Surface this error to the admin API response.
    logger.error(`[admin-queue] resolveQueueItem failed for ${queueType}/${itemId}:`, err);
  }

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action: "QUEUE_ITEM_RESOLVED",
      entityType: queueType,
      entityId: itemId,
      reason: resolution,
      metadata: { resolution, queueType },
    },
  }).catch(() => {});
}

export async function getQueueCounts(): Promise<Record<QueueType, number>> {
  const [ofac, contractFail, prequal, systemAlerts, insuranceException, esignException, pickupException, supportTickets] = await Promise.all([
    prisma.preQualification.count({ where: { checkOfacAlert: true, decision: { in: ["OFAC_REVIEW", "OFAC_ESCALATED"] } } }),
    prisma.contractScan.count({ where: { status: "FAIL" } }),
    prisma.preQualification.count({ where: { decision: "MANUAL_REVIEW" } }),
    prisma.notification.count({ where: { type: "SYSTEM_ALERT", readAt: null } }),
    prisma.deal.count({ where: { status: "INSURANCE_PENDING", updatedAt: { lt: new Date(Date.now() - 72 * 60 * 60 * 1000) } } }),
    prisma.deal.count({ where: { status: "SIGNING_PENDING", updatedAt: { lt: new Date(Date.now() - 48 * 60 * 60 * 1000) } } }),
    prisma.deal.count({ where: { status: "PICKUP_SCHEDULED", updatedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } }),
    prisma.notification.count({ where: { type: "SUPPORT_TICKET", readAt: null } }),
  ]);
  return { OFAC_ALERT: ofac, CONTRACT_FAIL: contractFail, INSURANCE_EXCEPTION: insuranceException, ESIGN_EXCEPTION: esignException, PICKUP_EXCEPTION: pickupException, PREQUAL_MANUAL: prequal, SUPPORT_TICKET: supportTickets, SYSTEM_ALERT: systemAlerts };
}
