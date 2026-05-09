// lib/services/admin/admin-support.service.ts — System 13 impersonation + notes

import { prisma } from "@/lib/prisma";
import { SupportNoteType, ImpersonationStatus } from "@prisma/client";

export async function addSupportNote(adminId: string, targetUserId: string, content: string, type: SupportNoteType = SupportNoteType.GENERAL) {
  return prisma.adminSupportNote.create({
    data: { adminId, targetUserId, type, content, isInternal: true },
  });
}

export async function startImpersonation(adminId: string, targetUserId: string, reason: string) {
  return prisma.adminImpersonation.create({
    data: { adminId, targetUserId, reason, status: ImpersonationStatus.ACTIVE, startedAt: new Date() },
  });
}

export async function endImpersonation(impersonationId: string) {
  return prisma.adminImpersonation.update({
    where: { id: impersonationId },
    data: { status: ImpersonationStatus.ENDED, endedAt: new Date() },
  });
}

export async function getSupportNotes(targetUserId: string) {
  return prisma.adminSupportNote.findMany({ where: { targetUserId }, orderBy: { createdAt: "desc" } });
}
