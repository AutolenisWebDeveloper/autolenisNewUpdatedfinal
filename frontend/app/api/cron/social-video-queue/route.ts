// Social Engine — Cron 3: Video Generation Queue.
// Submits queued video jobs and polls in-flight jobs, transitioning them to
// VIDEO_READY / VIDEO_FAILED and storing the resulting URLs.
// Schedule: every 10 minutes.

import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { getVideoProvider } from "@/lib/social/providers/video-generation.factory";
import { ENABLE_AUTO_PUBLISH } from "@/lib/social/config";

export const maxDuration = 300;

const MAX_PER_RUN = 5;
const POLL_STALE_MS = 5 * 60_000;

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
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
      console.error(`[social-video-queue] error on video ${video.id}:`, err instanceof Error ? err.message : err);
    }
  }

  const summary = { considered: videos.length, submitted, completed, failed, stillProcessing, timestamp: new Date().toISOString() };
  console.log("[social-video-queue]", JSON.stringify(summary));
  return NextResponse.json({ success: true, data: summary });
}
