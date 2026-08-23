// Dealer-award dispatch — internal Vercel-Cron substrate (migrated off the Inngest
// worker `dealerAwardFn` / `autolenis/dealer.award`).
//
// On offer acceptance, select-offer creates the Deal (with the winning offerId).
// This drain scans offer-accepted deals whose `dealerAwardDispatchedAt` marker is
// still NULL and dispatches the winner-award + non-award close-out notifications
// via the SAME `emitDealerAwardOutcomes` the worker called — then stamps the
// marker so the deal is never re-dispatched. The marker survives request-context
// death, which is the exact durability the Inngest worker provided (select-offer's
// `after()` could die before dispatch).
//
// The Deal marker IS the durable terminal state (columns-only — nothing is written
// to jobs_dead_letter, so the Inngest DLQ drainer can never re-emit a dealer-award
// job). `claimJob` is a short concurrency LEASE only: released on success (the
// marker is then the source of truth) and left 'failed' → reclaimable on failure,
// so a stamp-failure can never strand a deal. `emitDealerAwardOutcomes` is itself
// idempotent (per-recipient email dedup + in-app Notification dedup), so a re-drive
// never double-notifies.
//
// HISTORICAL SAFETY: the migration backfills every existing offer-accepted deal's
// marker = created_at, and this scan is additionally bounded to a recent window,
// so the cron can NEVER mass-notify dealers about historical auctions.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getSupabase, claimJob, updateIdempotencyState, releaseIdempotencyGuard } from "@/lib/jobs/idempotency";
import { emitDealerAwardOutcomes } from "@/lib/services/notifications/dealer-award";

const BATCH = 50;
// Belt-and-suspenders historical floor on top of the migration backfill.
const WINDOW_HOURS = 24 * 7;
// A claim older than this is reclaimable (a prior drain died mid-dispatch). MUST
// exceed the drain route's maxDuration.
const STALE_MS = 10 * 60 * 1000;

export interface DealerAwardDrainResult {
  status: "OK" | "NO_PENDING";
  scanned: number;
  dispatched: number;
  skipped: number;
  failed: number;
}

export async function drainDealerAwardDispatch(): Promise<DealerAwardDrainResult> {
  const since = new Date(Date.now() - WINDOW_HOURS * 3600 * 1000);

  const deals = await prisma.deal.findMany({
    where: {
      offerId: { not: null },
      dealerAwardDispatchedAt: null,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "asc" },
    take: BATCH,
    select: { id: true, offerId: true, offer: { select: { auctionId: true } } },
  });

  if (deals.length === 0) {
    return { status: "NO_PENDING", scanned: 0, dispatched: 0, skipped: 0, failed: 0 };
  }

  const supabase = getSupabase();
  let dispatched = 0;
  let skipped = 0;
  let failed = 0;

  for (const deal of deals) {
    const auctionId = deal.offer?.auctionId ?? null;
    if (!deal.offerId || !auctionId) {
      // A deal with offerId set but no resolvable auction can't be dispatched;
      // stamp it so it isn't re-scanned forever.
      await prisma.deal.update({
        where: { id: deal.id },
        data: { dealerAwardDispatchedAt: new Date() },
      });
      skipped++;
      continue;
    }

    const key = `dealer-award:${deal.id}`;
    const claimed = await claimJob(supabase, key, { staleMs: STALE_MS });
    if (!claimed) {
      skipped++;
      continue;
    }

    try {
      await emitDealerAwardOutcomes({ auctionId, winningOfferId: deal.offerId, dealId: deal.id });
      // Stamp the durable terminal marker FIRST, then release the lease. If the
      // stamp fails, we fall into catch → guard left 'failed' → reclaimed next tick
      // and re-driven (idempotent), never stranded.
      await prisma.deal.update({
        where: { id: deal.id },
        data: { dealerAwardDispatchedAt: new Date() },
      });
      await releaseIdempotencyGuard(supabase, key);
      dispatched++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await updateIdempotencyState(supabase, key, "failed", { error: message });
      logger.error(`[dealer-award-dispatch] dispatch failed for deal ${deal.id}`, message);
      failed++;
    }
  }

  return { status: "OK", scanned: deals.length, dispatched, skipped, failed };
}
