// Saved-search matcher — internal Vercel-Cron substrate (migrated off the retired
// Inngest `savedSearchMatcherFn`). Every run it scans each saved search for
// inventory created since the search's last match cursor (`lastMatchAt`, falling
// back to the search's `createdAt`). When new matching items exist it pushes a
// `saved_search_matched` domain event (forwarded to the CRM spine for the
// "matching vehicle available" alert) and advances the per-search cursor so the
// SAME items never re-alert — that cursor advance IS the dedup, unchanged by the
// transport swap.
//
// No `inngest.send` fan-out lived in the original function body (the alert rides
// the emit spine, not a direct send), so this is a 1:1 substrate move. Bounded to
// SCAN_LIMIT searches per run; per-search failures are isolated.

import { logger } from "@/lib/logger";
import { Prisma } from "@prisma/client";
import { getServiceSupabase } from "@/lib/supabase-service";
import { prisma } from "@/lib/prisma";
import { emitDomainEvent } from "@/lib/events/emit";
import { buildInventoryWhereFromFilters } from "@/lib/crm/saved-search-filters";

const SCAN_LIMIT = 500;

export interface SavedSearchMatchResult {
  status: "OK" | "NO_SAVED_SEARCHES";
  scanned: number;
  alerted: number;
}

export async function matchSavedSearches(): Promise<SavedSearchMatchResult> {
  const supabase = getServiceSupabase();
  const runAt = new Date();

  const searches = await prisma.savedSearch.findMany({
    take: SCAN_LIMIT,
    orderBy: { lastMatchAt: { sort: "asc", nulls: "first" } },
    include: { buyer: { include: { user: true } } },
  });

  if (searches.length === 0) return { status: "NO_SAVED_SEARCHES", scanned: 0, alerted: 0 };

  let alerted = 0;
  let scanned = 0;
  for (const s of searches) {
    scanned++;
    const buyer = s.buyer;
    const email = buyer?.user?.email ?? null;
    const phone = buyer?.phone ?? null;
    // No addressable identity → nothing to notify.
    if (!email && !phone) continue;

    try {
      const filters = (s.filters ?? {}) as Record<string, unknown>;
      const since = s.lastMatchAt ?? s.createdAt;
      const where: Prisma.InventoryItemWhereInput = {
        ...buildInventoryWhereFromFilters(filters),
        isActive: true,
        createdAt: { gt: since },
      };

      const matchCount = await prisma.inventoryItem.count({ where });
      if (matchCount === 0) continue;

      const sample = await prisma.inventoryItem.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { id: true, year: true, make: true, model: true, priceCents: true },
      });

      await emitDomainEvent("saved_search_matched", {
        // Vary the key per run so genuinely new matches over time each emit (the
        // lastMatchAt cursor below prevents re-alerting the SAME items).
        domainEntityId: `${s.id}:${runAt.toISOString()}`,
        supabase,
        contact: {
          email,
          phone,
          firstName: buyer?.firstName ?? undefined,
          lastName: buyer?.lastName ?? undefined,
          source: "saved_search",
        },
        data: {
          saved_search_id: s.id,
          buyer_id: s.buyerId,
          name: s.name,
          match_count: matchCount,
          since,
          sample,
          zip: buyer?.zip ?? null,
          state: buyer?.state ?? null,
        },
      });

      await prisma.savedSearch.update({
        where: { id: s.id },
        data: { lastMatchAt: runAt, matchCount: { increment: matchCount } },
      });
      alerted++;
    } catch (err) {
      // One search's failure must not block the rest of the batch.
      logger.error("[saved-search-matcher] scan failed", s.id, err);
    }
  }

  return { status: "OK", scanned, alerted };
}
