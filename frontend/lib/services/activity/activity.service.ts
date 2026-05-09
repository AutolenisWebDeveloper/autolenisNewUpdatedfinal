// lib/services/activity/activity.service.ts — F18 + F24

import { prisma } from "@/lib/prisma";

export async function logActivity(buyerId: string, eventType: string, title: string, metadata?: Record<string, unknown>): Promise<void> {
  await prisma.buyerActivityEvent.create({
    data: { buyerId, eventType, title, metadata: (metadata ?? {}) as object },
  }).catch(() => {});
}

export async function getBuyerActivity(buyerId: string, limit = 50) {
  return prisma.buyerActivityEvent.findMany({
    where: { buyerId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getPlatformActivity(limit = 100) {
  return prisma.buyerActivityEvent.findMany({
    include: { buyer: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
