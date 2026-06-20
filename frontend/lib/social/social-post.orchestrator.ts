// AutoLenis Social Engine — Social Post Orchestrator.
//
// The central service that wires every component together: it selects a hook,
// generates the script via Groq, builds the tracked UTM URL, decides review vs
// auto-approval, persists the SocialPost + ContentDerivative, optionally queues
// video generation, and marks the source signal consumed. It also handles
// approval/rejection and the actual publish hand-off to the publishing provider.

import { logger } from "@/lib/logger";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import type {
  ContentFranchise,
  SocialPost,
  SocialPostStatus,
  TopicSignal,
} from "@prisma/client";
import {
  AUTOMATION_MODE,
  buildUtmUrl,
  getFunnelDestination,
  getPlatformConfig,
} from "@/lib/social/config";
import { requiresReview as franchiseRequiresReview } from "@/lib/social/franchise-router";
import { generateSocialScript } from "@/lib/social/groq-script.engine";
import { generateHookVariants } from "@/lib/social/hook-ab-testing.engine";
import { getPersonalityForFranchise } from "@/lib/social/personalities";
import { getViralFormat } from "@/lib/social/viral-formats";
import { getVideoLearnings } from "@/lib/social/video-learning.engine";
import { getOrFetchTrendingData } from "@/lib/social/trending-intelligence.engine";
import { getPublishingProvider } from "@/lib/social/providers/publishing.factory";
import { scorePostQuality } from "@/lib/social/content-quality.gate";

// Cross-platform publish stagger. The same content rolls out platform by
// platform (TikTok first, LinkedIn last) so one idea seeds discovery on the
// fastest-moving feed before reaching slower, longer-lived ones.
const PLATFORM_PUBLISH_DELAY_MS: Record<string, number> = {
  tiktok: 0,
  instagram: 2 * 60 * 60 * 1000, // +2 hours
  facebook: 4 * 60 * 60 * 1000, // +4 hours
  youtube: 8 * 60 * 60 * 1000, // +8 hours
  linkedin: 24 * 60 * 60 * 1000, // +24 hours
};

