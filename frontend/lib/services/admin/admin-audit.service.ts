// lib/services/admin/admin-audit.service.ts
import { prisma } from "@/lib/prisma";
import { AdminActionType, Prisma } from "@prisma/client";

export interface AuditLogInput {
  adminId: string;
  adminEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string;
  metadata?: Record<string, unknown>;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  ipAddress?: string;
  sessionId?: string;
}

export async function writeAdminAuditLog(input: AuditLogInput): Promise<void> {
  await prisma.adminAuditLog.create({
    data: {
      ...input,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
      previousState: input.previousState as Prisma.InputJsonValue | undefined,
      newState: input.newState as Prisma.InputJsonValue | undefined,
    },
  });
}

export async function logAdminAction(adminId: string, adminEmail: string, action: AdminActionType, entityType: string, entityId: string, reason?: string, metadata?: Record<string, unknown>) {
  return prisma.adminAuditLog.create({ data: { adminId, adminEmail, action, entityType, entityId, reason, metadata: (metadata ?? {}) as Prisma.InputJsonValue } });
}

export async function getAuditLog(entityType?: string, entityId?: string, limit = 50) {
  return prisma.adminAuditLog.findMany({
    where: { ...(entityType && { entityType }), ...(entityId && { entityId }) },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function logAudit(adminId: string, adminEmail: string, action: string, entityType: string, entityId: string, reason?: string) {
  return prisma.auditLog.create({ data: { adminId, action: action as AdminActionType, entityType, entityId, reason } });
}
