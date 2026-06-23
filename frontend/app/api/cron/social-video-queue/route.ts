// Social Engine — Cron 3: Video Generation Queue.
// Submits queued video jobs and polls in-flight jobs, transitioning them to
// VIDEO_READY / VIDEO_FAILED and storing the resulting URLs.
// Schedule: every 10 minutes.

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { getVideoProvider } from "@/lib/social/providers/video-generation.factory";
import {
  storeImageInSupabase,
  generateHiggsfieldPostImage,
} from "@/lib/social/image-generation.service";
import { hasHiggsfieldCredentials } from "@/lib/social/providers/higgsfield.provider";
import { ENABLE_AUTO_PUBLISH } from "@/lib/social/config";

export const maxDuration = 300;

const MAX_PER_RUN = 5;
// Image backfill is synchronous (generate + poll per post), so keep the per-run
// batch small to stay within maxDuration.
const MAX_IMAGE_BACKFILL = 5;
const POLL_STALE_MS = 5 * 60_000;

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // ─── Trigger Runway video generation early ─────────────────────────────────
  // Fire before the main polling/backfill loops so a timeout later in this
  // handler cannot prevent video generation from being triggered. Tier 1 posts
  // (TikTok / Instagram / YouTube) with a Higgsfield still get animated into a short
  // video. Fire-and-forget — the dedicated cron enforces its own daily cap +
  // Tier 1 filter and polls Runway synchronously, so it must not block this run.
  // (vercel.json is at the 40-cron cap, so this is wired into the existing
  // video-queue cron rather than scheduled separately.)
  if (process.env.RUNWAY_API_KEY && process.env.NEXT_PUBLIC_APP_URL) {
    fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/cron/social-video-generate`, {
      headers: {
        [CRON_AUTH_HEADER]: `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`,
      },
    }).catch((err) =>
      logger.error("[video-queue] runway video trigger failed:", err),
    );
    logger.info("[video-queue] Runway video generation triggered");
  }

  const provider = getVideoProvider();
  const staleBefore = new Date(Date.now() - POLL_STALE_MS);

  const videos = await prisma.socialVideo.findMany({
    where: {
      OR: [
        { status: "VIDEO_QUEUED" },
        { status: "VIDEO_GENERATING", OR: [{ lastPolledAt: null }, { lastPolledAt: { lt: staleBefore } }] },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: MAX_PER_RUN,
  });

  let submitted = 0;
  let completed = 0;
  let failed = 0;
  let stillProcessing = 0;

  for (const video of videos) {
    try {
      if (video.status === "VIDEO_QUEUED") {
        const result = await provider.submitJob({
          postId: video.postId,
          visualPrompt: video.visualPrompt ?? "",
          durationSeconds: video.durationSeconds ?? 30,
          style: video.style ?? undefined,
        });
        if (result.success) submitted += 1;
        else failed += 1;
        continue;
      }

      // VIDEO_GENERATING — poll.
      if (!video.providerJobId) {
        await prisma.socialVideo.update({
          where: { id: video.id },
          data: { status: "VIDEO_FAILED", errorMessage: "missing providerJobId", lastPolledAt: new Date() },
        });
        failed += 1;
        continue;
      }

      const status = await provider.getJobStatus(video.providerJobId);
      if (status.status === "completed") {
        await prisma.socialVideo.update({
          where: { id: video.id },
          data: {
            status: "VIDEO_READY",
            videoUrl: status.videoUrl,
            thumbnailUrl: status.thumbnailUrl,
            generatedAt: new Date(),
            lastPolledAt: new Date(),
            pollAttempts: { increment: 1 },
          },
        });
        // Promote the parent post so the publishing queue can pick it up.
        if (ENABLE_AUTO_PUBLISH) {
          await prisma.socialPost.updateMany({
            where: { id: video.postId, status: "APPROVED" },
            data: { status: "SCHEDULED" },
          });
        }
        completed += 1;
      } else if (status.status === "failed") {
        await prisma.socialVideo.update({
          where: { id: video.id },
          data: {
            status: "VIDEO_FAILED",
            errorMessage: status.error ?? "video generation failed",
            lastPolledAt: new Date(),
            pollAttempts: { increment: 1 },
          },
        });
        failed += 1;
      } else {
        await prisma.socialVideo.update({
          where: { id: video.id },
          data: { lastPolledAt: new Date(), pollAttempts: { increment: 1 } },
        });
        stillProcessing += 1;
      }
    } catch (err) {
      failed += 1;
      logger.error(`[social-video-queue] error on video ${video.id}:`, err instanceof Error ? err.message : err);
    }
  }

  // ─── Higgsfield image backfill ─────────────────────────────────────────────
  // Primary media path: generate a branded still image for APPROVED posts that
  // still have no SocialVideo record. Higgsfield is the exclusive image
  // provider; with no Higgsfield credentials there is nothing to do.
  const useHiggsfield = hasHiggsfieldCredentials();
  let imagesGenerated = 0;
  let imagesFailed = 0;

  if (!useHiggsfield) {
    logger.info("[video-queue] no image provider configured — skipping backfill");
  } else {
    const postsNeedingImages = await prisma.socialPost.findMany({
      where: { status: "APPROVED", video: { is: null } },
      orderBy: { createdAt: "asc" },
      take: MAX_IMAGE_BACKFILL,
    });

    for (const post of postsNeedingImages) {
      try {
        const visuals = await generateHiggsfieldPostImage(post);
        if (visuals.imageUrl) {
          imagesGenerated += 1;
          logger.info("[video-queue] Higgsfield image generated for post:", post.id);
        } else {
          imagesFailed += 1;
          logger.error(
            "[video-queue] Higgsfield backfill failed for post:",
            post.id,
            "— creating VIDEO_FAILED to prevent infinite retry",
          );
          // Create VIDEO_FAILED so the post is excluded from future backfill
          // runs. SocialVideo.postId is @unique, so skip if a record already
          // exists. Matches the hardened pattern in the generate-images endpoint.
          const existingVideo = await prisma.socialVideo
            .findUnique({ where: { postId: post.id }, select: { id: true } })
            .catch(() => null);
          if (!existingVideo) {
            await prisma.socialVideo
              .create({
                data: {
                  postId: post.id,
                  provider: "higgsfield",
                  status: "VIDEO_FAILED",
                  errorMessage:
                    "Higgsfield generation returned empty — check HF_CREDENTIALS and account credits",
                  visualPrompt: post.visualPrompt ?? post.hook ?? "",
                  generatedAt: new Date(),
                },
              })
              .catch((dbErr) =>
                logger.error(
                  "[video-queue] VIDEO_FAILED record creation failed:",
                  post.id,
                  dbErr,
                ),
              );
          }
        }
      } catch (err) {
        imagesFailed += 1;
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(
          "[video-queue] Higgsfield backfill error for post:",
          post.id,
          errorMsg,
        );
        // Prevent infinite retry — record the failure (one SocialVideo per post).
        const existingVideo = await prisma.socialVideo
          .findUnique({ where: { postId: post.id }, select: { id: true } })
          .catch(() => null);
        if (!existingVideo) {
          await prisma.socialVideo
            .create({
              data: {
                postId: post.id,
                provider: "higgsfield",
                status: "VIDEO_FAILED",
                errorMessage: errorMsg.slice(0, 500),
                visualPrompt: post.visualPrompt ?? post.hook ?? "",
                generatedAt: new Date(),
              },
            })
            .catch(() => {});
        }
      }
    }
  }

  // ─── Poll pending AI media generations ─────────────────────────────────────
  // Picks up text-to-image jobs that didn't finish within the synchronous poll
  // window in the image-generation service, plus any other in-flight Higgsfield
  // jobs, and resolves them to stored assets. Only runs with the live provider.
  let mediaCompleted = 0;
  let mediaProcessing = 0;
  let mediaFailed = 0;
  if (provider.name === "higgsfield") {
    const pendingGenerations = await prisma.aiMediaGeneration.findMany({
      where: {
        status: { in: ["queued", "in_progress"] },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      select: {
        id: true,
        higgsfieldRequestId: true,
        statusUrl: true,
        status: true,
        generationType: true,
        socialPostId: true,
      },
      take: 10,
    });

    for (const gen of pendingGenerations) {
      if (!gen.higgsfieldRequestId) continue;
      try {
        // getJobStatus refreshes the AiMediaGeneration row (and mirrors any
        // matching SocialVideo by providerJobId) as a side effect.
        const status = await provider.getJobStatus(gen.higgsfieldRequestId);

        if (status.status === "completed" && gen.socialPostId) {
          if (gen.generationType === "text_to_image") {
            // Store the still image and surface it as the post's thumbnail so it
            // can publish with a visual while any video keeps rendering.
            const imageUrl = status.thumbnailUrl ?? status.videoUrl;
            if (imageUrl) {
              const stored = await storeImageInSupabase(imageUrl, gen.socialPostId).catch(
                () => imageUrl,
              );
              await prisma.socialVideo.upsert({
                where: { postId: gen.socialPostId },
                create: {
                  postId: gen.socialPostId,
                  status: "SCRIPT_READY",
                  thumbnailUrl: stored,
                  storageBucket: "social-media-assets",
                  storagePath: `social-posts/${gen.socialPostId}/image.jpg`,
                },
                update: {
                  thumbnailUrl: stored,
                  storageBucket: "social-media-assets",
                  storagePath: `social-posts/${gen.socialPostId}/image.jpg`,
                },
              });
            }
          }
          // image_to_video completion is reconciled onto SocialVideo by the
          // main polling loop above (keyed by providerJobId); nothing to do here.
          mediaCompleted += 1;
        } else if (status.status === "failed") {
          mediaFailed += 1;
        } else {
          mediaProcessing += 1;
        }
      } catch (err) {
        logger.error("[video-queue] polling failed for:", gen.id, err instanceof Error ? err.message : err);
        mediaFailed += 1;
      }
    }
  }

  const summary = {
    considered: videos.length,
    submitted,
    completed,
    failed,
    stillProcessing,
    imagesGenerated,
    imagesFailed,
    mediaCompleted,
    mediaProcessing,
    mediaFailed,
    timestamp: new Date().toISOString(),
  };
  logger.info("[social-video-queue]", JSON.stringify(summary));
  return NextResponse.json({ success: true, data: summary });
}
