import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Phase 1 — Dealer Coverage by Market
// Returns active dealer counts aggregated by state (no PII).

export const dynamic = "force-dynamic";
export const revalidate = 3600; // 1-hour cache

interface DealerCoverageEntry {
  state: string;
  count: number;
}

export async function GET() {
  try {
    const dealers = await prisma.dealer.findMany({
      where: { status: "ACTIVE", state: { not: null } },
      select: { state: true },
    });

    const counts: Record<string, number> = {};
    for (const d of dealers) {
      if (d.state) {
        counts[d.state] = (counts[d.state] ?? 0) + 1;
      }
    }

    const data: DealerCoverageEntry[] = Object.entries(counts)
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({ success: true, data });
  } catch {
    return NextResponse.json({ success: true, data: [] });
  }
}
