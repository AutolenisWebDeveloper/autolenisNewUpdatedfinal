// lib/services/admin/admin-queue.service.ts
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { listOpen, resolve as resolveException, OPEN_QUEUE_STATUSES } from "@/lib/services/operations/queue-item.service";

// PHASE 2. `TRANSACTION_EXCEPTION` is the §26 register itself — `queue_items`,
// written by the single `raiseException` writer. The eight tabs that precede it
// are DERIVED views: each re-queries a domain table for a condition that looks
// like an exception (a prequal in MANUAL_REVIEW, a deal stuck in
// INSURANCE_PENDING). They are kept, because they surface conditions no one has
// raised an exception for yet.
//
// `SYSTEM_ALERT` is now a READ-ONLY MIRROR, per §8.4: the SYSTEM_ALERT
// Notification rail is no longer the exception store, and its ~40 writers migrate
// phase by phase. It stays readable so nothing already raised disappears from the
// operator's view.
export type QueueType =
  | "OFAC_ALERT"
  | "CONTRACT_FAIL"
  | "INSURANCE_EXCEPTION"
  | "ESIGN_EXCEPTION"
  | "PICKUP_EXCEPTION"
  | "PREQUAL_MANUAL"
  | "SUPPORT_TICKET"
  | "SYSTEM_ALERT"
  | "TRANSACTION_EXCEPTION";

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
    case "TRANSACTION_EXCEPTION":
      // The §26 register, read through the single writer's own accessor so the
      // open-status set is defined in exactly one place.
      return listOpen({ take: limit });
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
        // Marking a mirrored alert read. This is not exception resolution — the
        // §26 register is TRANSACTION_EXCEPTION below.
        await prisma.notification.update({ where: { id: itemId }, data: { readAt: new Date() } });
        break;
      case "TRANSACTION_EXCEPTION":
        // Through the single writer, which throws when the compare-and-swap
        // matches nothing. An admin may not record a resolution that did not
        // happen — see the catch below.
        await resolveException({ queueItemId: itemId, resolution, resolvedBy: adminId });
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
    // control/X-01. This used to swallow the error and then write a
    // QUEUE_ITEM_RESOLVED audit row anyway, so a failed update produced an audit
    // trail asserting a resolution that never happened — the queue looked handled
    // and the condition stayed live. The error now propagates: the route answers
    // 500, the admin sees the failure, and NO audit row claims success.
    logger.error(`[admin-queue] resolveQueueItem failed for ${queueType}/${itemId}:`, err);
    throw err;
  }

  // Only reached when the resolution actually happened. Awaited, not best-effort:
  // an unrecorded resolution is an unauditable one, and the write is the evidence
  // the queue was worked.
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
  });
}

export async function getQueueCounts(): Promise<Record<QueueType, number>> {
  const [ofac, contractFail, prequal, systemAlerts, insuranceException, esignException, pickupException, supportTickets, transactionExceptions] = await Promise.all([
    prisma.preQualification.count({ where: { checkOfacAlert: true, decision: { in: ["OFAC_REVIEW", "OFAC_ESCALATED"] } } }),
    prisma.contractScan.count({ where: { status: "FAIL" } }),
    prisma.preQualification.count({ where: { decision: "MANUAL_REVIEW" } }),
    prisma.notification.count({ where: { type: "SYSTEM_ALERT", readAt: null } }),
    prisma.deal.count({ where: { status: "INSURANCE_PENDING", updatedAt: { lt: new Date(Date.now() - 72 * 60 * 60 * 1000) } } }),
    prisma.deal.count({ where: { status: "SIGNING_PENDING", updatedAt: { lt: new Date(Date.now() - 48 * 60 * 60 * 1000) } } }),
    prisma.deal.count({ where: { status: "PICKUP_SCHEDULED", updatedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } }),
    prisma.notification.count({ where: { type: "SUPPORT_TICKET", readAt: null } }),
    prisma.queueItem.count({ where: { status: { in: [...OPEN_QUEUE_STATUSES] } } }),
  ]);
  return {
    OFAC_ALERT: ofac,
    CONTRACT_FAIL: contractFail,
    INSURANCE_EXCEPTION: insuranceException,
    ESIGN_EXCEPTION: esignException,
    PICKUP_EXCEPTION: pickupException,
    PREQUAL_MANUAL: prequal,
    SUPPORT_TICKET: supportTickets,
    SYSTEM_ALERT: systemAlerts,
    TRANSACTION_EXCEPTION: transactionExceptions,
  };
}
