// Social Engine — Cron 2: Daily Content Generation.
// Takes unused, unexpired TopicSignals, routes each to its franchises, and
// generates one SocialPost per platform scheduled at the franchise posting
// slots (CT). Schedule: 0 6 * * * (06:00 UTC ≈ 01:00 CT).

import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { routeSignalToFranchises } from "@/lib/social/franchise-router";
import { generateAndQueuePost } from "@/lib/social/social-post.orchestrator";
import { computePostingSlots } from "@/lib/social/scheduling";
import { CONTENT_CALENDAR, checkHighIntensityPeriod } from "@/lib/social/config";

// Up to 5 minutes — Groq calls dominate the runtime.
export const maxDuration = 300;

// Fetch a buffer of candidate signals; the content calendar then prioritizes
// and trims them to the day's scaled volume target before processing.
const SIGNAL_FETCH_LIMIT = 80;
// Cap total generations per run so a backlog can't blow the function budget.
const MAX_POSTS_PER_RUN = 40;
const DELAY_MS = 800;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const signals = await prisma.topicSignal.findMany({
    where: { assetsGenerated: false, expiresAt: { gt: new Date() } },
    orderBy: { detectedAt: "desc" },
    take: SIGNAL_FETCH_LIMIT,
  });

  // ─── Content calendar gating ───────────────────────────────────────────────
  // Scale the day's generation volume by the day-of-week multiplier (and any
  // active high-intensity sales period), and surface this day's priority
  // franchises so their signals are processed first.
  const today = new Date();
  const dayOfWeek = today.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  const volumeMultiplier = CONTENT_CALENDAR.volumeMultiplier[dayOfWeek] ?? 1.0;
  const priorityFranchises = CONTENT_CALENDAR.franchiseByDay[dayOfWeek] ?? [];
  const highIntensity = checkHighIntensityPeriod(today);
  const finalMultiplier = highIntensity
    ? volumeMultiplier * highIntensity.multiplier
    : volumeMultiplier;

  if (highIntensity) {
    console.log(
      `[social-generate] HIGH INTENSITY PERIOD: ${highIntensity.name}`,
      `multiplier: ${finalMultiplier}×`,
    );
  }

  // Scale max signals by day multiplier.
  const baseMax = 10;
  const maxSignals = Math.ceil(baseMax * finalMultiplier);

  // Sort signals: priority franchises for today go first.
  signals.sort((a, b) => {
    const aCtx = a.signalContext as Record<string, unknown>;
    const bCtx = b.signalContext as Record<string, unknown>;
    const aIsPriority = priorityFranchises.some((slug) =>
      String(aCtx?.franchise ?? a.signalType ?? "").includes(slug),
    );
    const bIsPriority = priorityFranchises.some((slug) =>
      String(bCtx?.franchise ?? b.signalType ?? "").includes(slug),
    );
    return (bIsPriority ? 1 : 0) - (aIsPriority ? 1 : 0);
  });

  const signalsToProcess = signals.slice(0, maxSignals);
  console.log(
    `[social-generate] processing ${signalsToProcess.length} signals`,
    `(day multiplier: ${finalMultiplier}×, max: ${maxSignals})`,
  );

  let generated = 0;
  let failed = 0;
  let skipped = 0;

  outer: for (const signal of signalsToProcess) {
    const routes = await routeSignalToFranchises(signal);
    if (routes.length === 0) {
      skipped += 1;
      // Nothing routed — mark consumed so it doesn't re-queue forever.
      await prisma.topicSignal
        .update({ where: { id: signal.id }, data: { assetsGenerated: true } })
        .catch(() => undefined);
      continue;
    }

    for (const route of routes) {
      const slots = computePostingSlots(route.franchise.postingSlots);
      for (let i = 0; i < route.platforms.length; i++) {
        if (generated >= MAX_POSTS_PER_RUN) break outer;
        const platform = route.platforms[i];
        const scheduledAt = slots[i % Math.max(slots.length, 1)] ?? computePostingSlots([12])[0];
        try {
          await generateAndQueuePost({ signal, franchise: route.franchise, platform, scheduledAt });
          generated += 1;
        } catch (err) {
          failed += 1;
          console.error(
            `[social-generate] failed signal=${signal.id} franchise=${route.franchise.slug} platform=${platform}:`,
            err instanceof Error ? err.message : err,
          );
        }
        await sleep(DELAY_MS);
      }
    }
  }

  const summary = {
    signalsConsidered: signalsToProcess.length,
    postsGenerated: generated,
    failed,
    skipped,
    timestamp: new Date().toISOString(),
  };
  console.log("[social-generate]", JSON.stringify(summary));
  return NextResponse.json({ success: true, data: summary });
}
