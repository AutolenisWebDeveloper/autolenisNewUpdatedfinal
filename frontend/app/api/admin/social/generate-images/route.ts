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

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { generateDalleImage } from "@/lib/social/providers/dalle.provider";
import { storeImageInSupabase } from "@/lib/social/image-generation.service";

export const maxDuration = 60;

// DALL-E 3 standard tier allows ~5 images/min. With a batch of 5 and ~2s per API
// call we stay well under the cap, so no inter-request delay is needed.
const BATCH_SIZE = 5;
const DALLE_PROVIDER = "dalle3";
const STORAGE_BUCKET = "social-media-assets";

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

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

  console.log(
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
      console.log(
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

      console.log(
        "[generate-images] dalle result:",
        post.id,
        "success:",
        result.success,
        "error:",
        result.error,
      );

      if (!result.success || !result.imageUrl) {
        throw new Error(result.error ?? "Unknown DALL-E error");
      }

      // DALL-E URLs expire (~1h) — store the image in Supabase for a stable URL.
      // Fall back to the provider URL if storage fails so the post still has an
      // image rather than failing outright.
      let storedImageUrl = result.imageUrl;
      let storagePath: string | null = null;
      try {
        storedImageUrl = await storeImageInSupabase(result.imageUrl, post.id);
        storagePath = `social-posts/${post.id}/image.jpg`;
      } catch (storeErr) {
        console.error(
          "[generate-images] supabase store failed, using provider URL:",
          post.id,
          storeErr,
        );
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
      console.log("[generate-images] ✅ created:", post.id);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(
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
          console.error("[generate-images] db write failed:", post.id, dbErr),
        );
      failed += 1;
      // ALWAYS continue to the next post.
      continue;
    }
  }

  const remaining = await prisma.socialPost
    .count({ where: { status: "APPROVED", video: { is: null } } })
    .catch(() => -1);

  console.log(
    `[generate-images] done: ${generated} generated,`,
    `${failed} failed, ${remaining} remaining`,
  );

  return adminSuccess({
    processed: postsNeedingImages.length,
    generated,
    failed,
    remaining,
    apiKeyConfigured: true,
    message: `Generated ${generated} images. ${failed} failed. ${remaining} remaining.`,
  });
}
