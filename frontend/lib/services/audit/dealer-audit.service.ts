// lib/services/audit/dealer-audit.service.ts
// Dealer-initiated audit log writes.
//
// Uses the existing AuditLog Prisma model (admin_id and user_id are both
// nullable; user_id is the dealer's User.id). All writes are best-effort —
// audit logging must never block the underlying business operation.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { AdminActionType, Prisma } from "@prisma/client";

export type DealerAuditAction =
  | "DEALER_OFFER_SUBMITTED"
  | "DEALER_OFFER_REVISED"
  | "DEALER_DOCUMENT_UPLOADED"
  | "DEALER_DEAL_DOCUMENT_LINKED"
  | "DEALER_CONTRACT_SIGNED";

interface DealerAuditInput {
  action: DealerAuditAction;
  dealerId: string;
  dealerUserId?: string | null;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  reason?: string;
}

// AdminActionType is a Postgres enum with a fixed set of values. The AuditLog
// model declares `action` as that enum, so dealer-specific actions are stored
// using STATUS_CHANGE (the most general member) with the real action name
// preserved in metadata.actorAction. This avoids a destructive migration that
// would alter the enum on production.
export async function writeDealerAudit(input: DealerAuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        adminId: null,
        userId: input.dealerUserId ?? null,
        action: AdminActionType.STATUS_CHANGE,
        entityType: input.entityType,
        entityId: input.entityId,
        reason: input.reason ?? null,
        metadata: {
          actorType: "DEALER",
          actorId: input.dealerId,
          actorAction: input.action,
          ...(input.metadata ?? {}),
        } as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    logger.error("[dealer-audit] write failed:", err);
  }
}
