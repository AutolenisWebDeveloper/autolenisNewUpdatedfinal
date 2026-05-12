import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeDealerScorecard } from "@/lib/services/dealer/dealer-scorecard.service";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { sendDealerWeeklyScorecardEmail } from "@/lib/services/email/resend.service";

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
  const dealers = await prisma.dealer.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      dealershipName: true,
      user: { select: { email: true } },
    },
  });
  let processed = 0;
  const errors: string[] = [];
  // Idempotency week key (ISO year-week) — keeps weekly emails dedup'd if cron retries.
  const now = new Date();
  const weekKey = `${now.getUTCFullYear()}-W${Math.ceil(((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7)}`;
  const isMonday = now.getUTCDay() === 1; // Send the weekly email on Mondays only.

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

      // Weekly scorecard email — once per dealer per week (idempotency key uses weekKey).
      if (isMonday && dealer.user?.email) {
        const offersSubmitted = await prisma.offer.count({
          where: {
            dealerId: dealer.id,
            createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
          },
        });
        await sendDealerWeeklyScorecardEmail({
          to: dealer.user.email,
          contactName: dealer.dealershipName,
          dealershipName: dealer.dealershipName,
          winRate: scorecard.offerWinRate,
          avgResponseTimeHours: scorecard.avgResponseHours,
          offersSubmitted,
          currentTier: scorecard.tier,
          scorecardUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dealer/scorecard`,
          weekKey,
        }).catch((err) => console.error(`[scorecard-snapshot] email failed for ${dealer.id}:`, err));
      }

      processed++;
    } catch (err) {
      errors.push(`${dealer.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return NextResponse.json({ processed, errors: errors.length, details: errors.slice(0, 10) });
}
