// AutoLenis Social Engine — Social Post Orchestrator.
//
// The central service that wires every component together: it selects a hook,
// generates the script via Groq, builds the tracked UTM URL, decides review vs
// auto-approval, persists the SocialPost + ContentDerivative, optionally queues
// video generation, and marks the source signal consumed. It also handles
// approval/rejection and the actual publish hand-off to the publishing provider.

import { prisma } from "@/lib/prisma";
import type {
  ContentFranchise,
  SocialPost,
  SocialPostStatus,
  TopicSignal,
} from "@prisma/client";
import {
  AUTOMATION_MODE,
  ENABLE_VIDEO,
  buildUtmUrl,
  getFunnelDestination,
  getPlatformConfig,
} from "@/lib/social/config";
import { requiresReview as franchiseRequiresReview } from "@/lib/social/franchise-router";
import { generateSocialScript } from "@/lib/social/groq-script.engine";
import { getVideoProvider } from "@/lib/social/providers/video-generation.factory";
import { getPublishingProvider } from "@/lib/social/providers/publishing.factory";

// Per-platform content + derivative type used when materializing a post.
const PLATFORM_ASSET: Record<string, { contentType: string; derivativeType: string }> = {
  tiktok: { contentType: "tiktok_video", derivativeType: "tiktok_video" },
  instagram: { contentType: "instagram_reel", derivativeType: "instagram_reel" },
  facebook: { contentType: "facebook_reel", derivativeType: "facebook_reel" },
  youtube: { contentType: "youtube_short", derivativeType: "youtube_short" },
  linkedin: { contentType: "linkedin_post", derivativeType: "linkedin_post" },
};

function assetFor(platform: string) {
  return PLATFORM_ASSET[platform.toLowerCase()] ?? { contentType: "social_post", derivativeType: "social_post" };
}

// Picks the best-performing hook type for this platform+franchise from learned
// winning patterns, falling back to the franchise's preferred hook list.
async function selectHookType(
  franchise: ContentFranchise,
  platform: string,
): Promise<string> {
  const pattern = await prisma.winningPattern.findFirst({
    where: { platform, franchiseSlug: franchise.slug, hookType: { not: null } },
    orderBy: [{ avgLeadScore: "desc" }, { sampleSize: "desc" }],
    select: { hookType: true },
  });
  return pattern?.hookType ?? franchise.hookTypes[0] ?? "curiosity";
}

// Resolves the SocialPost status given mode + review requirement.
function resolveStatus(needsReview: boolean): SocialPostStatus {
  if (AUTOMATION_MODE === "MANUAL_REVIEW") return "PENDING_REVIEW";
  if (needsReview) return "PENDING_REVIEW";
  return "APPROVED";
}

export interface GenerateAndQueueInput {
  signal: TopicSignal;
  franchise: ContentFranchise;
  platform: string;
  scheduledAt: Date;
}

// Generates one platform asset for a (signal, franchise) pair and persists it
// as a SocialPost, with a ContentDerivative link and (when enabled and not held
// for review) a queued video-generation job.
export async function generateAndQueuePost(
  input: GenerateAndQueueInput,
): Promise<SocialPost> {
  const { signal, franchise, platform, scheduledAt } = input;
  const platformConfig = getPlatformConfig(platform);
  const { contentType, derivativeType } = assetFor(platform);

  const hookType = await selectHookType(franchise, platform);

  const script = await generateSocialScript({
    franchise,
    signal,
    platform,
    hookType,
    platformConfig,
    signalContext: (signal.signalContext as Record<string, unknown>) ?? {},
  });

  const funnelDestination = script.funnelDestination || getFunnelDestination(franchise.slug);
  const trackedUrl = buildUtmUrl({
    path: funnelDestination,
    platform,
    franchise: franchise.slug,
    hookType: script.hookType,
    contentType,
    city: signal.city ?? signal.metro ?? undefined,
    make: signal.make ?? undefined,
    model: signal.model ?? undefined,
  });

  const needsReview = franchiseRequiresReview(franchise);
  const status = resolveStatus(needsReview);

  const month = new Date()
    .toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "America/Chicago" })
    .toLowerCase()
    .replace(/\s+/g, "-");

  const post = await prisma.socialPost.create({
    data: {
      franchiseId: franchise.id,
      signalId: signal.id,
      sourceArticleId: signal.sourceTable === "content_articles" ? signal.sourceId : null,
      platform,
      contentType,
      hookType: script.hookType,
      hook: script.hook,
      script: script.script,
      caption: script.caption,
      hashtags: script.hashtags,
      ctaText: script.ctaText,
      ctaPlacement: script.ctaPlacement,
      visualPrompt: script.visualPrompt,
      visualStyle: script.visualStyle,
      voiceoverText: script.voiceoverText,
      onScreenText: script.onScreenText,
      durationSeconds: script.durationSeconds,
      geoTarget: signal.city ?? signal.metro ?? null,
      make: signal.make,
      model: signal.model,
      metro: signal.metro,
      state: signal.state,
      funnelDestination,
      utmSource: platform,
      utmMedium: "social",
      utmCampaign: `${signal.make ?? "general"}_${signal.city ?? signal.metro ?? "national"}_${month}`.toLowerCase(),
      utmContent: franchise.slug,
      utmTerm: contentType,
      utmHook: script.hookType,
      utmPlatform: platform,
      trackedUrl,
      complianceNotes: script.complianceNotes,
      requiresReview: needsReview,
      automationMode: AUTOMATION_MODE,
      status,
      scheduledAt,
    },
  });

  await prisma.contentDerivative.create({
    data: {
      signalId: signal.id,
      sourceArticleId: post.sourceArticleId,
      postId: post.id,
      platform,
      derivativeType,
    },
  });

  // Queue video generation when enabled and the post is not held for review.
  if (ENABLE_VIDEO && status !== "PENDING_REVIEW") {
    await queueVideoGeneration(post.id, {
      visualPrompt: script.visualPrompt,
      durationSeconds: script.durationSeconds,
      style: script.visualStyle,
      voiceoverText: script.voiceoverText,
      onScreenText: script.onScreenText,
    });
  }

  await prisma.topicSignal.update({
    where: { id: signal.id },
    data: { assetsGenerated: true, assetCount: { increment: 1 } },
  });

  return post;
}

