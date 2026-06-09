// AutoLenis Social Engine — A/B Test Resolution Engine.
//
// Resolves hook A/B test groups after they have accumulated real engagement.
// Variants of the same signal+platform+franchise are scored on conversion-
// weighted engagement; the winner is recorded in HookPerformance so future
// generations can favor the winning hook type, and losing variants are skipped.

import { prisma } from "@/lib/prisma";

export interface AbTestResult {
  winnerPostId: string;
  loserPostIds: string[];
  winningHookType: string;
  winnerScore: number;
  platform: string;
  franchiseSlug: string;
}

export async function resolveAbTests(): Promise<AbTestResult[]> {
  const results: AbTestResult[] = [];

  // Find PUBLISHED posts from 2-8 hours ago that have a signalId
  // (A/B variants share the same signalId + platform + franchise)
  const recentPublished = await prisma.socialPost.findMany({
    where: {
      status: "PUBLISHED",
      publishedAt: {
        gte: new Date(Date.now() - 8 * 60 * 60 * 1000),
        lte: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
      signalId: { not: null },
    },
    include: {
      performance: {
        orderBy: { recordedAt: "desc" },
        take: 1,
      },
      franchise: true,
    },
  });

  if (recentPublished.length === 0) return results;

  // Group by signalId + platform + franchiseId
  const groups = new Map<string, typeof recentPublished>();
  for (const post of recentPublished) {
    const key = `${post.signalId}-${post.platform}-${post.franchiseId}`;
    const group = groups.get(key) ?? [];
    group.push(post);
    groups.set(key, group);
  }

  for (const [, group] of groups) {
    // Only process groups of 2-3 (A/B test groups)
    if (group.length < 2) continue;

    // Score each variant
    const scored = group.map((post) => {
      const perf = post.performance[0];
      const score = perf
        ? (perf.linkClicks ?? 0) * 3 +
          (perf.shares ?? 0) * 2 +
          (perf.views ?? 0) * 0.1 +
          (perf.vehicleRequests ?? 0) * 20
        : 0;
      return { post, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const winner = scored[0];
    const losers = scored.slice(1);

    if (!winner.post.hookType) continue;

    // Kill losers
    const loserIds = losers.map((l) => l.post.id);
    await prisma.socialPost.updateMany({
      where: { id: { in: loserIds } },
      data: { status: "SKIPPED" },
    });

    // Record winner in HookPerformance
    const platform = winner.post.platform;
    const hookType = winner.post.hookType;
    const perf = winner.post.performance[0];
    const ctr =
      perf && (perf.impressions ?? 0) > 0
        ? (perf.linkClicks ?? 0) / perf.impressions
        : 0;

    await prisma.hookPerformance.upsert({
      where: { platform_hookType: { platform, hookType } },
      update: {
        avgCtr: ctr,
        sampleSize: { increment: 1 },
        lastUpdated: new Date(),
      },
      create: {
        platform,
        hookType,
        avgCtr: ctr,
        sampleSize: 1,
      },
    });

    console.log(
      `[ab-resolver] winner: ${hookType} (score: ${winner.score.toFixed(1)})`,
      `killed: ${loserIds.length} variants`,
    );

    results.push({
      winnerPostId: winner.post.id,
      loserPostIds: loserIds,
      winningHookType: hookType,
      winnerScore: winner.score,
      platform,
      franchiseSlug: winner.post.franchise?.slug ?? "",
    });
  }

  return results;
}
