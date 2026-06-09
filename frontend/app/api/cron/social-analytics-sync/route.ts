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

      await prisma.socialPerformance.create({ data: { postId: post.id, ...metrics, leadScore } });
      await prisma.socialPost.update({ where: { id: post.id }, data: { leadScore } });
      recorded += 1;
    } catch (err) {
      console.error(`[social-analytics-sync] failed post ${post.id}:`, err instanceof Error ? err.message : err);
    }
  }

  // Resolve A/B test groups now that fresh performance data has landed: pick
  // the winning hook variant, record it in HookPerformance, and skip the losers.
  try {
    const { resolveAbTests } = await import("@/lib/social/ab-test-resolver");
    const resolved = await resolveAbTests();
    if (resolved.length > 0) {
      console.log(`[analytics-sync] resolved ${resolved.length} A/B tests`);
    }
  } catch (err) {
    console.error("[analytics-sync] A/B resolution failed:", err);
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
