import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { prisma } from "@/lib/prisma";
import { DEALER_STALE_LISTING_REMOVAL_SUBJECT, renderDealerStaleListingRemovalEmail } from "@/lib/services/email/templates/dealer-stale-listing-removal";
import { DEALER_INVENTORY_SYNC_FAILURE_SUBJECT, renderDealerInventorySyncFailureEmail } from "@/lib/services/email/templates/dealer-inventory-sync-failure";
import { enqueueTransactional } from "@/lib/services/comms/transactional-dispatcher.service";
import { logger } from "@/lib/logger";
import { INVENTORY_DEALER_TEMPLATES } from "@/lib/services/comms/state-recheck-registry";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
import { sweepStaleInventory, staleSweepWhere, sweepMode } from "@/lib/services/inventory/stale-sweep.service";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

// Cron: /api/cron/inventory-stale-sweep — Schedule: 30 8 * * * (daily, 30 min after the sync)
// Registered in vercel.json ✓ and CRON_STALENESS ✓
//
// WHY DAILY, NOT EVERY 30 MINUTES. This cron makes ZERO provider calls, so the old
// */30 cadence cost no quota — but it could not do any useful work either. A row's
// last_seen_at is written by ingestion and by NOTHING else, so once the sync is daily,
// running the sweep more often cannot change any row's outcome. The other 47 daily runs
// were empty updateMany calls plus 47 extra dealer.findMany + per-dealer count() loops and
// 47 extra chances to re-send the feed-failure email (which, unlike the removal email, has
// no suppression). :30 places it after the 08:00 sync so it always evaluates a
// just-refreshed catalogue and can never race an in-flight walk.
// Cost of the change, stated: worst-case deactivation lag moves from 48-48.5h to 48-72h.
//
// THE PREDICATE LIVES IN stale-sweep.service.ts, NOT HERE. It used to be inlined in this
// route AND duplicated inside runInventorySync, and both copies carried the same defect:
// `lane != LANE_1` as a stand-in for "dealer-verified", which permanently protected 95
// production rows that were LANE_1 with no dealer at all.

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("inventory-stale-sweep", async () => {
    const now = new Date();
    const mode = sweepMode();

    // Snapshot the dealer-owned rows about to be deactivated, so each affected dealer can
    // be told which of their listings we removed. Derived from the SAME predicate as the
    // sweep, with dealerId as an ADDITIONAL filter for the email list only — dealer-owned
    // LANE_2/LANE_3 rows stay sweepable precisely so this email remains reachable.
    const staleItems = mode === "off" ? [] : await prisma.inventoryItem.findMany({
      where: { AND: [staleSweepWhere(now), { dealerId: { not: null } }] },
      select: { dealerId: true, year: true, make: true, model: true },
    });

    const result = await sweepStaleInventory({ now, mode });

    // Only tell a dealer their listing was removed if it ACTUALLY was. In dry_run and when
    // the blast-radius breaker fires, nothing was deactivated, so an email would be a lie.
    const notified = result.deactivated > 0 && !result.aborted;

    const byDealer = new Map<string, Array<{ year: number; make: string; model: string }>>();
    if (notified) {
      for (const item of staleItems) {
        if (!item.dealerId) continue;
        const arr = byDealer.get(item.dealerId) ?? [];
        arr.push({ year: item.year, make: item.make, model: item.model });
        byDealer.set(item.dealerId, arr);
      }
    }

    for (const [dealerId, vehicles] of byDealer) {
      const dealer = await prisma.dealer.findUnique({
        where: { id: dealerId },
        include: { user: { select: { email: true } } },
      });
      if (!dealer?.user?.email) continue;
      // §27 / jobs/I-22: through the durable outbox, never the direct rail. The direct
      // rail applies NO suppression, so a dealer who bounced or unsubscribed was
      // re-emailed on every sweep — nightly, forever. The dispatcher checks suppression
      // on every send and re-reads dealer status at dispatch.
      //
      // The key carries the DAY, not Date.now(). The retired direct call used a
      // millisecond timestamp, which made its "idempotency" key unique on every run and
      // therefore no idempotency at all.
      await enqueueTransactional({
        triggerEvent: "inventory.stale_listings_removed",
        templateKey: INVENTORY_DEALER_TEMPLATES.STALE_LISTING_REMOVAL,
        channel: "email",
        recipientKind: "dealer",
        recipientId: dealerId,
        to: dealer.user.email,
        idempotencyKey: `${INVENTORY_DEALER_TEMPLATES.STALE_LISTING_REMOVAL}:${dealerId}:${now.toISOString().slice(0, 10)}`,
        payload: {
          // The recipient, in the only place the drain can read it. `to` above is validated
          // and then discarded — `comms_outbox` has no address column — so without this the
          // row was delivered to `undefined`.
          email: dealer.user.email,
          subject: DEALER_STALE_LISTING_REMOVAL_SUBJECT,
          html: renderDealerStaleListingRemovalEmail({
            contactName: dealer.dealershipName,
            affectedVehicles: vehicles.slice(0, 25),
            reason: "Listings were not seen in your feed for over 48 hours.",
            inventoryUrl: `${APP_URL}/dealer/inventory`,
          }),
        },
      }).catch((err) => {
        // LOGGED, not swallowed. `enqueueTransactional` throws on two real misconfigurations
        // — no registered state recheck for the template, and a missing recipient address —
        // and both were silent here, so a template that could never send looked identical to
        // one that sent fine. Found in review. It still does not fail the sweep: the
        // deactivation is the job, and the notification is not.
        logger.error("[inventory-stale-sweep] removal enqueue failed for dealer:", err);
      });
    }

    // Detect dealers whose inventory has gone fully stale (no fresh items in the window)
    // and notify them — likely indicates a broken feed/sync.
    const activeDealersWithFeeds = mode === "off" ? [] : await prisma.dealer.findMany({
      where: { status: "ACTIVE", feedConfig: { isNot: null } },
      include: {
        user: { select: { email: true } },
        feedConfig: true,
      },
    }).catch(() => [] as Array<{
      id: string;
      dealershipName: string;
      user: { email: string } | null;
      feedConfig: { lastSyncAt: Date | null } | null;
    }>);
    const failureCutoff = new Date(now.getTime() - 24 * 3600000);
    let feedFailureEmails = 0;
    let feedFailureSuppressed = 0;
    for (const dealer of activeDealersWithFeeds) {
      if (!dealer.user?.email) continue;
      const freshCount = await prisma.inventoryItem.count({
        where: { dealerId: dealer.id, lastSeenAt: { gte: failureCutoff } },
      }).catch(() => 1);
      if (freshCount > 0) continue;
      // FS-G fix (Batch 1): only claim a "feed sync failure" when a feed sync was
      // actually ATTEMPTED (feedConfig.lastSyncAt set). The dealer-feed puller is not
      // wired yet, so lastSyncAt is null — blaming the dealer for a sync the platform
      // never runs is a false signal. Suppress it and account for the suppression.
      if (!dealer.feedConfig?.lastSyncAt) {
        feedFailureSuppressed++;
        continue;
      }
      const lastSync = dealer.feedConfig.lastSyncAt.toISOString().slice(0, 10);
      // Onto the dispatcher, with a recheck that skips when the feed recovered between
      // this sweep and the drain — the canonical §27 case, and one the direct rail
      // (which the route comment above notes "has no suppression") could not express.
      await enqueueTransactional({
        triggerEvent: "inventory.dealer_feed_no_data",
        templateKey: INVENTORY_DEALER_TEMPLATES.INVENTORY_SYNC_FAILURE,
        channel: "email",
        recipientKind: "dealer",
        recipientId: dealer.id,
        to: dealer.user.email,
        idempotencyKey: `${INVENTORY_DEALER_TEMPLATES.INVENTORY_SYNC_FAILURE}:${dealer.id}:${now.toISOString().slice(0, 10)}`,
        payload: {
          email: dealer.user.email,
          subject: DEALER_INVENTORY_SYNC_FAILURE_SUBJECT,
          html: renderDealerInventorySyncFailureEmail({
            contactName: dealer.dealershipName,
            lastSuccessfulSync: lastSync,
            errorCategory: "FEED_NO_DATA",
            // `/dealer/inventory/feed` does not exist and never did. The page is
            // `app/dealer/inventory/feed-setup/page.tsx`, so the one call to action in a
            // "your feed has stopped sending us data" email landed on a 404.
            feedSetupUrl: `${APP_URL}/dealer/inventory/feed-setup`,
          }),
        },
      })
        // The counter moves ONLY on a successful enqueue. It used to increment unconditionally
        // beside a swallowed rejection, so the run reported messages that were never queued.
        .then(() => { feedFailureEmails++; })
        .catch((err) => {
          logger.error("[inventory-stale-sweep] feed-failure enqueue failed for dealer:", err);
        });
    }

    return {
      mode: result.mode,
      skipped: result.skipped,
      candidates: result.candidates,
      deactivated: result.deactivated,
      aborted: result.aborted,
      abortThreshold: result.abortThreshold,
      breakdown: result.breakdown,
      // Recorded so rollback is a literal UPDATE ... WHERE id IN (...) rather than a
      // re-derivation from a predicate that has since changed.
      deactivatedIds: result.deactivatedIds,
      idsTruncated: result.idsTruncated,
      cutoff: result.cutoff,
      dealersNotified: byDealer.size,
      feedFailureEmails,
      feedFailureSuppressed,
    };
  });

  if (!run.ok) return NextResponse.json({ success: false, error: "inventory-stale-sweep_failed" }, { status: 500 });

  return NextResponse.json({ success: true, data: run.result });
}