// Creates a SocialVideo job for a post (idempotent on postId) and submits it to
// the video provider. The provider transitions QUEUED → GENERATING or FAILED.
async function queueVideoGeneration(
  postId: string,
  input: {
    visualPrompt: string;
    durationSeconds: number;
    style?: string;
    voiceoverText?: string;
    onScreenText?: string;
  },
): Promise<void> {
  await prisma.socialVideo.upsert({
    where: { postId },
    create: {
      postId,
      status: "VIDEO_QUEUED",
      visualPrompt: input.visualPrompt,
      durationSeconds: input.durationSeconds,
      style: input.style,
    },
    update: {
      status: "VIDEO_QUEUED",
      visualPrompt: input.visualPrompt,
      durationSeconds: input.durationSeconds,
      style: input.style,
    },
  });

  const provider = getVideoProvider();
  await provider.submitJob({
    postId,
    visualPrompt: input.visualPrompt,
    durationSeconds: input.durationSeconds,
    style: input.style,
    voiceoverText: input.voiceoverText,
    onScreenText: input.onScreenText,
  });
}

// Publishes (or schedules) an approved post via the publishing provider. Uses
// the ready video URL when one exists. On failure, records the error and
// increments the attempt counter so a later cron can retry.
export async function publishApprovedPost(post: SocialPost): Promise<void> {
  const provider = getPublishingProvider();

  const video = await prisma.socialVideo.findUnique({ where: { postId: post.id } });
  const mediaUrl = video?.status === "VIDEO_READY" ? video.videoUrl ?? undefined : undefined;
  const isVideo = Boolean(mediaUrl);

  await prisma.socialPost.update({
    where: { id: post.id },
    data: { status: "PUBLISHING", publishingProvider: provider.name },
  });

  const now = Date.now();
  const scheduledAt = post.scheduledAt ?? new Date();
  const shouldScheduleAhead = scheduledAt.getTime() > now + 60_000;

  const result = shouldScheduleAhead
    ? await provider.schedulePost({
        postId: post.id,
        platform: post.platform,
        caption: post.caption,
        hashtags: post.hashtags,
        mediaUrl,
        scheduledAt,
        isVideo,
      })
    : await provider.publishNow({
        postId: post.id,
        platform: post.platform,
        caption: post.caption,
        hashtags: post.hashtags,
        mediaUrl,
        isVideo,
      });

  if (result.success) {
    await prisma.socialPost.update({
      where: { id: post.id },
      data: {
        status: shouldScheduleAhead ? "SCHEDULED" : "PUBLISHED",
        platformPostId: result.platformPostId,
        publishedAt: shouldScheduleAhead ? null : new Date(),
        publishError: null,
      },
    });
  } else {
    await prisma.socialPost.update({
      where: { id: post.id },
      data: {
        status: "FAILED",
        publishError: result.error ?? "unknown publish error",
        publishAttempts: { increment: 1 },
      },
    });
  }
}

// Moves a post from PENDING_REVIEW → APPROVED and queues video generation when
// enabled. Returns the updated post.
export async function approvePost(postId: string): Promise<SocialPost> {
  const post = await prisma.socialPost.update({
    where: { id: postId },
    data: { status: "APPROVED", requiresReview: false, rejectionReason: null },
  });

  if (ENABLE_VIDEO) {
    await queueVideoGeneration(post.id, {
      visualPrompt: post.visualPrompt ?? "",
      durationSeconds: post.durationSeconds ?? 30,
      style: post.visualStyle ?? undefined,
      voiceoverText: post.voiceoverText ?? undefined,
      onScreenText: post.onScreenText ?? undefined,
    });
  }

  return post;
}

// Moves a post → REJECTED with a reason. Returns the updated post.
export async function rejectPost(postId: string, reason: string): Promise<SocialPost> {
  return prisma.socialPost.update({
    where: { id: postId },
    data: { status: "REJECTED", rejectionReason: reason },
  });
}
