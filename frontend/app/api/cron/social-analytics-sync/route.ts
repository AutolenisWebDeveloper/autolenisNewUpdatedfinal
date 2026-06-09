// Social Engine — Cron 6: Performance Analytics Sync.
// Pulls interaction metrics for recently published posts, snapshots them as
// SocialPerformance rows, and recomputes each post's lead score.
// Schedule: 0 14 * * * (14:00 UTC daily).
//
// Conversion fields (vehicleRequests/dealsWon) are wired in Session 2 from the
// UTM revenue-attribution chain; for now they default to 0 and the lead score
// reflects engagement + clicks only.

import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { getPublishingProvider } from "@/lib/social/providers/publishing.factory";
import { checkViralSignals, handleViralAlert } from "@/lib/social/viral-detection.engine";

export const maxDuration = 300;

const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

// leadScore = linkClicks×1 + shares×2 + vehicleRequests×10 + dealerSignups×20 + dealsWon×50
function computeLeadScore(p: {
  linkClicks: number;
  shares: number;
  vehicleRequests: number;
  dealerSignups: number;
  dealsWon: number;
}): number {
  return p.linkClicks * 1 + p.shares * 2 + p.vehicleRequests * 10 + p.dealerSignups * 20 + p.dealsWon * 50;
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const since = new Date(Date.now() - LOOKBACK_MS);

  const posts = await prisma.socialPost.findMany({
    where: { status: "PUBLISHED", platformPostId: { not: null }, publishedAt: { gte: since } },
    include: { franchise: true },
    take: 100,
  });

  let recorded = 0;
  for (const post of posts) {
    if (!post.platformPostId) continue;
    try {
      // Provider is resolved per-platform so LinkedIn posts use the LinkedIn
      // provider and everything else uses Buffer.
      const provider = getPublishingProvider(post.platform);
      const a = await provider.getAnalytics(post.platformPostId);
      const metrics = {
        impressions: a.impressions ?? 0,
        reach: a.reach,
        views: a.views ?? 0,
        likes: a.likes,
        comments: a.comments,
        shares: a.shares,
        linkClicks: a.clicks,
        vehicleRequests: 0,
        dealerSignups: 0,
        dealsWon: 0,
      };
      const leadScore = computeLeadScore({
        linkClicks: metrics.linkClicks,
        shares: metrics.shares,
        vehicleRequests: metrics.vehicleRequests,
        dealerSignups: metrics.dealerSignups,
        dealsWon: metrics.dealsWon,
      });

      const perf = await prisma.socialPerformance.create({
        data: { postId: post.id, ...metrics, leadScore },
      });
      await prisma.socialPost.update({ where: { id: post.id }, data: { leadScore } });
      recorded += 1;

      // Feed the video-learning engine so the Groq engine learns which hook
      // types win per platform/franchise (Session C). Best-effort, never fatal.
      try {
        const { recordVideoLearning } = await import(
          "@/lib/social/video-learning.engine"
        );
        await recordVideoLearning(
          {
            id: post.id,
            platform: post.platform,
            hookType: post.hookType,
            franchise: post.franchise,
          },
          {
            completionRate: perf.completionRate,
            linkClicks: perf.linkClicks ?? 0,
            impressions: perf.impressions ?? 0,
            vehicleRequests: perf.vehicleRequests ?? 0,
          },
        ).catch((err) =>
          console.error("[analytics-sync] video learning:", err),
        );
      } catch (err) {
        console.error("[analytics-sync] video learning block:", err);
      }
    } catch (err) {
      console.error(`[social-analytics-sync] failed post ${post.id}:`, err instanceof Error ? err.message : err);
    }
  }

  // Check for viral signals after syncing performance data. Velocity is
  // computed from the freshly-recorded SocialPerformance rows above.
  let viralAlertCount = 0;
  try {
    const viralAlerts = await checkViralSignals();
    for (const alert of viralAlerts) {
      await handleViralAlert(alert);
    }
    viralAlertCount = viralAlerts.length;
    if (viralAlerts.length > 0) {
      console.log(`[social-analytics-sync] viral alerts: ${viralAlerts.length}`);
    }
  } catch (viralErr) {
    console.error("[social-analytics-sync] viral detection failed:", viralErr);
    // Non-fatal — continue.
  }

  const summary = {
    considered: posts.length,
    recorded,
    viralAlerts: viralAlertCount,
    timestamp: new Date().toISOString(),
  };
  console.log("[social-analytics-sync]", JSON.stringify(summary));
  return NextResponse.json({ success: true, data: summary });
}
