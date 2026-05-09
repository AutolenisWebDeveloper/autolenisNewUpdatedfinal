import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeDealerScorecard } from "@/lib/services/dealer/dealer-scorecard.service";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret =
    !!auth && auth.startsWith(CRON_AUTH_PREFIX) &&
    auth.slice(CRON_AUTH_PREFIX.length) === process.env.CRON_SECRET;
  if (!isVercelCron && !isValidSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dealers = await prisma.dealer.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  let processed = 0;
  const errors: string[] = [];
  for (const dealer of dealers) {
    try {
      const scorecard = await computeDealerScorecard(dealer.id);
      await prisma.dealerScorecardSnapshot.create({
        data: {
          dealerId: dealer.id,
          snapshotDate: new Date(),
          tier: scorecard.tier,
          offerWinRate: scorecard.offerWinRate,
          dealCompletionRate: scorecard.dealCompletionRate,
          auctionResponseRate: scorecard.auctionResponseRate,
          avgResponseHours: scorecard.avgResponseHours,
          junkFeeRatio: scorecard.junkFeeRatio,
        },
      });
      processed++;
    } catch (err) {
      errors.push(`${dealer.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return NextResponse.json({ processed, errors: errors.length, details: errors.slice(0, 10) });
}
