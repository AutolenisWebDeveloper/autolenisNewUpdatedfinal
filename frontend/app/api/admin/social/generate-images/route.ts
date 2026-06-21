// POST /api/admin/social/generate-images
// One-shot admin endpoint to batch-generate DALL-E 3 images for APPROVED posts
// that still have no SocialVideo record (no media). Each post gets a branded
// still image attached and its SocialVideo marked VIDEO_READY so the publishing
// queue can pick it up. Processes a bounded batch per call to stay within the
// serverless time budget; call repeatedly to drain a larger backlog.
//
// Hardened batch processing: a single post's failure NEVER stops the loop, and a
// failed post gets a VIDEO_FAILED SocialVideo record so it is not re-attempted on
// the next batch call (prevents an infinite retry loop on a permanently-broken
// post). Every failure logs its actual error message for diagnosis.

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { generateDalleImage } from "@/lib/social/providers/dalle.provider";
import { storeImageInSupabase, storeImageB64InSupabase } from "@/lib/social/image-generation.service";

export const maxDuration = 60;

// DALL-E 3 standard tier allows ~5 images/min. With a batch of 5 and ~2s per API
// call we stay well under the cap, so no inter-request delay is needed.
const BATCH_SIZE = 5;
const DALLE_PROVIDER = "dalle3";
const STORAGE_BUCKET = "social-media-assets";

export async function POST(request: NextRequest) {
  // Allow internal calls from the social-generate cron using the shared
  // CRON_SECRET; otherwise fall through to the existing admin-session check.
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const isCronCall = Boolean(
    cronSecret && authHeader === `${CRON_AUTH_PREFIX}${cronSecret}`,
  );

  if (!isCronCall) {
    const admin = await getAdminFromRequest(request);
    if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  }

  // Check OPENAI_API_KEY first — bail out cleanly with a clear, machine-readable
  // signal rather than failing every post in the batch.
  if (!process.env.OPENAI_API_KEY) {
    return adminSuccess({
      processed: 0,
      generated: 0,
      failed: 0,
      error: "OPENAI_API_KEY not configured in Vercel environment variables",
      apiKeyConfigured: false,
    });
  }

  // Find approved posts with no SocialVideo record (relation name is `video`).
  const postsNeedingImages = await prisma.socialPost.findMany({
    where: { status: "APPROVED", video: { is: null } },
    orderBy: { createdAt: "asc" },
    include: { franchise: true },
    take: BATCH_SIZE,
  });

  logger.info(
    `[generate-images] found ${postsNeedingImages.length} posts`,
    `OPENAI_API_KEY: ${!!process.env.OPENAI_API_KEY}`,
  );

  if (postsNeedingImages.length === 0) {
    const remaining = await prisma.socialPost.count({
      where: { status: "APPROVED", video: { is: null } },
    });
    return adminSuccess({
      processed: 0,
      generated: 0,
      failed: 0,
      remaining,
      apiKeyConfigured: true,
      message:
        remaining > 0
          ? `No posts found with video: null filter. ${remaining} approved posts exist.`
          : "All posts have been processed.",
    });
  }

  let generated = 0;
  let failed = 0;

  for (const post of postsNeedingImages) {
    const visualPrompt = post.visualPrompt ?? post.hook ?? "";
    try {
      logger.info(
        "[generate-images] generating for post:",
        post.id,
        post.platform,
        post.franchise?.slug,
      );

      const result = await generateDalleImage({
        visualPrompt,
        franchise: post.franchise?.slug ?? "",
        platform: post.platform,
        make: post.make,
        metro: post.metro,
        hookType: post.hookType,
      });

      logger.info(
        "[generate-images] dalle result:",
        post.id,
        "success:",
        result.success,
        "error:",
        result.error,
      );

      if (!result.success || (!result.imageUrl && !result.imageB64)) {
        throw new Error(result.error ?? "Unknown image generation error");
      }

      // gpt-image-1 returns base64; dall-e-* return a temporary URL (~1h). Either
      // way, persist to Supabase for a stable URL. For URL results, fall back to
      // the provider URL if storage fails so the post still has an image.
      let storedImageUrl = result.imageUrl ?? "";
      let storagePath: string | null = null;
      try {
        if (result.imageB64) {
          storedImageUrl = await storeImageB64InSupabase(result.imageB64, post.id);
          storagePath = `social-posts/${post.id}/image.png`;
        } else {
          storedImageUrl = await storeImageInSupabase(result.imageUrl!, post.id);
          storagePath = `social-posts/${post.id}/image.jpg`;
        }
      } catch (storeErr) {
        logger.error(
          "[generate-images] supabase store failed:",
          post.id,
          storeErr,
        );
        if (!result.imageUrl) {
          // base64 with no hosting fallback — skip rather than store an unusable image.
          throw new Error("image storage failed for base64 image");
        }
      }

      await prisma.socialVideo.create({
        data: {
          postId: post.id,
          provider: DALLE_PROVIDER,
          status: "VIDEO_READY",
          thumbnailUrl: storedImageUrl,
          videoUrl: null,
          visualPrompt,
          durationSeconds: post.durationSeconds ?? 15,
          storageBucket: storagePath ? STORAGE_BUCKET : null,
          storagePath,
          generatedAt: new Date(),
        },
      });
      generated += 1;
      logger.info("[generate-images] ✅ created:", post.id);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(
        "[generate-images] ❌ post failed:",
        post.id,
        "error:",
        errorMessage,
      );

      // Record the failure so this post is not retried on the next batch call.
      // Non-fatal: never let a bookkeeping write stop the loop.
      await prisma.socialVideo
        .create({
          data: {
            postId: post.id,
            provider: DALLE_PROVIDER,
            status: "VIDEO_FAILED",
            errorMessage: errorMessage.slice(0, 500),
            visualPrompt,
            generatedAt: new Date(),
          },
        })
        .catch((dbErr) =>
          logger.error("[generate-images] db write failed:", post.id, dbErr),
        );
      failed += 1;
      // ALWAYS continue to the next post.
      continue;
    }
  }

  const remaining = await prisma.socialPost
    .count({ where: { status: "APPROVED", video: { is: null } } })
    .catch(() => -1);

  logger.info(
    `[generate-images] done: ${generated} generated,`,
    `${failed} failed, ${remaining} remaining`,
  );

  // Kick off Runway video generation for the freshly-imaged Tier 1 posts.
  // Fire-and-forget — a slow or failed video pass must never affect this
  // response, and the video cron enforces its own daily cap + Tier 1 filter.
  if (generated > 0 && process.env.RUNWAY_API_KEY) {
    fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/cron/social-video-generate`, {
      headers: {
        [CRON_AUTH_HEADER]: `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`,
      },
    }).catch((err) =>
      logger.error("[generate-images] video trigger failed:", err),
    );
  }

  return adminSuccess({
    processed: postsNeedingImages.length,
    generated,
    failed,
    remaining,
    apiKeyConfigured: true,
    message: `Generated ${generated} images. ${failed} failed. ${remaining} remaining.`,
  });
}
