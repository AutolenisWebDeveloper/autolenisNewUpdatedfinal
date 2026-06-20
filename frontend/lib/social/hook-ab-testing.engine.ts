// AutoLenis Social Engine — Hook A/B Testing Engine.
//
// Generates 3 hook variants in parallel for the same franchise+signal so the
// best-performing variant can be selected and promoted. In FULL_AUTO mode the
// orchestrator calls generateHookVariants() and schedules all 3, staggered 5
// minutes apart. The admin A/B route resolves a group via scoreAndResolveGroup()
// once enough engagement data is available.

import { logger } from "@/lib/logger";
import type { ContentFranchise, TopicSignal } from "@prisma/client";
import type { PlatformConfig } from "@/lib/social/config";
import { generateSocialScript } from "@/lib/social/groq-script.engine";
import { prisma } from "@/lib/prisma";

export interface HookVariant {
  hookType: string;
  hook: string;
  caption: string;
  hashtags: string[];
  ctaText: string;
  score?: number;
}

const DEFAULT_HOOK_TYPES = ["fear", "curiosity", "savings"] as const;

export async function generateHookVariants(input: {
  franchise: ContentFranchise;
  signal: TopicSignal;
  platform: string;
  platformConfig: PlatformConfig;
}): Promise<HookVariant[]> {
  const { franchise, signal, platform, platformConfig } = input;

  // Pick 3 hook types: prefer franchise.hookTypes, pad with defaults.
  const franchiseHooks: string[] = Array.isArray(franchise.hookTypes) ? franchise.hookTypes : [];
  const pool = [...franchiseHooks, ...DEFAULT_HOOK_TYPES];
  const seen = new Set<string>();
  const hookTypes: string[] = [];
  for (const h of pool) {
    if (!seen.has(h)) { seen.add(h); hookTypes.push(h); }
    if (hookTypes.length === 3) break;
  }

  logger.info("[hook-ab] generating", hookTypes.length, "variants for", franchise.slug, platform);

  const results = await Promise.allSettled(
    hookTypes.map((hookType) =>
      generateSocialScript({ franchise, signal, platform, hookType, platformConfig }),
    ),
  );

  const variants: HookVariant[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      variants.push({
        hookType: r.value.hookType,
        hook: r.value.hook,
        caption: r.value.caption,
        hashtags: r.value.hashtags,
        ctaText: r.value.ctaText,
      });
    } else {
      logger.warn("[hook-ab] variant", hookTypes[i], "failed:", r.reason instanceof Error ? r.reason.message : r.reason);
    }
  }

  logger.info("[hook-ab] variants generated:", variants.length);
  return variants;
}

// Scores every variant in a RUNNING group by conversion-weighted engagement,
// marks the highest-scoring variant the winner, completes the group, skips the
// losing variant posts, and records the winning hook type in HookPerformance.
// Returns { resolved: false } when the group is missing, already resolved, or
// has not yet accumulated any engagement data.
export async function scoreAndResolveGroup(
  groupId: string,
): Promise<{
  winnerId?: string;
  winnerHookType?: string;
  resolved: boolean;
}> {
  const group = await prisma.aBTestGroup.findUnique({
    where: { id: groupId },
    include: { posts: true },
  });

  if (!group || group.status !== "RUNNING") {
    return { resolved: false };
  }

  // Score each variant's post on its most recent performance snapshot.
  const scored: {
    variantId: string;
    postId: string;
    score: number;
    hookType: string;
    ctr: number;
    leadScore: number;
    vehicleRequests: number;
  }[] = [];

  for (const variant of group.posts) {
    const perf = await prisma.socialPerformance
      .findFirst({
        where: { postId: variant.postId },
        orderBy: { recordedAt: "desc" },
      })
      .catch(() => null);

    const score = perf
      ? (perf.linkClicks ?? 0) * 3 +
        (perf.shares ?? 0) * 2 +
        (perf.views ?? 0) * 0.1 +
        (perf.vehicleRequests ?? 0) * 20
      : 0;

    const reach = perf?.reach ?? perf?.impressions ?? 0;
    const ctr = reach > 0 ? (perf?.linkClicks ?? 0) / reach : 0;

    scored.push({
      variantId: variant.id,
      postId: variant.postId,
      score,
      hookType: variant.hookType,
      ctr,
      leadScore: perf?.leadScore ?? 0,
      vehicleRequests: perf?.vehicleRequests ?? 0,
    });
  }

  // Need minimum data before resolving.
  const hasData = scored.some((s) => s.score > 0);
  if (!hasData) return { resolved: false };

  // Sort by score, pick winner.
  scored.sort((a, b) => b.score - a.score);
  const winner = scored[0];
  const losers = scored.slice(1);

  // Update variants with scores and winner flag.
  for (const s of scored) {
    await prisma.aBTestVariant.update({
      where: { id: s.variantId },
      data: {
        score: s.score,
        isWinner: s.variantId === winner.variantId,
      },
    });
  }

  // Mark group as completed.
  await prisma.aBTestGroup.update({
    where: { id: groupId },
    data: {
      status: "COMPLETED",
      winnerId: winner.variantId,
      completedAt: new Date(),
    },
  });

  // Kill losing variant posts.
  if (losers.length > 0) {
    await prisma.socialPost.updateMany({
      where: { id: { in: losers.map((l) => l.postId) } },
      data: { status: "SKIPPED" },
    });
  }

  // Record the winning hook type in HookPerformance with its real CTR / lead
  // score so future generations can favor it. selectHookType (orchestrator)
  // ranks HookPerformance by avgLeadScore/avgCtr, so persisting only a sample
  // count would leave the winner unranked — populate the metrics too.
  await prisma.hookPerformance.upsert({
    where: {
      platform_hookType: {
        platform: group.platform,
        hookType: winner.hookType,
      },
    },
    update: {
      avgCtr: winner.ctr,
      avgLeadScore: winner.leadScore,
      avgVehicleRequests: winner.vehicleRequests,
      sampleSize: { increment: 1 },
      lastUpdated: new Date(),
    },
    create: {
      platform: group.platform,
      hookType: winner.hookType,
      avgCtr: winner.ctr,
      avgLeadScore: winner.leadScore,
      avgVehicleRequests: winner.vehicleRequests,
      sampleSize: 1,
    },
  });

  logger.info(
    `[ab-test] resolved group ${groupId}:`,
    `winner=${winner.hookType} (score=${winner.score.toFixed(1)})`,
  );

  return {
    winnerId: winner.variantId,
    winnerHookType: winner.hookType,
    resolved: true,
  };
}
