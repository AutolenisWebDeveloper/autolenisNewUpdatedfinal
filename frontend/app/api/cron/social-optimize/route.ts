// Social Engine — Cron 7: Weekly Optimization.
// Learns winning patterns from the last 30 days of performance: recomputes
// WinningPattern + HookPerformance, nudges PostingWindow slots toward the
// best-performing hours, and refreshes each franchise's avg lead score.
// Schedule: 0 6 * * 0 (06:00 UTC Sunday).

import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;

const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

interface Agg {
  ctr: number[];
  leadScore: number[];
  vehicleRequests: number[];
  revenue: number[];
  reach: number[];
}
const newAgg = (): Agg => ({ ctr: [], leadScore: [], vehicleRequests: [], revenue: [], reach: [] });
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const since = new Date(Date.now() - LOOKBACK_MS);
  const rows = await prisma.socialPerformance.findMany({
    where: { recordedAt: { gte: since } },
    include: { post: { include: { franchise: true } } },
  });

  // Group keys.
  const patterns = new Map<string, Agg & { platform: string; franchiseSlug: string | null; hookType: string | null; dayOfWeek: number; hour: number }>();
  const hooks = new Map<string, Agg & { platform: string; hookType: string; completion: number[] }>();
  const windowScores = new Map<string, Map<number, number[]>>(); // platform -> day -> hour leadScores keyed below
  const franchiseScores = new Map<string, number[]>();

  for (const r of rows) {
    const post = r.post;
    const when = post.publishedAt ?? post.scheduledAt ?? r.recordedAt;
    const dayOfWeek = when.getUTCDay();
    const hour = when.getUTCHours();
    const ctr = r.reach > 0 ? r.linkClicks / r.reach : 0;
    const slug = post.franchise?.slug ?? null;

    const pKey = `${post.platform}|${slug}|${post.hookType}|${dayOfWeek}|${hour}`;
    if (!patterns.has(pKey)) {
      patterns.set(pKey, { ...newAgg(), platform: post.platform, franchiseSlug: slug, hookType: post.hookType, dayOfWeek, hour });
    }
    const p = patterns.get(pKey)!;
    p.ctr.push(ctr);
    p.leadScore.push(r.leadScore);
    p.vehicleRequests.push(r.vehicleRequests);
    p.revenue.push(r.revenueGenerated);
    p.reach.push(r.reach);

    if (post.hookType) {
      const hKey = `${post.platform}|${post.hookType}`;
      if (!hooks.has(hKey)) hooks.set(hKey, { ...newAgg(), platform: post.platform, hookType: post.hookType, completion: [] });
      const h = hooks.get(hKey)!;
      h.ctr.push(ctr);
      h.leadScore.push(r.leadScore);
      h.vehicleRequests.push(r.vehicleRequests);
      if (r.completionRate != null) h.completion.push(r.completionRate);
    }

    if (!windowScores.has(post.platform)) windowScores.set(post.platform, new Map());
    const dayMap = windowScores.get(post.platform)!;
    const hourKey = dayOfWeek * 100 + hour;
    if (!dayMap.has(hourKey)) dayMap.set(hourKey, []);
    dayMap.get(hourKey)!.push(r.leadScore);

    if (slug) {
      if (!franchiseScores.has(slug)) franchiseScores.set(slug, []);
      franchiseScores.get(slug)!.push(r.leadScore);
    }
  }

  // Rebuild WinningPattern from scratch (no unique key — weekly full recompute).
  await prisma.winningPattern.deleteMany({});
  if (patterns.size > 0) {
    await prisma.winningPattern.createMany({
      data: Array.from(patterns.values()).map((p) => ({
        platform: p.platform,
        franchiseSlug: p.franchiseSlug,
        hookType: p.hookType,
        dayOfWeek: p.dayOfWeek,
        hour: p.hour,
        avgCtr: avg(p.ctr),
        avgLeadScore: avg(p.leadScore),
        avgVehicleRequests: avg(p.vehicleRequests),
        avgRevenue: avg(p.revenue),
        sampleSize: p.leadScore.length,
      })),
    });
  }

  // Upsert HookPerformance (unique on platform+hookType).
  for (const h of hooks.values()) {
    await prisma.hookPerformance.upsert({
      where: { platform_hookType: { platform: h.platform, hookType: h.hookType } },
      create: {
        platform: h.platform,
        hookType: h.hookType,
        avgCompletionRate: avg(h.completion),
        avgCtr: avg(h.ctr),
        avgLeadScore: avg(h.leadScore),
        avgVehicleRequests: avg(h.vehicleRequests),
        sampleSize: h.leadScore.length,
      },
      update: {
        avgCompletionRate: avg(h.completion),
        avgCtr: avg(h.ctr),
        avgLeadScore: avg(h.leadScore),
        avgVehicleRequests: avg(h.vehicleRequests),
        sampleSize: h.leadScore.length,
        lastUpdated: new Date(),
      },
    });
  }

  // Nudge posting windows toward the best-performing hours per platform+day.
  let windowsUpdated = 0;
  for (const [platform, dayMap] of windowScores.entries()) {
    // Group hourKeys back into day → [{hour, score}].
    const byDay = new Map<number, Array<{ hour: number; score: number }>>();
    for (const [hourKey, scores] of dayMap.entries()) {
      const day = Math.floor(hourKey / 100);
      const hour = hourKey % 100;
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push({ hour, score: avg(scores) });
    }
    for (const [day, hoursArr] of byDay.entries()) {
      const top = hoursArr.sort((a, b) => b.score - a.score).slice(0, 3).map((h) => h.hour);
      if (top.length === 0) continue;
      await prisma.postingWindow
        .upsert({
          where: { platform_dayOfWeek: { platform, dayOfWeek: day } },
          create: {
            platform,
            dayOfWeek: day,
            slot1Hour: top[0] ?? 7,
            slot2Hour: top[1] ?? 12,
            slot3Hour: top[2] ?? 19,
            lastOptimizedAt: new Date(),
          },
          update: {
            slot1Hour: top[0] ?? 7,
            slot2Hour: top[1] ?? 12,
            slot3Hour: top[2] ?? 19,
            lastOptimizedAt: new Date(),
          },
        })
        .then(() => {
          windowsUpdated += 1;
        })
        .catch(() => undefined);
    }
  }

  // Refresh franchise avg lead score.
  for (const [slug, scores] of franchiseScores.entries()) {
    await prisma.contentFranchise
      .update({ where: { slug }, data: { avgLeadScore: avg(scores) } })
      .catch(() => undefined);
  }

  const summary = {
    performanceRows: rows.length,
    winningPatterns: patterns.size,
    hookTypes: hooks.size,
    windowsUpdated,
    franchisesUpdated: franchiseScores.size,
    timestamp: new Date().toISOString(),
  };
  console.log("[social-optimize]", JSON.stringify(summary));
  return NextResponse.json({ success: true, data: summary });
}
