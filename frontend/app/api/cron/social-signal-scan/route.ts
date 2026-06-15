// Social Engine — Cron 1: Daily Topic Signal Scan.
// Scans existing AutoLenis intelligence and materializes fresh TopicSignals.
// Schedule: 0 5 * * * (05:00 UTC ≈ midnight CT).

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { scanForTopicSignals } from "@/lib/social/topic-signal.engine";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const signals = await scanForTopicSignals();

  // Trending intelligence (Session C): fetch + cache live trends and materialize
  // TopicSignals from the top Reddit topics and Google Trends so the generator
  // can ride what buyers are actually searching/asking right now. Non-fatal.
  try {
    const { fetchTrendingIntelligence, cacheTrendingData } = await import(
      "@/lib/social/trending-intelligence.engine"
    );
    const trending = await fetchTrendingIntelligence();
    await cacheTrendingData(trending);

    // Create TopicSignal for top Reddit topics.
    for (const topic of trending.redditTopics.slice(0, 3)) {
      await prisma.topicSignal
        .create({
          data: {
            signalType: "trending_topic",
            signalContext: {
              topic,
              source: "reddit",
              trendingHashtags: trending.tiktokHashtags,
            } as object,
            detectedAt: new Date(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            assetsGenerated: false,
          },
        })
        .catch(() => {});
    }

    // Create TopicSignal for Google Trends.
    for (const trend of trending.googleTrends.slice(0, 2)) {
      await prisma.topicSignal
        .create({
          data: {
            signalType: "trending_search",
            signalContext: {
              trend,
              source: "google_trends",
              trendingHashtags: trending.tiktokHashtags,
            } as object,
            detectedAt: new Date(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            assetsGenerated: false,
          },
        })
        .catch(() => {});
    }

    logger.info(
      "[signal-scan] trending:",
      trending.tiktokHashtags.length,
      "hashtags,",
      trending.redditTopics.length,
      "topics",
    );
  } catch (err) {
    logger.error("[signal-scan] trending fetch failed (non-fatal):", err);
  }

  const summary = {
    signalsCreated: signals.length,
    byType: signals.reduce<Record<string, number>>((acc, s) => {
      acc[s.signalType] = (acc[s.signalType] ?? 0) + 1;
      return acc;
    }, {}),
    timestamp: new Date().toISOString(),
  };
  logger.info("[social-signal-scan]", JSON.stringify(summary));
  return NextResponse.json({ success: true, data: summary });
}
