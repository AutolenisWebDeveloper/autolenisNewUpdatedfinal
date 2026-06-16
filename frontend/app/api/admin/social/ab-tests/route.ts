// /api/admin/social/ab-tests
//   GET  — list recent A/B test groups with their variants, scores, and winner.
//   POST — create a manual A/B test: generate 3 hook variants for a
//          franchise+platform, materialize a staggered SocialPost per variant,
//          and persist the ABTestGroup + ABTestVariant records.

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

// Per-platform content type used when materializing variant posts.
const CONTENT_TYPE: Record<string, string> = {
  tiktok: "tiktok_video",
  instagram: "instagram_reel",
  facebook: "facebook_reel",
  youtube: "youtube_short",
  linkedin: "linkedin_post",
};

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const groups = await prisma.aBTestGroup.findMany({
    include: { posts: { orderBy: { variantLabel: "asc" } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  // Resolve the SocialPost behind each variant so the dashboard can show the
  // live hook text even after the variant row was first created.
  const postIds = groups.flatMap((g) => g.posts.map((v) => v.postId));
  const posts =
    postIds.length > 0
      ? await prisma.socialPost.findMany({
          where: { id: { in: postIds } },
          select: { id: true, hook: true, status: true },
        })
      : [];
  const postMap = new Map(posts.map((p) => [p.id, p]));

  const shaped = groups.map((g) => ({
    id: g.id,
    name: g.name,
    platform: g.platform,
    franchiseSlug: g.franchiseSlug,
    status: g.status,
    createdAt: g.createdAt,
    completedAt: g.completedAt,
    variants: g.posts.map((v) => ({
      id: v.id,
      label: v.variantLabel,
      hookType: v.hookType,
      hook: postMap.get(v.postId)?.hook ?? v.hook,
      score: v.score,
      isWinner: v.isWinner,
      postId: v.postId,
      postStatus: postMap.get(v.postId)?.status ?? null,
    })),
  }));

  return adminSuccess({ groups: shaped });
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { platform, franchiseSlug, topic } = await request
    .json()
    .catch(() => ({}));

  if (!platform || !franchiseSlug) {
    return adminError("BAD_REQUEST", "platform and franchiseSlug are required", 400);
  }

  const franchise = await prisma.contentFranchise.findUnique({
    where: { slug: franchiseSlug },
  });
  if (!franchise) {
    return adminError("NOT_FOUND", `Franchise "${franchiseSlug}" not found`, 404);
  }

  const { getPlatformConfig, buildUtmUrl, getFunnelDestination } = await import(
    "@/lib/social/config"
  );
  const { generateHookVariants } = await import(
    "@/lib/social/hook-ab-testing.engine"
  );

  // A manual A/B test still needs a signal for the generation pipeline. Create
  // a lightweight one carrying the optional topic as context.
  const signal = await prisma.topicSignal.create({
    data: {
      signalType: "manual_ab_test",
      signalContext: topic ? { topic } : {},
      assetsGenerated: false,
    },
  });

  const platformConfig = getPlatformConfig(platform);

  const variants = await generateHookVariants({
    franchise,
    signal,
    platform,
    platformConfig,
  }).catch((err) => {
    logger.error(
      "[ab-tests] hook variant generation failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  });

  if (!variants || variants.length < 2) {
    return adminError(
      "GENERATION_FAILED",
      "Could not generate at least 2 hook variants",
      502,
    );
  }

  const contentType = CONTENT_TYPE[platform] ?? "social_post";
  const funnelDestination = getFunnelDestination(franchise.slug);

  const group = await prisma.aBTestGroup.create({
    data: {
      name: `${franchise.slug} ${platform} ${new Date().toISOString().split("T")[0]}`,
      platform,
      franchiseSlug: franchise.slug,
      status: "RUNNING",
    },
  });

  const labels = ["A", "B", "C"];
  const now = new Date();
  const postIds: string[] = [];

  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i];
    const scheduledAt = new Date(now.getTime() + i * 5 * 60 * 1000); // 5-min stagger
    const trackedUrl = buildUtmUrl({
      path: funnelDestination,
      platform,
      franchise: franchise.slug,
      hookType: variant.hookType,
      contentType,
    });

    const post = await prisma.socialPost.create({
      data: {
        franchiseId: franchise.id,
        signalId: signal.id,
        platform,
        contentType,
        hookType: variant.hookType,
        hook: variant.hook,
        script: variant.caption,
        caption: variant.caption,
        hashtags: variant.hashtags,
        ctaText: variant.ctaText,
        funnelDestination,
        status: "APPROVED",
        automationMode: "AB_TEST",
        requiresReview: false,
        scheduledAt,
        utmSource: platform,
        utmMedium: "social_ab",
        utmCampaign: `${franchise.slug}_ab`,
        utmHook: variant.hookType,
        utmPlatform: platform,
        trackedUrl,
      },
    });

    await prisma.aBTestVariant.create({
      data: {
        groupId: group.id,
        postId: post.id,
        hookType: variant.hookType,
        hook: variant.hook,
        variantLabel: labels[i] ?? String(i + 1),
      },
    });

    postIds.push(post.id);
  }

  return adminSuccess({
    group: {
      id: group.id,
      name: group.name,
      platform: group.platform,
      franchiseSlug: group.franchiseSlug,
      status: group.status,
    },
    postIds,
    message: `A/B test created with ${postIds.length} variants`,
  });
}