// Resolves the next optimal posting instant for a platform/day from the learned
// PostingWindow (slot hours in CT), rolling forward to tomorrow if the slot has
// already passed today. Falls back to sensible defaults when no window exists.
export async function getOptimalSlot(
  platform: string,
  dayOfWeek: number,
  slotIndex: number,
): Promise<Date> {
  const window = await prisma.postingWindow
    .findUnique({
      where: { platform_dayOfWeek: { platform, dayOfWeek } },
    })
    .catch(() => null);

  const hours = [
    window?.slot1Hour ?? 7,
    window?.slot2Hour ?? 12,
    window?.slot3Hour ?? 19,
  ];
  const hour = hours[slotIndex % 3];
  const slot = new Date();
  slot.setHours(hour, 0, 0, 0);
  if (slot <= new Date()) slot.setDate(slot.getDate() + 1);
  return slot;
}

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
  const { signal, franchise, platform } = input;
  const platformConfig = getPlatformConfig(platform);
  const { contentType, derivativeType } = assetFor(platform);

  // Cross-platform stagger: roll the same content out platform by platform so
  // it lands on the fastest feed first. The base slot comes from the caller.
  const publishDelay = PLATFORM_PUBLISH_DELAY_MS[platform] ?? 0;
  const scheduledAt = new Date(input.scheduledAt.getTime() + publishDelay);

  logger.info(
    "[orchestrator] routing signal:",
    signal.signalType,
    "franchise:",
    franchise.slug,
    "platform:",
    platform,
  );

  const hookType = await selectHookType(franchise, platform);

  // ─── Viral intelligence gathering (Session C) ─────────────────────────────
  // Resolve the personality, viral format, learned hook performance, and live
  // trending data for this franchise+platform. Each source is non-blocking: a
  // failure (or missing API key) yields null and generation proceeds without it.
  const [personality, viralFormat, videoLearnings, trendingData] =
    await Promise.all([
      Promise.resolve(getPersonalityForFranchise(franchise.slug, platform)),
      Promise.resolve(getViralFormat(platform, hookType)),
      getVideoLearnings(platform).catch(() => null),
      getOrFetchTrendingData().catch(() => null),
    ]);

  logger.info("[orchestrator] generating for platform:", platform, "hookType:", hookType);
  const scriptInput = {
    franchise,
    signal,
    platform,
    hookType,
    platformConfig,
    signalContext: (signal.signalContext as Record<string, unknown>) ?? {},
    personality,
    viralFormat,
    videoLearnings,
    trendingData,
  };
  const script = await generateSocialScript(scriptInput);
  logger.info("[orchestrator] groq result:", !!script);

  // ─── Content quality gate ────────────────────────────────────────────────
  // Score the generated content before persisting. Low scores trigger a single
  // regeneration pass steered by the failure reasons; we keep whichever version
  // scores higher. Priority/regeneration outcomes are logged for observability.
  const quality = scorePostQuality({
    hook: script.hook,
    script: script.script,
    caption: script.caption,
    ctaText: script.ctaText,
    platform,
    franchise: franchise.slug,
    complianceNotes: script.complianceNotes,
  });

  logger.info(
    `[orchestrator] quality: ${quality.total}/100`,
    quality.isPriority ? "🔥 PRIORITY" : "",
    quality.needsRegeneration ? "⚠️ REGENERATING" : "",
    quality.reasons.length > 0 ? `(${quality.reasons.join("; ")})` : "",
  );

  if (quality.needsRegeneration) {
    try {
      const retryOutput = await generateSocialScript({
        ...scriptInput,
        qualityFeedback:
          "Previous attempt scored too low. Focus on fixing: " +
          quality.reasons.join(", ") +
          ". Make the hook more specific and urgent.",
      });
      const retryQuality = scorePostQuality({
        hook: retryOutput.hook,
        script: retryOutput.script,
        caption: retryOutput.caption,
        ctaText: retryOutput.ctaText,
        platform,
        franchise: franchise.slug,
        complianceNotes: retryOutput.complianceNotes,
      });
      if (retryQuality.total > quality.total) {
        // Use the better version (mutates the shared script object in place).
        Object.assign(script, retryOutput);
        logger.info(`[orchestrator] retry improved: ${retryQuality.total}/100`);
      }
    } catch (retryErr) {
      logger.error("[orchestrator] retry failed, using original:", retryErr);
    }
  }

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

  const utmCampaign =
    `${signal.make ?? "general"}_${signal.city ?? signal.metro ?? "national"}_${month}`.toLowerCase();

  // ─── Hook A/B testing (FULL_AUTO only) ───────────────────────────────────
  // In full-auto mode we generate up to 3 hook variants for the same
  // signal+franchise and schedule them 5 minutes apart so the analytics cron
  // can later promote the best-performing hook. The shared script/visual fields
  // come from the base script above; each variant overrides the textual hook,
  // caption, hashtags, CTA, and its UTM hook + tracked URL. Falls through to
  // single-post generation if variant generation fails or yields ≤1 variant.
  if (AUTOMATION_MODE === "FULL_AUTO") {
    const variants = await generateHookVariants({
      franchise,
      signal,
      platform,
      platformConfig,
    }).catch((err) => {
      logger.warn(
        "[orchestrator] hook A/B generation failed, falling back to single post:",
        err instanceof Error ? err.message : err,
      );
      return null;
    });

    if (variants && variants.length > 1) {
      logger.info("[orchestrator] FULL_AUTO A/B: scheduling", variants.length, "hook variants");
      const posts: SocialPost[] = [];
      for (let i = 0; i < variants.length; i++) {
        const variant = variants[i];
        const variantScheduledAt = new Date(scheduledAt.getTime() + i * 5 * 60 * 1000);
        const variantTrackedUrl = buildUtmUrl({
          path: funnelDestination,
          platform,
          franchise: franchise.slug,
          hookType: variant.hookType,
          contentType,
          city: signal.city ?? signal.metro ?? undefined,
          make: signal.make ?? undefined,
          model: signal.model ?? undefined,
        });

        let variantPost: SocialPost;
        try {
          variantPost = await prisma.socialPost.create({
            data: {
              franchiseId: franchise.id,
              signalId: signal.id,
              sourceArticleId: signal.sourceTable === "content_articles" ? signal.sourceId : null,
              platform,
              contentType,
              hookType: variant.hookType,
              hook: variant.hook,
              script: script.script,
              caption: variant.caption,
              hashtags: variant.hashtags,
              ctaText: variant.ctaText,
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
              utmCampaign,
              utmContent: franchise.slug,
              utmTerm: contentType,
              utmHook: variant.hookType,
              utmPlatform: platform,
              trackedUrl: variantTrackedUrl,
              complianceNotes: script.complianceNotes,
              requiresReview: needsReview,
              automationMode: AUTOMATION_MODE,
              status,
              scheduledAt: variantScheduledAt,
            },
          });
        } catch (err) {
          logger.error(
            `[orchestrator] A/B variant create FAILED for ${franchise.slug}/${platform} (${variant.hookType}):`,
            err instanceof Error ? err.message : err,
          );
          continue;
        }

        // ContentDerivative link — best-effort, never discards a saved post.
        try {
          await prisma.contentDerivative.create({
            data: {
              signalId: signal.id,
              sourceArticleId: variantPost.sourceArticleId,
              postId: variantPost.id,
              platform,
              derivativeType,
            },
          });
        } catch (err) {
          logger.error(
            `[orchestrator] A/B contentDerivative.create failed for post ${variantPost.id} (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        }

        // Generate visuals (image now, video async) for each variant in the
        // background. Self-gates on ENABLE_HIGGSFIELD_VIDEO and never throws.
        scheduleVisualGeneration(variantPost);

        posts.push(variantPost);
      }

      if (posts.length > 0) {
        // Mark the source signal consumed once for the whole variant set.
        try {
          await prisma.topicSignal.update({
            where: { id: signal.id },
            data: { assetsGenerated: true, assetCount: { increment: posts.length } },
          });
        } catch (err) {
          logger.error(
            `[orchestrator] topicSignal.update failed for signal ${signal.id} (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        }
        logger.info("[orchestrator] FULL_AUTO A/B: created", posts.length, "variant posts");
        return posts[0];
      }
      logger.warn("[orchestrator] FULL_AUTO A/B: no variant posts persisted, falling back to single post");
    }
  }

  logger.info("[orchestrator] creating post in DB");
  let post: SocialPost;
  try {
    post = await prisma.socialPost.create({
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
      utmCampaign,
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
  } catch (err) {
    // Surface the real Prisma failure (missing model in the generated client,
    // table not migrated, constraint violation) instead of letting it bubble
    // up as an opaque error. Re-thrown so the caller marks this platform failed.
    logger.error(
      `[orchestrator] socialPost.create FAILED for ${franchise.slug}/${platform}:`,
      err instanceof Error ? err.message : err,
    );
    throw err;
  }
  logger.info("[orchestrator] post created:", post.id);

  // ContentDerivative is a bookkeeping link, not core to the post. A failure
  // here must never discard an already-persisted post.
  try {
    await prisma.contentDerivative.create({
      data: {
        signalId: signal.id,
        sourceArticleId: post.sourceArticleId,
        postId: post.id,
        platform,
        derivativeType,
      },
    });
  } catch (err) {
    logger.error(
      `[orchestrator] contentDerivative.create failed for post ${post.id} (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
  }

  // Generate visuals (image now, video async) in the background AFTER the post
  // is durably saved. Self-gating on ENABLE_HIGGSFIELD_VIDEO and fully
  // non-blocking: a missing Higgsfield key must never hide a created post.
  scheduleVisualGeneration(post);

  // Mark the source signal consumed. Best-effort: the post already exists.
  try {
    await prisma.topicSignal.update({
      where: { id: signal.id },
      data: { assetsGenerated: true, assetCount: { increment: 1 } },
    });
  } catch (err) {
    logger.error(
      `[orchestrator] topicSignal.update failed for signal ${signal.id} (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
  }

  return post;
}

// Generates the post's visual assets (image now, video async) in the background
// after the HTTP response is sent. Non-blocking and fully self-contained: a
// failure is logged and never propagates back into post creation/publishing.
function scheduleVisualGeneration(post: SocialPost): void {
  const run = async () => {
    try {
      const { generatePostVisuals } = await import(
        "@/lib/social/image-generation.service"
      );
      const visuals = await generatePostVisuals(post);
      if (visuals.imageUrl) {
        logger.info("[orchestrator] image generated for post:", post.id);
      }
    } catch (err) {
      logger.error("[orchestrator] image generation failed (non-fatal):", err);
    }
  };

  // Prefer Next's after() so work runs post-response inside a request scope.
  // Outside a request scope (e.g. CLI scripts) after() throws — fall back to a
  // detached promise so visual generation still proceeds.
  try {
    after(run);
  } catch {
    void run();
  }
}

// Publishes (or schedules) an approved post via the publishing provider. Uses
// the ready video URL when one exists, otherwise the generated image, so no post
// publishes without a visual when one is available. On failure, records the
// error and increments the attempt counter so a later cron can retry.
export async function publishApprovedPost(post: SocialPost): Promise<void> {
  const provider = getPublishingProvider(post.platform);

  // Atomically claim the post before doing any provider work. The publish-queue
  // cron runs every 5 minutes but a single run can take up to maxDuration (300s),
  // so a slow run may still be in flight when the next starts — both selecting
  // the same APPROVED/SCHEDULED row. updateMany with a status precondition is the
  // claim: exactly one caller flips the row to PUBLISHING (count === 1); any
  // other concurrent caller sees count === 0 and bails, preventing a
  // double-publish to the live platform.
  const claim = await prisma.socialPost.updateMany({
    where: { id: post.id, status: { in: ["APPROVED", "SCHEDULED"] } },
    data: { status: "PUBLISHING", publishingProvider: provider.name },
  });
  if (claim.count === 0) {
    logger.info(
      `[orchestrator] post ${post.id} already claimed or not publishable — skipping`,
    );
    return;
  }

  // Resolve the best available media for this post: a ready video wins, else the
  // generated still image (stored as the video thumbnail, or on the most recent
  // completed text-to-image generation record).
  const video = await prisma.socialVideo
    .findUnique({ where: { postId: post.id } })
    .catch(() => null);

  const imageGen = await prisma.aiMediaGeneration
    .findFirst({
      where: {
        socialPostId: post.id,
        status: "completed",
        generationType: "text_to_image",
      },
      orderBy: { completedAt: "desc" },
    })
    .catch(() => null);

  const videoUrl =
    video?.status === "VIDEO_READY" ? video.videoUrl ?? undefined : undefined;

  const imageFromGen =
    (imageGen?.outputImages as { url: string }[] | null)?.[0]?.url ?? undefined;
  const thumbnailUrl = video?.thumbnailUrl ?? imageFromGen;

  // mediaUrl is the single asset the publisher attaches; thumbnailUrl is sent
  // alongside a video so platforms can show a poster frame.
  const mediaUrl = videoUrl ?? thumbnailUrl;
  const isVideo = Boolean(videoUrl);

  // Status already flipped to PUBLISHING by the atomic claim above.

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
        thumbnailUrl,
        imageUrl: thumbnailUrl,
        trackedUrl: post.trackedUrl ?? undefined,
        scheduledAt,
        isVideo,
      })
    : await provider.publishNow({
        postId: post.id,
        platform: post.platform,
        caption: post.caption,
        hashtags: post.hashtags,
        mediaUrl,
        thumbnailUrl,
        imageUrl: thumbnailUrl,
        trackedUrl: post.trackedUrl ?? undefined,
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

// Moves a post from PENDING_REVIEW → APPROVED and generates its visuals (image
// now, video async) when they don't already exist. Returns the updated post.
export async function approvePost(postId: string): Promise<SocialPost> {
  const post = await prisma.socialPost.update({
    where: { id: postId },
    data: { status: "APPROVED", requiresReview: false, rejectionReason: null },
  });

  // Generate visuals if the post doesn't already have an image/video. The image
  // service self-gates on ENABLE_HIGGSFIELD_VIDEO and is idempotent.
  scheduleVisualGeneration(post);

  return post;
}

// Moves a post → REJECTED with a reason. Returns the updated post.
export async function rejectPost(postId: string, reason: string): Promise<SocialPost> {
  return prisma.socialPost.update({
    where: { id: postId },
    data: { status: "REJECTED", rejectionReason: reason },
  });
}
