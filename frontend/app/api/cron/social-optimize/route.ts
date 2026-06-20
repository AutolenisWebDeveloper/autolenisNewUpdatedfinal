// Social Engine — Cron 7: Weekly Optimization.
// Learns winning patterns from the last 30 days of performance: recomputes
// WinningPattern + HookPerformance, nudges PostingWindow slots toward the
// best-performing hours, and refreshes each franchise's avg lead score.
// Schedule: 0 6 * * 0 (06:00 UTC Sunday).

import { logger } from "@/lib/logger";
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
    // reach/linkClicks may be null ("unknown"); coerce to 0 for the CTR ratio.
    const reach = r.reach ?? 0;
    const ctr = reach > 0 ? (r.linkClicks ?? 0) / reach : 0;
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
    p.reach.push(r.reach ?? 0);

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
  // Delete + recreate must be atomic: a crash/timeout between the two writes
  // would otherwise leave the table empty and degrade generation hook-selection
  // until the next weekly run. $transaction makes the swap all-or-nothing.
  const newPatterns = Array.from(patterns.values()).map((p) => ({
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
  }));
  await prisma.$transaction([
    prisma.winningPattern.deleteMany({}),
    ...(newPatterns.length > 0
      ? [prisma.winningPattern.createMany({ data: newPatterns })]
      : []),
  ]);

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

  // Content recycling (Session C): re-publish the top evergreen posts from
  // 90-180 days ago with freshly trending hashtags. Non-fatal — a failure here
  // never blocks the rest of the weekly optimization run.
  try {
    const { findRecyclablePosts, recyclePost } = await import(
      "@/lib/social/content-recycling.engine"
    );
    const recyclable = await findRecyclablePosts();
    let recycled = 0;
    for (const post of recyclable.slice(0, 3)) {
      const result = await recyclePost(post);
      if (result) recycled++;
    }
    if (recycled > 0) {
      logger.info(`[optimize] recycled ${recycled} top-performing posts`);
    }
  } catch (err) {
    logger.error("[optimize] recycling failed:", err);
  }

  // Send weekly SMS market alerts to SMS-consented buyers about the strongest
  // buyer-leverage market. BuyerOpportunity has no metro/city field (only zip),
  // so we cannot target per-metro — instead we query consented buyers once and
  // send each a single alert about the #1 market, avoiding duplicate sends.
  try {
    const { sendMarketAlertSMS } = await import(
      "@/lib/social/sms-distribution.service"
    );

    const topSmsMarkets = await prisma.marketIntelligence
      .findMany({
        where: { buyerLeverageScore: { gte: 7.0 } },
        orderBy: { buyerLeverageScore: "desc" },
        take: 3,
        select: { metroName: true, buyerLeverageScore: true },
      })
      .catch(() => []);

    const topMarket = topSmsMarkets[0];
    if (!topMarket) {
      logger.info("[optimize-sms] no high-leverage markets this week");
    } else {
      const leverage = topMarket.buyerLeverageScore ?? 0;

      // SMS-consented buyers with a phone, active in the last 90 days. The
      // consent gate (consentSms) is required — never send marketing SMS
      // without it. Capped at 50 sends per week.
      const buyers = await prisma.buyerOpportunity
        .findMany({
          where: {
            consentSms: true,
            phone: { not: null },
            createdAt: {
              gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
            },
          },
          select: { id: true, phone: true, firstName: true },
          take: 50,
        })
        .catch(() => []);

      let smsSent = 0;
      for (const buyer of buyers) {
        if (!buyer.phone) continue;
        try {
          await sendMarketAlertSMS({
            phoneNumber: buyer.phone,
            firstName: buyer.firstName ?? "there",
            city: topMarket.metroName,
            marketSignal:
              `Buyer leverage in ${topMarket.metroName} is at ` +
              `${leverage.toFixed(1)}/10 this week — ` +
              `dealers are competing hard for buyers right now`,
            trackedUrl:
              `https://www.autolenis.com/lp/market-alert` +
              `?utm_source=sms&utm_medium=sms` +
              `&utm_campaign=market_alert_weekly` +
              `&utm_content=${topMarket.metroName.replace(/\s+/g, "_").toLowerCase()}`,
          });
          smsSent++;
        } catch (smsErr) {
          logger.error("[optimize-sms] send failed:", smsErr);
        }
      }

      logger.info(
        `[optimize-sms] sent ${smsSent} alerts for ${topMarket.metroName}`,
        `(leverage: ${leverage.toFixed(1)})`,
      );
    }
  } catch (err) {
    logger.error("[optimize-sms] block failed:", err);
  }

  // Refresh the Meta retargeting Custom Audience from non-converting social
  // leads. Self-gates on META_ACCESS_TOKEN / META_AD_ACCOUNT_ID and no-ops when
  // unset, so this is safe to call unconditionally.
  try {
    const { buildRetargetingAudience } = await import(
      "@/lib/social/retargeting.service"
    );
    await buildRetargetingAudience();
  } catch (err) {
    logger.error("[optimize] retargeting audience build failed:", err);
  }

  // Distribute weekly content packages to active creators (gated by flag).
  if (process.env.ENABLE_CREATOR_DISTRIBUTION === "true") {
    try {
      const { distributeCreatorPackages } = await import(
        "@/lib/social/creator-package.generator"
      );
      await distributeCreatorPackages();
    } catch (err) {
      logger.error("[optimize] creator distribution failed:", err);
    }
  }

  // ─── Smart posting windows update (Session D) ──────────────────────────────
  // Pull the best-performing hours per platform from the freshly-rebuilt
  // WinningPattern table and align each platform's PostingWindow slots to them.
  // platformHours is reused by the weekly report email below.
  const platformHours: Record<string, number[]> = {};
  try {
    for (const platform of ["tiktok", "instagram", "facebook", "youtube", "linkedin"]) {
      const bestPatterns = await prisma.winningPattern.findMany({
        where: { platform, hour: { not: null }, sampleSize: { gte: 5 } },
        orderBy: { avgLeadScore: "desc" },
        take: 3,
        select: { hour: true },
      });
      if (bestPatterns.length >= 2) {
        platformHours[platform] = bestPatterns
          .map((p) => p.hour!)
          .filter((h): h is number => h != null);
      }
    }

    for (const [platform, hours] of Object.entries(platformHours)) {
      if (hours.length < 2) continue;
      await prisma.postingWindow.updateMany({
        where: { platform },
        data: {
          slot1Hour: hours[0],
          slot2Hour: hours[1] ?? 12,
          slot3Hour: hours[2] ?? 19,
          lastOptimizedAt: new Date(),
        },
      });
      logger.info(`[optimize] updated ${platform} posting windows:`, hours.join(", "));
    }
  } catch (err) {
    logger.error("[optimize] posting window update failed:", err);
  }

  // ─── Franchise volume analysis (Session D) ─────────────────────────────────
  // Flag franchises that are meaningfully out-performing / under-performing the
  // cross-franchise average lead score so the content mix can be re-weighted.
  try {
    const franchises = await prisma.contentFranchise.findMany({
      where: { active: true },
      select: { id: true, slug: true, avgLeadScore: true },
    });
    const fScores = franchises.map((f) => f.avgLeadScore ?? 0);
    const fAvg = fScores.length > 0 ? fScores.reduce((a, b) => a + b, 0) / fScores.length : 1;

    for (const franchise of franchises) {
      const score = franchise.avgLeadScore ?? 0;
      if (score > fAvg * 1.5) {
        logger.info(
          `[optimize] PRIORITY franchise: ${franchise.slug}`,
          `(score ${score.toFixed(2)} vs avg ${fAvg.toFixed(2)})`,
        );
      } else if (score > 0 && score < fAvg * 0.5) {
        logger.info(
          `[optimize] LOW franchise: ${franchise.slug}`,
          `(score ${score.toFixed(2)} vs avg ${fAvg.toFixed(2)})`,
        );
      }
    }
  } catch (err) {
    logger.error("[optimize] franchise analysis failed:", err);
  }

  // ─── Smart hook selection — confirm top hooks (Session D) ──────────────────
  // HookPerformance is maintained above; log the leading hook type per platform.
  try {
    for (const platform of ["tiktok", "instagram", "facebook"]) {
      const topHook = await prisma.hookPerformance.findFirst({
        where: { platform, sampleSize: { gte: 3 } },
        orderBy: { avgLeadScore: "desc" },
        select: { hookType: true, avgLeadScore: true },
      });
      if (topHook) {
        logger.info(
          `[optimize] top hook ${platform}: ${topHook.hookType}`,
          `(lead score: ${topHook.avgLeadScore?.toFixed(2)})`,
        );
      }
    }
  } catch (err) {
    logger.error("[optimize] hook analysis failed:", err);
  }

  // ─── Competitor intelligence scan (Session D) ──────────────────────────────
  try {
    const { scanCompetitorContent } = await import("@/lib/social/competitor-monitor");
    const insights = await scanCompetitorContent();
    logger.info(`[optimize] competitor insights: ${insights.length}`);
  } catch (err) {
    logger.error("[optimize] competitor scan failed:", err);
  }

  // ─── Weekly optimization report email (Session D) ──────────────────────────
  try {
    const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL;
    if (adminEmail) {
      const { sendOptimizationReport } = await import(
        "@/lib/services/email/resend.service"
      );

      const topFranchiseRecord = await prisma.contentFranchise
        .findFirst({
          where: { active: true },
          orderBy: { avgLeadScore: "desc" },
          select: { slug: true },
        })
        .catch(() => null);

      const topHookRecord = await prisma.hookPerformance
        .findFirst({
          orderBy: { avgLeadScore: "desc" },
          select: { hookType: true, platform: true },
        })
        .catch(() => null);

      const topMarketRecord = await prisma.winningPattern
        .findFirst({
          where: { geoTarget: { not: null }, sampleSize: { gte: 3 } },
          orderBy: { avgLeadScore: "desc" },
          select: { geoTarget: true, platform: true },
        })
        .catch(() => null);

      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const weekLeads = await prisma.socialLead
        .count({ where: { createdAt: { gte: weekAgo } } })
        .catch(() => 0);

      const weekRevenue = await prisma.revenueAttribution
        .aggregate({
          where: { attributionStatus: "DEAL_WON", dealWonAt: { gte: weekAgo } },
          _sum: { totalRevenueCents: true },
        })
        .catch(() => null);

      await sendOptimizationReport({
        to: adminEmail,
        weekOf: new Date().toLocaleDateString(),
        topFranchise: topFranchiseRecord?.slug ?? "N/A",
        topHook: topHookRecord
          ? `${topHookRecord.hookType} (${topHookRecord.platform})`
          : "N/A",
        topPlatform: topHookRecord?.platform ?? "N/A",
        topCity: topMarketRecord?.geoTarget ?? "N/A",
        totalLeads: weekLeads,
        totalRevenueCents: weekRevenue?._sum?.totalRevenueCents ?? 0,
        postingWindowChanges: Object.keys(platformHours).map(
          (p) => `${p}: updated to optimized hours`,
        ),
        franchiseShifts: [],
        nextWeekFocus: topFranchiseRecord?.slug
          ? `Focus on ${topFranchiseRecord.slug} — highest lead score`
          : "Continue current mix",
      }).catch((err) => logger.error("[optimize] report email failed:", err));
    }
  } catch (err) {
    logger.error("[optimize] report email block failed:", err);
  }

  const summary = {
    performanceRows: rows.length,
    winningPatterns: patterns.size,
    hookTypes: hooks.size,
    windowsUpdated,
    franchisesUpdated: franchiseScores.size,
    timestamp: new Date().toISOString(),
  };
  logger.info("[social-optimize]", JSON.stringify(summary));
  return NextResponse.json({ success: true, data: summary });
}
