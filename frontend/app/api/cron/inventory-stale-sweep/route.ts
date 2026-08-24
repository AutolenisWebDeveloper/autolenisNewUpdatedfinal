import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { prisma } from "@/lib/prisma";
import {
  sendDealerStaleListingRemovalEmail,
  sendDealerInventorySyncFailureEmail,
} from "@/lib/services/email/resend.service";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

// Cron: /api/cron/inventory-stale-sweep — Schedule: */30 * * * * (every 30 min)
// ENH-5: Deactivate stale Lane 2/3 vehicles not seen in 48h
// Registered in vercel.json ✓

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("inventory-stale-sweep", async () => {
  const cutoff = new Date(Date.now() - 48 * 3600000);

  // Snapshot the soon-to-be-deactivated rows grouped by dealer so we can email
  // each affected dealer the list of items we removed.
  const staleItems = await prisma.inventoryItem.findMany({
    where: {
      lastSeenAt: { lt: cutoff },
      lane: { not: "LANE_1" },
      isActive: true,
      dealerId: { not: null },
    },
    select: {
      dealerId: true,
      year: true,
      make: true,
      model: true,
    },
  });

  const { count: deactivated } = await prisma.inventoryItem.updateMany({
    where: {
      lastSeenAt: { lt: cutoff },
      lane: { not: "LANE_1" }, // Never auto-deactivate dealer-verified Lane 1
      isActive: true,
    },
    data: { isActive: false },
  });

  // Group removed items by dealer, then email each dealer their removal list.
  const byDealer = new Map<string, Array<{ year: number; make: string; model: string }>>();
  for (const item of staleItems) {
    if (!item.dealerId) continue;
    const arr = byDealer.get(item.dealerId) ?? [];
    arr.push({ year: item.year, make: item.make, model: item.model });
    byDealer.set(item.dealerId, arr);
  }

  for (const [dealerId, vehicles] of byDealer) {
    const dealer = await prisma.dealer.findUnique({
      where: { id: dealerId },
      include: { user: { select: { email: true } } },
    });
    if (!dealer?.user?.email) continue;
    await sendDealerStaleListingRemovalEmail({
      to: dealer.user.email,
      contactName: dealer.dealershipName,
      affectedVehicles: vehicles.slice(0, 25),
      reason: "Listings were not seen in your feed for over 48 hours.",
      inventoryUrl: `${APP_URL}/dealer/inventory`,
    }).catch(() => {});
  }

  // Detect dealers whose inventory has gone fully stale (no fresh items in the
  // window) and notify them — likely indicates a broken feed/sync.
  const activeDealersWithFeeds = await prisma.dealer.findMany({
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
  const failureCutoff = new Date(Date.now() - 24 * 3600000);
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
    await sendDealerInventorySyncFailureEmail({
      to: dealer.user.email,
      contactName: dealer.dealershipName,
      lastSuccessfulSync: lastSync,
      errorCategory: "FEED_NO_DATA",
      feedSetupUrl: `${APP_URL}/dealer/inventory/feed`,
    }).catch(() => {});
    feedFailureEmails++;
  }

  return { deactivated, cutoff, feedFailureEmails, feedFailureSuppressed };
  });
  if (!run.ok) return NextResponse.json({ success: false, error: "inventory-stale-sweep_failed" }, { status: 500 });

  return NextResponse.json({ success: true, data: run.result });
}
