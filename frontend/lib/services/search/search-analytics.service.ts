// lib/services/search/search-analytics.service.ts
import { prisma } from "@/lib/prisma";

export async function logSearchQuery(buyerId: string, query: string, resultCount: number, aiInterpreted: boolean) {
  await prisma.buyerActivityEvent.create({
    data: { buyerId, eventType: "SEARCH_PERFORMED", title: `Searched for: ${query.slice(0, 60)}`, metadata: { query, resultCount, aiInterpreted } as object },
  }).catch(() => {});
}

export async function getTopSearches(limit = 10) {
  return prisma.buyerActivityEvent.groupBy({
    by: ["eventType"],
    where: { eventType: "SEARCH_PERFORMED" },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: limit,
  });
}
