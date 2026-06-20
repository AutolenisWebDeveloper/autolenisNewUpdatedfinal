// AutoLenis Social Engine — Video Learning Engine (Session C, Option B).
//
// Learns which hook types drive the highest video completion (and CTR) per
// platform + franchise, maintained as a rolling average on WinningPattern. The
// orchestrator reads these learnings back into the generation prompt so the
// engine keeps steering toward what actually holds attention.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

export interface VideoLearnings {
  bestHookTypes: { hookType: string; avgCompletion: number }[];
  worstHookTypes: string[];
  insights: string[];
}

export async function recordVideoLearning(
  post: {
    id: string;
    platform: string;
    hookType: string | null;
    franchise?: { slug: string } | null;
  },
  performance: {
    completionRate: number | null;
    linkClicks: number;
    impressions: number;
    vehicleRequests: number;
  },
): Promise<void> {
  if (!post.hookType) return;

  const ctr =
    (performance.impressions ?? 0) > 0
      ? (performance.linkClicks ?? 0) / performance.impressions
      : 0;

  const completion = performance.completionRate ?? 0;
  const franchiseSlug = post.franchise?.slug ?? null;

  try {
    // Check if pattern exists.
    const existing = await prisma.winningPattern.findFirst({
      where: {
        platform: post.platform,
        franchiseSlug,
        hookType: post.hookType,
      },
    });

    if (existing) {
      // Rolling average: (existing × n + new) / (n + 1)
      const n = existing.sampleSize;
      const newAvgCompletion =
        existing.avgCompletionRate !== null
          ? (existing.avgCompletionRate * n + completion) / (n + 1)
          : completion;
      const newAvgCtr =
        existing.avgCtr !== null
          ? (existing.avgCtr * n + ctr) / (n + 1)
          : ctr;

      await prisma.winningPattern.update({
        where: { id: existing.id },
        data: {
          avgCompletionRate: newAvgCompletion,
          avgCtr: newAvgCtr,
          sampleSize: { increment: 1 },
          lastUpdated: new Date(),
        },
      });
    } else {
      await prisma.winningPattern.create({
        data: {
          platform: post.platform,
          franchiseSlug,
          hookType: post.hookType,
          avgCompletionRate: completion,
          avgCtr: ctr,
          sampleSize: 1,
          lastUpdated: new Date(),
        },
      });
    }
  } catch (err) {
    logger.error("[video-learning] record failed:", err);
  }
}

export async function getVideoLearnings(
  platform: string,
): Promise<VideoLearnings> {
  const patterns = await prisma.winningPattern.findMany({
    where: {
      platform,
      hookType: { not: null },
      sampleSize: { gte: 3 },
    },
    orderBy: { avgCompletionRate: "desc" },
  });

  if (patterns.length === 0) {
    return { bestHookTypes: [], worstHookTypes: [], insights: [] };
  }

  const best = patterns.slice(0, 3).map((p) => ({
    hookType: p.hookType!,
    avgCompletion: Math.round((p.avgCompletionRate ?? 0) * 100),
  }));

  // Only surface "worst" hooks when there are enough patterns that the bottom
  // two cannot overlap the top three (best = indices 0-2). With fewer than 5
  // patterns slice(-2) would re-list a "best" hook as "worst", producing a
  // self-contradictory insight ("X gets 80% completion vs … for X").
  const worst =
    patterns.length >= 5
      ? patterns
          .slice(-2)
          .map((p) => p.hookType!)
          .filter(Boolean)
      : [];

  const insights: string[] = [];
  if (best[0] && worst[0]) {
    insights.push(
      `${best[0].hookType} hooks on ${platform} get ` +
        `${best[0].avgCompletion}% completion vs ` +
        `${Math.round((patterns[patterns.length - 1]?.avgCompletionRate ?? 0) * 100)}% ` +
        `for ${worst[0]} hooks`,
    );
  }

  return { bestHookTypes: best, worstHookTypes: worst, insights };
}
