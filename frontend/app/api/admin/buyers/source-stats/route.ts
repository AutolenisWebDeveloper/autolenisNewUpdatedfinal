// GET /api/admin/buyers/source-stats — Phase 5.5 source distribution analytics.
// Aggregates BuyerOpportunity.source into channel + campaign breakdowns so the
// admin UI can answer "which channel brings the most buyers?".
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { parseSource, SOURCE_CHANNELS, type SourceChannel } from "@/lib/admin/buyer-source";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  try {
    const grouped = await prisma.buyerOpportunity.groupBy({
      by: ["source"],
      _count: { _all: true },
    });

    const byChannel: Record<SourceChannel, number> = SOURCE_CHANNELS.reduce(
      (acc, c) => ({ ...acc, [c]: 0 }),
      {} as Record<SourceChannel, number>,
    );
    const byCampaign: Record<string, number> = {};
    let total = 0;
    let nullSourceCount = 0;

    for (const row of grouped) {
      const count = row._count._all;
      total += count;
      if (!row.source) nullSourceCount += count;

      const parsed = parseSource(row.source);
      byChannel[parsed.channel] += count;
      if (parsed.campaign) {
        byCampaign[row.source as string] = (byCampaign[row.source as string] ?? 0) + count;
      }
    }

    console.log(`[phase-5.5] source-stats: total=${total}, nullSource=${nullSourceCount}`);

    return adminSuccess({ total, byChannel, byCampaign, nullSourceCount });
  } catch (err) {
    return adminError(
      "SOURCE_STATS_FAILED",
      err instanceof Error ? err.message : "Failed to compute source stats",
      500,
    );
  }
}
