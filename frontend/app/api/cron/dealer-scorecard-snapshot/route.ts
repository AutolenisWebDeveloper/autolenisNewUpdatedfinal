import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { prisma } from "@/lib/prisma";
import { computeDealerScorecard } from "@/lib/services/dealer/dealer-scorecard.service";
import { sendDealerWeeklyScorecardEmail } from "@/lib/services/email/resend.service";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${weekNo.toString().padStart(2, "0")}`;
}

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;
  const run = await withCronRun("dealer-scorecard-snapshot", async () => {
  const dealers = await prisma.dealer.findMany({
    where: { status: "ACTIVE" },
    include: { user: { select: { email: true } } },
  });
  const now = new Date();
  const weekKey = isoWeekKey(now);
  // Idempotency: the snapshot table has no unique constraint on the week, so a
  // second run in the same ISO week (Vercel retry, manual trigger, double-fire)
  // would insert duplicate rows that double-count in the trend chart/history.
  // Guard by skipping any dealer already snapshotted this week.
  const weekStart = new Date(now);
  weekStart.setUTCDate(weekStart.getUTCDate() - 7);
  let processed = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const dealer of dealers) {
    try {
      const existing = await prisma.dealerScorecardSnapshot.findFirst({
        where: { dealerId: dealer.id, snapshotDate: { gte: weekStart } },
        select: { id: true },
      });
      if (existing) {
        skipped++;
        continue;
      }
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

      // Weekly scorecard email to dealer — non-blocking, idempotent per weekKey.
      if (dealer.user?.email) {
        await sendDealerWeeklyScorecardEmail({
          to: dealer.user.email,
          contactName: dealer.dealershipName,
          dealershipName: dealer.dealershipName,
          winRate: scorecard.offerWinRate,
          avgResponseTimeHours: scorecard.avgResponseHours,
          offersSubmitted: scorecard.offersSubmitted,
          currentTier: scorecard.tier,
          scorecardUrl: `${APP_URL}/dealer/dashboard`,
          weekKey,
        }).catch(() => {});
      }

      processed++;
    } catch (err) {
      errors.push(`${dealer.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { processed, skipped, errors: errors.length, details: errors.slice(0, 10) };
  });
  if (!run.ok) return NextResponse.json({ error: "dealer-scorecard-snapshot_failed" }, { status: 500 });

  return NextResponse.json(run.result);
}
