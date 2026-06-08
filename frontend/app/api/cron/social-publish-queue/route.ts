// Social Engine — Cron 4: Publishing Queue.
// Publishes due posts (APPROVED/SCHEDULED, scheduledAt reached) whose video is
// ready or which have no video. Schedule: every 5 minutes.

import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { publishApprovedPost } from "@/lib/social/social-post.orchestrator";

export const maxDuration = 300;

const MAX_PER_RUN = 10;

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const now = new Date();
  const posts = await prisma.socialPost.findMany({
    where: {
      status: { in: ["APPROVED", "SCHEDULED"] },
      scheduledAt: { lte: now },
      // Either no video job, or the video is ready.
      OR: [{ video: { is: null } }, { video: { status: "VIDEO_READY" } }],
    },
    orderBy: { scheduledAt: "asc" },
    take: MAX_PER_RUN,
  });

  let published = 0;
  let failed = 0;

  for (const post of posts) {
    try {
      await publishApprovedPost(post);
      published += 1;
    } catch (err) {
      failed += 1;
      console.error(`[social-publish-queue] failed post ${post.id}:`, err instanceof Error ? err.message : err);
    }
  }

  const summary = { considered: posts.length, published, failed, timestamp: now.toISOString() };
  console.log("[social-publish-queue]", JSON.stringify(summary));
  return NextResponse.json({ success: true, data: summary });
}
