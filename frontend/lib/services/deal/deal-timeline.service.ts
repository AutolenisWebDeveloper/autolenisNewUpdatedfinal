// lib/services/deal/deal-timeline.service.ts
import { prisma } from "@/lib/prisma";

export async function recordTimelineEvent(dealId: string, stage: string, title: string, description?: string, actorId?: string, actorRole?: string) {
  return prisma.dealTimeline.create({ data: { dealId, stage, title, description, actorId, actorRole } });
}

export async function getDealTimeline(dealId: string) {
  return prisma.dealTimeline.findMany({ where: { dealId }, orderBy: { occurredAt: "asc" } });
}

export async function recordStatusTransition(dealId: string, fromStatus: string, toStatus: string, actorId?: string, actorRole?: string, reason?: string) {
  await Promise.all([
    prisma.dealStatusHistory.create({ data: { dealId, fromStatus, toStatus, actorId, actorRole, reason } }),
    recordTimelineEvent(dealId, toStatus, `${toStatus.replace(/_/g, " ").toLowerCase()}`, reason, actorId, actorRole),
  ]);
}
