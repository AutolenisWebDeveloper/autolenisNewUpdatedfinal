// Social Engine — Cron 5: Publishing Status Sync.
// Reconciles recently published posts against the provider's reported status
// (e.g. a scheduled Buffer update that has since gone out). Schedule: every 2h.

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { getPublishingProvider } from "@/lib/social/providers/publishing.factory";

export const maxDuration = 120;

const LOOKBACK_MS = 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const provider = getPublishingProvider();
  const since = new Date(Date.now() - LOOKBACK_MS);

  const posts = await prisma.socialPost.findMany({
    where: {
      status: { in: ["PUBLISHED", "SCHEDULED"] },
      platformPostId: { not: null },
      OR: [{ publishedAt: { gte: since } }, { scheduledAt: { gte: since } }],
    },
    take: 50,
  });

  let synced = 0;
  let transitioned = 0;

  for (const post of posts) {
    if (!post.platformPostId) continue;
    try {
      const status = await provider.getPostStatus(post.platformPostId);
      synced += 1;
      // A scheduled post that the provider reports as sent becomes PUBLISHED.
      if (status.status === "sent" && post.status !== "PUBLISHED") {
        await prisma.socialPost.update({
          where: { id: post.id },
          data: { status: "PUBLISHED", publishedAt: status.publishedAt ? new Date(status.publishedAt) : new Date() },
        });
        transitioned += 1;
      }
    } catch (err) {
      logger.error(`[social-status-sync] failed post ${post.id}:`, err instanceof Error ? err.message : err);
    }
  }

  const summary = { considered: posts.length, synced, transitioned, timestamp: new Date().toISOString() };
  logger.info("[social-status-sync]", JSON.stringify(summary));
  return NextResponse.json({ success: true, data: summary });
}
