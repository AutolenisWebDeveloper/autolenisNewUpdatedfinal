// lib/services/ai/context-cache.service.ts
import { prisma } from "@/lib/prisma";

export async function getCachedContext(buyerId: string) {
  return prisma.aiContextCache.findUnique({ where: { buyerId } });
}

export async function updateContextCache(buyerId: string, summary: string, concerns: string[], preferences: Record<string, unknown>) {
  return prisma.aiContextCache.upsert({
    where: { buyerId },
    create: { buyerId, summary, concerns, keyFacts: preferences as object },
    update: { summary, concerns, keyFacts: preferences as object },
  });
}
