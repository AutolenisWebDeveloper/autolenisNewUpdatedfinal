// Social Engine — Cron 1: Daily Topic Signal Scan.
// Scans existing AutoLenis intelligence and materializes fresh TopicSignals.
// Schedule: 0 5 * * * (05:00 UTC ≈ midnight CT).

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
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

  const run = await withCronRun("social-signal-scan", async () => {
  // The core scan is the primary work; a throw here must not abort the whole
  // run (and skip the trending block below) with an unhandled 500. Degrade to
  // zero signals and let the trending pass still run.
  let signals: Awaited<ReturnType<typeof scanForTopicSignals>> = [];
  try {
    signals = await scanForTopicSignals();
  } catch (err) {
    logger.error("[signal-scan] scanForTopicSignals failed (non-fatal):", err);
  }

  // Trending intelligence (Session C): fetch + cache live trends and materialize
  // TopicSignals from the top Reddit topics and Google Trends so the generator
  // can ride what buyers are actually searching/asking right now. Non-fatal.
  try {
    const { fetchTrendingIntelligence, cacheTrendingData } = await import(
      "@/lib/social/trending-intelligence.engine"
    );
    const trending = await fetchTrendingIntelligence();
    await cacheTrendingData(trending);

    // Dedupe against trending signals still live from an earlier run today so a
    // re-run/retry doesn't materialize duplicate trending signals the generator
    // would then ride twice.
    const existingTrending = await prisma.topicSignal.findMany({
      where: {
        signalType: { in: ["trending_topic", "trending_search"] },
        expiresAt: { gt: new Date() },
      },
      select: { signalContext: true },
    });
    const seen = new Set(
      existingTrending.map((s) => {
        const ctx = (s.signalContext ?? {}) as { topic?: string; trend?: string };
        return (ctx.topic ?? ctx.trend ?? "").toLowerCase();
      }),
    );

    // Create TopicSignal for top Reddit topics.
    for (const topic of trending.redditTopics.slice(0, 3)) {
      if (seen.has(topic.toLowerCase())) continue;
      seen.add(topic.toLowerCase());
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
      if (seen.has(trend.toLowerCase())) continue;
      seen.add(trend.toLowerCase());
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
  return summary;
  });
  if (!run.ok) {
    return NextResponse.json({ success: false, error: "social-signal-scan_failed" }, { status: 500 });
  }
  return NextResponse.json({ success: true, data: run.result });
}
