// Social Engine — Cron 2: Daily Content Generation.
// Implements the fixed daily posting plan: 25 posts/day, 5 per platform, in a
// 70/20/10 evergreen/trend/breaking content mix. Each run tops every platform up
// to its daily cap, so the cron is idempotent and safe to invoke repeatedly.
// Signals come from the daily-signal generator (live market/vehicle intelligence
// + breaking topic signals) rather than the unbounded topic_signals backlog.
// Schedule: 0 6 * * * (06:00 UTC ≈ 01:00 CT).

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { generateAndQueuePost, getOptimalSlot } from "@/lib/social/social-post.orchestrator";
import { DAILY_POST_TARGETS } from "@/lib/social/config";
import { generateDailySignals } from "@/lib/social/daily-signal.generator";
import { hasHiggsfieldCredentials } from "@/lib/social/providers/higgsfield.provider";

// Up to 5 minutes — Groq calls dominate the runtime.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // 1. Verify cron auth (Vercel cron header or the shared CRON_SECRET bearer).
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // 2. Count today's posts per platform so we only generate what's still missing.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const todaysCounts = await prisma.socialPost.groupBy({
    by: ["platform"],
    where: {
      createdAt: { gte: today, lt: tomorrow },
      status: { notIn: ["REJECTED"] },
    },
    _count: { id: true },
  });

  const platformCounts: Record<string, number> = {};
  for (const row of todaysCounts) {
    platformCounts[row.platform] = row._count.id;
  }

  const platformsNeedingPosts: string[] = DAILY_POST_TARGETS.platforms.filter(
    (p) => (platformCounts[p] ?? 0) < DAILY_POST_TARGETS.perPlatform,
  );

  if (platformsNeedingPosts.length === 0) {
    logger.info("[social-generate] daily cap reached for all platforms");
    return NextResponse.json({
      success: true,
      message: "Daily cap reached",
      counts: platformCounts,
    });
  }

  logger.info(
    "[social-generate] platforms needing posts:",
    platformsNeedingPosts,
    "current counts:",
    platformCounts,
  );

  // 3. Generate today's daily signals, then keep only those for platforms that
  //    still have room under the per-platform cap.
  const allSignals = await generateDailySignals();
  const signals = allSignals.filter(
    (s) =>
      platformsNeedingPosts.includes(s.platform) &&
      (platformCounts[s.platform] ?? 0) < DAILY_POST_TARGETS.perPlatform,
  );

  // 4. Generate one post per signal, respecting the per-platform cap as we go.
  let created = 0;
  let failed = 0;
  const updatedCounts: Record<string, number> = { ...platformCounts };

  for (const signal of signals) {
    // Re-check the cap inside the loop — multiple signals target the same platform.
    if ((updatedCounts[signal.platform] ?? 0) >= DAILY_POST_TARGETS.perPlatform) {
      continue;
    }

    try {
      const franchise = await prisma.contentFranchise.findUnique({
        where: { slug: signal.franchiseSlug },
      });
      if (!franchise) {
        logger.info(
          "[social-generate] franchise not found:",
          signal.franchiseSlug,
        );
        continue;
      }

      // Base posting instant from the learned PostingWindow for this platform +
      // today (CT-correct via getOptimalSlot). slotIndex spreads the platform's
      // posts across its optimized slots as the per-platform count grows. The
      // orchestrator applies its own cross-platform publish stagger on top.
      const slotIndex = updatedCounts[signal.platform] ?? 0;
      const scheduledAt = await getOptimalSlot(
        signal.platform,
        new Date().getUTCDay(),
        slotIndex,
      );

      // Persist a real TopicSignal so the orchestrator + downstream attribution
      // have a concrete source record to hang the post and derivative off.
      const topicSignal = await prisma.topicSignal.create({
        data: {
          signalType: signal.signalType,
          make: signal.make ?? null,
          model: signal.model ?? null,
          city: signal.metro ?? null,
          metro: signal.metro ?? null,
          signalValue: signal.leverageScore ?? null,
          assetsGenerated: false,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          signalContext: {
            franchiseSlug: signal.franchiseSlug,
            contentCategory: signal.contentCategory,
            hookType: signal.hookType,
            msrpCents: signal.msrpCents ?? null,
            fairMarketLowCents: signal.fairMarketLowCents ?? null,
            isRepurpose: signal.isRepurpose ?? false,
          },
        },
      });

      // Orchestrator generates the script, scores quality, persists the post +
      // derivative, schedules visuals, and marks the signal consumed.
      await generateAndQueuePost({
        signal: topicSignal,
        franchise,
        platform: signal.platform,
        scheduledAt,
      });

      updatedCounts[signal.platform] =
        (updatedCounts[signal.platform] ?? 0) + 1;
      created++;

      logger.info(
        `[social-generate] ✅ ${signal.platform} post created:`,
        `${signal.franchiseSlug} (${signal.contentCategory})`,
        `scheduled: ${scheduledAt.toISOString()}`,
      );
    } catch (err) {
      logger.error(
        "[social-generate] ❌ failed:",
        signal.platform,
        signal.franchiseSlug,
        err instanceof Error ? err.message : err,
      );
      failed++;
    }
  }

  // 5. Trigger image generation for the new posts. Fire-and-forget — a slow or
  //    failed image pass must never affect the generation response.
  if (hasHiggsfieldCredentials() && created > 0) {
    fetch(
      `${process.env.NEXT_PUBLIC_APP_URL}/api/admin/social/generate-images`,
      {
        method: "POST",
        headers: {
          Authorization: `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`,
          "Content-Type": "application/json",
        },
      },
    ).catch((err) =>
      logger.error("[social-generate] image trigger failed:", err),
    );
  }

  const summary = {
    success: true,
    created,
    failed,
    platformCounts: updatedCounts,
    message: `Generated ${created} posts across platforms`,
  };
  logger.info("[social-generate]", JSON.stringify(summary));
  return NextResponse.json(summary);
}
