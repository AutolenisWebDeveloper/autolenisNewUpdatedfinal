import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Feature 14A — Platform-wide live statistics.
// All values are derived from real Prisma counts. No hardcoded fallbacks: the
// only acceptable display value is the live count from the database, which is
// 0 for a brand-new platform. Auxiliary stats (avg savings, avg auction bids)
// come from the most recent PlatformStatSnapshot row when present.

export const dynamic = "force-dynamic";
export const revalidate = 300; // 5 minute cache

interface PlatformStats {
  dealsCompleted: number;
  avgSavingsDollars: number;
  verifiedDealers: number;
  buyersServed: number;
  avgAuctionBids: number;
  activeAuctions: number;
  activeInventory: number;
}

async function computeStats(): Promise<PlatformStats> {
  const [
    dealsCompleted,
    dealersActive,
    buyersTotal,
    activeAuctions,
    activeInventory,
    snapshot,
  ] = await Promise.all([
    prisma.deal.count({ where: { status: "COMPLETED" } }),
    prisma.dealer.count({ where: { status: "ACTIVE" } }),
    prisma.buyer.count(),
    prisma.auction.count({ where: { status: "ACTIVE" } }),
    prisma.inventoryItem.count({ where: { isActive: true } }),
    prisma.platformStatSnapshot.findFirst({ orderBy: { snapshotDate: "desc" } }),
  ]);

  return {
    dealsCompleted,
    avgSavingsDollars: snapshot ? Math.round(snapshot.avgSavings / 100) : 0,
    verifiedDealers: dealersActive,
    buyersServed: buyersTotal,
    avgAuctionBids: snapshot?.avgAuctionBids ?? 0,
    activeAuctions,
    activeInventory,
  };
}

export async function GET() {
  try {
    const stats = await computeStats();
    return NextResponse.json({ success: true, data: stats });
  } catch (err) {
    logger.error("[platform-stats] Database error:", err);
    return NextResponse.json(
      {
        error: {
          code: "STATS_UNAVAILABLE",
          message: "Platform statistics are temporarily unavailable.",
        },
        correlationId: crypto.randomUUID(),
      },
      { status: 503 },
    );
  }
}
