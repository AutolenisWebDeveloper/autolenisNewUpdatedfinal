// Social Engine — Cron: Runway Gen-4 Turbo Video Generation.
// Finds Tier 1 posts (TikTok / Instagram / YouTube) that already have a
// Higgsfield still (SocialVideo VIDEO_READY with a thumbnailUrl but no videoUrl) and
// animates the still into a 5-second video via Runway Gen-4 Turbo. The resolved
// video is stored in Supabase for a stable URL and written back onto the
// SocialVideo (status stays VIDEO_READY, now carrying videoUrl), which the
// publishing queue then sends to Buffer as a video asset.
//
// Each Runway task is polled synchronously (up to 5 minutes), so a single video
// is generated per invocation to stay within maxDuration; the daily cap of 3 is
// enforced so a frequent schedule cannot over-spend. Facebook + LinkedIn use
// static images only and are never selected here.

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { getServiceSupabase } from "@/lib/supabase-service";

export const maxDuration = 300;

const TIER1_PLATFORMS = ["tiktok", "instagram", "youtube"];
const DAILY_VIDEO_LIMIT = 3; // videos per day per plan
// One Runway poll can run the full 5 minutes, so generate a single video per
// invocation to stay within maxDuration; a frequent schedule covers the daily
// cap across runs.
const MAX_PER_RUN = 1;
const STORAGE_BUCKET = "social-media-assets";

// Downloads a finished Runway video and uploads it to Supabase storage so the
// publisher has a stable URL (Runway output URLs are ephemeral). Throws on
// failure so the caller can fall back to the provider URL.
async function storeVideoInSupabase(videoUrl: string, postId: string): Promise<string> {
  const res = await fetch(videoUrl);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "video/mp4";
  const buffer = Buffer.from(await res.arrayBuffer());

  const supabase = getServiceSupabase();
  const path = `social-posts/${postId}/video.mp4`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, buffer, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`supabase upload failed: ${error.message}`);

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error("supabase getPublicUrl returned no url");
  return data.publicUrl;
}

export async function GET(request: NextRequest) {
  // Auth — Vercel cron header or the shared CRON_SECRET bearer (same pattern as
  // the other social crons).
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  if (!process.env.RUNWAY_API_KEY) {
    return NextResponse.json({
      success: true,
      message: "RUNWAY_API_KEY not configured",
      generated: 0,
    });
  }

  // How many videos have already been generated today?
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const todayVideoCount = await prisma.socialVideo.count({
    where: {
      videoUrl: { not: null },
      updatedAt: { gte: today, lt: tomorrow },
    },
  });

  if (todayVideoCount >= DAILY_VIDEO_LIMIT) {
    logger.info(
      `[video-generate] daily limit reached: ${todayVideoCount}/${DAILY_VIDEO_LIMIT}`,
    );
    return NextResponse.json({
      success: true,
      message: "Daily video limit reached",
      generated: 0,
    });
  }

  const remaining = Math.min(DAILY_VIDEO_LIMIT - todayVideoCount, MAX_PER_RUN);

  // Posts that have a Higgsfield image but no video yet — Tier 1 platforms only,
  // image ready (VIDEO_READY) and parent post still APPROVED.
  const postsNeedingVideo = await prisma.socialVideo.findMany({
    where: {
      thumbnailUrl: { not: null }, // has Higgsfield image
      videoUrl: null, // no video yet
      status: "VIDEO_READY", // image is ready
      post: {
        platform: { in: TIER1_PLATFORMS },
        status: "APPROVED",
      },
    },
    include: {
      post: {
        include: { franchise: true },
      },
    },
    take: remaining,
    orderBy: { createdAt: "asc" },
  });

  if (postsNeedingVideo.length === 0) {
    logger.info("[video-generate] no posts need video generation");
    return NextResponse.json({
      success: true,
      message: "No posts need video",
      generated: 0,
    });
  }

  logger.info(
    `[video-generate] generating ${postsNeedingVideo.length} videos`,
    `(${todayVideoCount} already done today, limit: ${DAILY_VIDEO_LIMIT})`,
  );

  let generated = 0;
  let failed = 0;

  for (const socialVideo of postsNeedingVideo) {
    const post = socialVideo.post;
    if (!post || !socialVideo.thumbnailUrl) continue;

    try {
      logger.info(
        "[video-generate] starting:",
        post.id,
        post.platform,
        post.franchise?.slug,
      );

      // Mark in-flight so a concurrent run won't pick this row up.
      await prisma.socialVideo.update({
        where: { id: socialVideo.id },
        data: {
          status: "VIDEO_GENERATING",
          lastPolledAt: new Date(),
        },
      });

      const { generateRunwayVideo } = await import(
        "@/lib/social/providers/runway.provider"
      );

      const result = await generateRunwayVideo({
        imageUrl: socialVideo.thumbnailUrl,
        platform: post.platform,
        franchise: post.franchise?.slug ?? "",
        hook: post.hook,
      });

      if (result.success && result.videoUrl) {
        // Store the video in Supabase for a stable URL. Runway URLs expire — if
        // storage fails, fall back to the provider URL and warn.
        let storedVideoUrl = result.videoUrl;
        try {
          storedVideoUrl = await storeVideoInSupabase(result.videoUrl, post.id);
        } catch (storeErr) {
          logger.warn(
            "[video-generate] supabase video store failed, using Runway URL (may expire):",
            post.id,
            storeErr,
          );
        }

        await prisma.socialVideo.update({
          where: { id: socialVideo.id },
          data: {
            videoUrl: storedVideoUrl,
            providerJobId: result.taskId,
            status: "VIDEO_READY", // stays VIDEO_READY, now has a video
            generatedAt: new Date(),
            pollAttempts: 0,
            errorMessage: null,
          },
        });

        logger.info(
          "[video-generate] ✅ video generated:",
          post.id,
          "platform:",
          post.platform,
        );
        generated++;
      } else {
        await prisma.socialVideo.update({
          where: { id: socialVideo.id },
          data: {
            status: "VIDEO_FAILED",
            errorMessage: (result.error ?? "Unknown error").slice(0, 500),
            providerJobId: result.taskId,
          },
        });
        logger.error("[video-generate] ❌ failed:", post.id, result.error);
        failed++;
      }
    } catch (err) {
      logger.error("[video-generate] error for:", socialVideo.id, err);
      await prisma.socialVideo
        .update({
          where: { id: socialVideo.id },
          data: {
            status: "VIDEO_FAILED",
            errorMessage:
              err instanceof Error ? err.message.slice(0, 500) : "Unknown error",
          },
        })
        .catch(() => {});
      failed++;
    }
  }

  return NextResponse.json({
    success: true,
    generated,
    failed,
    totalToday: todayVideoCount + generated,
    dailyLimit: DAILY_VIDEO_LIMIT,
    message: `Generated ${generated} videos. ${failed} failed.`,
  });
}
