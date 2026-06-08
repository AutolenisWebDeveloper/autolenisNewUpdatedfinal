// AutoLenis Social Engine — Viral Detection Engine.
//
// Checks PUBLISHED posts from the last 6 hours, computes view velocity
// (views/hour), and fires alerts when a post exceeds the platform baseline
// by 3×. Called by the analytics-sync cron or on demand.

import { prisma } from "@/lib/prisma";
import { NotificationType } from "@prisma/client";

export interface ViralAlert {
  postId: string;
  platform: string;
  currentViews: number;
  velocity: number; // views per hour
  threshold: number;
  action: "expand_audience" | "spawn_variants" | "alert_admin";
}

const PLATFORM_BASELINES: Record<string, number> = {
  tiktok: 100,
  instagram: 50,
  facebook: 30,
  youtube: 20,
  linkedin: 10,
};
const VIRAL_MULTIPLIER = 3;

function getBaseline(platform: string): number {
  return PLATFORM_BASELINES[platform.toLowerCase()] ?? 30;
}

function chooseAction(velocity: number, baseline: number): ViralAlert["action"] {
  if (velocity > baseline * 10) return "spawn_variants";
  if (velocity > baseline * 5) return "expand_audience";
  return "alert_admin";
}

export async function checkViralSignals(): Promise<ViralAlert[]> {
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000);

  const posts = await prisma.socialPost.findMany({
    where: { status: "PUBLISHED", publishedAt: { gte: since } },
    select: { id: true, platform: true, publishedAt: true },
  });

  if (posts.length === 0) return [];

  const alerts: ViralAlert[] = [];

  for (const post of posts) {
    const perf = await prisma.socialPerformance.findFirst({
      where: { postId: post.id },
      orderBy: { createdAt: "desc" },
      select: { views: true, impressions: true },
    });
    if (!perf) continue;

    const views = perf.views ?? perf.impressions ?? 0;
    const publishedAt = post.publishedAt ?? since;
    const hoursLive = Math.max(0.1, (Date.now() - publishedAt.getTime()) / (60 * 60 * 1000));
    const velocity = views / hoursLive;

    const baseline = getBaseline(post.platform);
    const threshold = baseline * VIRAL_MULTIPLIER;

    if (velocity >= threshold) {
      alerts.push({
        postId: post.id,
        platform: post.platform,
        currentViews: views,
        velocity: Math.round(velocity),
        threshold,
        action: chooseAction(velocity, baseline),
      });
    }
  }

  console.log("[viral-detection] checked", posts.length, "posts, alerts:", alerts.length);
  return alerts;
}

export async function handleViralAlert(alert: ViralAlert): Promise<void> {
  console.log("[viral] 🔥 viral signal:", alert);

  // Create a notification (best-effort — no required user fields so we use a system channel).
  await prisma.notification
    .create({
      data: {
        type: NotificationType.SYSTEM_ALERT,
        title: "🔥 Viral Signal Detected",
        body: `${alert.platform} post is getting ${alert.velocity} views/hr (threshold: ${alert.threshold})`,
      },
    })
    .catch((err: unknown) =>
      console.warn("[viral] notification create failed (non-fatal):", err instanceof Error ? err.message : err),
    );

  if (alert.action === "spawn_variants") {
    const post = await prisma.socialPost.findUnique({
      where: { id: alert.postId },
      include: { signal: true, franchise: true },
    });
    if (post?.signal && post?.franchise) {
      const otherPlatforms = ["tiktok", "instagram", "facebook", "youtube", "linkedin"].filter(
        (p) => p !== post.platform,
      );
      for (const platform of otherPlatforms.slice(0, 3)) {
        try {
          const { generateAndQueuePost } = await import("@/lib/social/social-post.orchestrator");
          const scheduledAt = new Date(Date.now() + 10 * 60 * 1000);
          await generateAndQueuePost({ signal: post.signal, franchise: post.franchise, platform, scheduledAt });
          console.log("[viral] spawned variant for platform:", platform);
        } catch (err) {
          console.warn("[viral] spawn failed for", platform, err instanceof Error ? err.message : err);
        }
      }
    }
  }

  // Boost lead score × 2 for the viral post.
  await prisma.socialPost
    .update({
      where: { id: alert.postId },
      data: { leadScore: { multiply: 2 } },
    })
    .catch((err: unknown) =>
      console.warn("[viral] lead score boost failed (non-fatal):", err instanceof Error ? err.message : err),
    );
}
