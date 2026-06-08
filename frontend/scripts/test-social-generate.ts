// Manual end-to-end test for the social post generation pipeline.
//
// Scans (or reuses) a TopicSignal, routes it to a franchise, generates one post
// via Groq, and verifies a social_posts row is actually written.
//
// Usage:
//   cd frontend
//   export DATABASE_URL="..."
//   export GROQ_API_KEY="..."
//   pnpm tsx scripts/test-social-generate.ts

import { prisma } from "@/lib/prisma";
import { scanForTopicSignals } from "@/lib/social/topic-signal.engine";
import { routeSignalToFranchises } from "@/lib/social/franchise-router";
import { generateAndQueuePost } from "@/lib/social/social-post.orchestrator";

async function test() {
  console.log("[test] scanning for signals...");
  let signals = await scanForTopicSignals();
  console.log("[test] signals found:", signals.length);

  if (signals.length === 0) {
    console.log("[test] no new signals — checking existing signals in DB");
    const existing = await prisma.topicSignal.findFirst({
      where: { assetsGenerated: false },
      orderBy: { detectedAt: "desc" },
    });
    if (!existing) {
      console.log("[test] no signals available");
      return;
    }
    signals = [existing];
  }

  const signal = signals[0];
  console.log("[test] using signal:", signal.signalType, signal.make ?? "(no make)");

  // routeSignalToFranchises is async — it queries the DB for live franchise config.
  const franchiseRoutes = await routeSignalToFranchises(signal);
  console.log("[test] franchise routes:", franchiseRoutes.length);

  if (franchiseRoutes.length === 0) {
    console.log("[test] PROBLEM: franchise router returned empty");
    return;
  }

  const first = franchiseRoutes[0];
  const scheduledAt = new Date();
  scheduledAt.setHours(scheduledAt.getHours() + 1);

  console.log("[test] generating post for franchise:", first.franchise.slug, "platform:", first.platforms[0]);
  const post = await generateAndQueuePost({
    signal,
    franchise: first.franchise,
    platform: first.platforms[0],
    scheduledAt,
  });

  console.log("[test] POST CREATED:", post.id, post.status);

  const count = await prisma.socialPost.count();
  console.log("[test] total social_posts in DB:", count);
}

test()
  .catch((err) => {
    console.error("[test] FAILED:", err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
