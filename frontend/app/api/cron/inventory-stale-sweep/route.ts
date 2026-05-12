import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import {
  sendDealerStaleListingRemovalEmail,
  sendDealerInventorySyncFailureEmail,
} from "@/lib/services/email/resend.service";

// Cron: /api/cron/inventory-stale-sweep — Schedule: */30 * * * * (every 30 min)
// ENH-5: Deactivate stale Lane 2/3 vehicles not seen in 48h
// Registered in vercel.json ✓

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const cutoff = new Date(Date.now() - 48 * 3600000);

  // Snapshot the vehicles about to be deactivated so we can email each dealer
  // a list of affected listings. We group by dealer for one email per dealer.
  const aboutToDeactivate = await prisma.inventoryItem.findMany({
    where: {
      lastSeenAt: { lt: cutoff },
      lane: { not: "LANE_1" },
      isActive: true,
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
      lane: { not: "LANE_1" },
      isActive: true,
    },
    data: { isActive: false },
  });

  // Email each affected dealer with their list — non-blocking.
  const byDealer = new Map<string, { year: number; make: string; model: string }[]>();
  for (const item of aboutToDeactivate) {
    if (!item.dealerId) continue;
    const list = byDealer.get(item.dealerId) ?? [];
    list.push({ year: item.year, make: item.make, model: item.model });
    byDealer.set(item.dealerId, list);
  }
  if (byDealer.size > 0) {
    const dealers = await prisma.dealer.findMany({
      where: { id: { in: Array.from(byDealer.keys()) } },
      include: { user: { select: { email: true } } },
    });
    for (const dealer of dealers) {
      if (!dealer.user?.email) continue;
      const affected = byDealer.get(dealer.id) ?? [];
      await sendDealerStaleListingRemovalEmail({
        to: dealer.user.email,
        contactName: dealer.dealershipName,
        affectedVehicles: affected.slice(0, 25),
        reason: "Listings were not refreshed by your feed in the past 48 hours.",
        inventoryUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dealer/inventory`,
      }).catch((err) =>
        console.error(`[inventory-stale-sweep] stale email failed for ${dealer.id}:`, err),
      );
    }
  }

  // Inventory sync failure: dealers with a configured feed that hasn't refreshed
  // anything in > 48h get a sync-failure heads-up. The function is idempotent on
  // (dealerEmail, hour) so duplicate cron ticks within the hour collapse.
  try {
    const staleFeedDealers = await prisma.dealer.findMany({
      where: {
        status: "ACTIVE",
        feedConfig: { isNot: null },
        inventory: {
          // At least one item has gone stale — proxy for "feed broken / not delivering".
          some: { lastSeenAt: { lt: cutoff } },
        },
      },
      include: {
        user: { select: { email: true } },
        feedConfig: { select: { lastSyncAt: true } },
      },
      take: 100,
    });
    for (const dealer of staleFeedDealers) {
      if (!dealer.user?.email) continue;
      const lastSync = dealer.feedConfig?.lastSyncAt;
      await sendDealerInventorySyncFailureEmail({
        to: dealer.user.email,
        contactName: dealer.dealershipName,
        lastSuccessfulSync: lastSync ? lastSync.toLocaleString("en-US") : "Unknown",
        errorCategory: "feed_no_refresh_48h",
        feedSetupUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dealer/inventory/feed-setup`,
      }).catch((err) =>
        console.error(`[inventory-stale-sweep] sync-failure email failed for ${dealer.id}:`, err),
      );
    }
  } catch (err) {
    console.error("[inventory-stale-sweep] sync-failure scan failed:", err);
  }

  return NextResponse.json({ success: true, data: { deactivated, cutoff } });
}
