// AutoLenis Social Engine — Daily Signal Generator.
//
// Produces the exact set of signals needed for today's posting plan: 25 posts,
// 5 per platform, in a 70/20/10 evergreen/trend/breaking mix. Each platform gets
// 4 evergreen posts (lead franchise rotated to the front by day-of-week), 1
// trend post sourced from live market/vehicle intelligence, plus optional
// breaking posts drawn from the topic_signals table. The social-generate cron
// turns each DailySignal into a real TopicSignal + SocialPost via the
// orchestrator. This replaces relying solely on the topic_signals backlog.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  DAILY_POST_TARGETS,
  CONTENT_MIX,
  PLATFORM_POST_TIMES,
  WEEKLY_PRIMARY_FRANCHISE,
} from "@/lib/social/config";

export interface DailySignal {
  id: string;
  signalType: string;
  franchiseSlug: string;
  platform: string;
  make?: string | null;
  model?: string | null;
  metro?: string | null;
  leverageScore?: number | null;
  msrpCents?: number | null;
  fairMarketLowCents?: number | null;
  hookType: string;
  contentCategory: "evergreen" | "trend" | "breaking";
  scheduledHour: number;
  // Marks an Instagram post as a reformatted repurpose of the day's top TikTok.
  isRepurpose?: boolean;
}

// Evergreen hook rotation — spreads hook mechanics across each platform's 4
// evergreen posts so the day's content isn't monotonous.
const HOOK_TYPES = ["fear", "curiosity", "savings", "comparison", "social_proof"];

export async function generateDailySignals(): Promise<DailySignal[]> {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const primaryFranchises = WEEKLY_PRIMARY_FRANCHISE[dayOfWeek] ?? [];
  const signals: DailySignal[] = [];

  // Fetch real data from the AMIPS intelligence tables + breaking topic signals.
  // Each query self-recovers to an empty list so one failure can't abort the
  // whole daily plan.
  const [markets, vehicles, topicSignals] = await Promise.all([
    prisma.marketIntelligence
      .findMany({
        orderBy: { buyerLeverageScore: "desc" },
        take: 10,
        select: { metroName: true, buyerLeverageScore: true, state: true },
      })
      .catch(() => []),

    prisma.vehicleIntelligence
      .findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          make: true,
          model: true,
          msrpCents: true,
          fairMarketLowCents: true,
        },
      })
      .catch(() => []),

    prisma.topicSignal
      .findMany({
        where: {
          assetsGenerated: false,
          expiresAt: { gte: today },
          signalType: {
            in: ["trending_topic", "trending_search", "competitor_gap"],
          },
        },
        orderBy: { detectedAt: "desc" },
        take: 5,
      })
      .catch(() => []),
  ]);

  const platforms = DAILY_POST_TARGETS.platforms;

  for (const platform of platforms) {
    const times = PLATFORM_POST_TIMES[platform] ?? [7, 12, 15, 18, 21];

    // ─── 4 evergreen posts per platform ───────────────────────────────────────
    // Put today's primary franchise(s) first, then the rest of the evergreen set.
    const evergreens = [...CONTENT_MIX.evergreen.franchises];
    const sorted = [
      ...evergreens.filter((f) => primaryFranchises.includes(f)),
      ...evergreens.filter((f) => !primaryFranchises.includes(f)),
    ];

    for (let i = 0; i < CONTENT_MIX.evergreen.postsPerPlatform; i++) {
      const franchiseSlug = sorted[i % sorted.length];
      const hookType = HOOK_TYPES[i % HOOK_TYPES.length];

      signals.push({
        id: `evergreen-${platform}-${i}-${Date.now()}`,
        signalType: "evergreen",
        franchiseSlug,
        platform,
        hookType,
        contentCategory: "evergreen",
        scheduledHour: times[i],
      });
    }

    // ─── 1 trend post per platform ────────────────────────────────────────────
    // Driven by today's primary franchise when it is a trend franchise; otherwise
    // defaults to a city_market_alert on the strongest buyer-leverage metro.
    if (
      primaryFranchises.includes("city_market_alert") ||
      primaryFranchises.includes("vehicle_price_watch")
    ) {
      const isMarket = primaryFranchises.includes("city_market_alert");
      const market =
        markets[
          signals.filter((s) => s.franchiseSlug === "city_market_alert").length %
            Math.max(markets.length, 1)
        ];
      const vehicle =
        vehicles[
          signals.filter((s) => s.franchiseSlug === "vehicle_price_watch")
            .length % Math.max(vehicles.length, 1)
        ];

      signals.push({
        id: `trend-${platform}-${Date.now()}`,
        signalType: isMarket ? "buyer_leverage" : "price_drop",
        franchiseSlug: isMarket ? "city_market_alert" : "vehicle_price_watch",
        platform,
        metro: market?.metroName ?? null,
        leverageScore: market?.buyerLeverageScore ?? null,
        make: vehicle?.make ?? null,
        model: vehicle?.model ?? null,
        msrpCents: vehicle?.msrpCents ?? null,
        fairMarketLowCents: vehicle?.fairMarketLowCents ?? null,
        hookType: "savings",
        contentCategory: "trend",
        scheduledHour: times[4],
      });
    } else {
      const market = markets[0];
      signals.push({
        id: `trend-${platform}-${Date.now()}`,
        signalType: "buyer_leverage",
        franchiseSlug: "city_market_alert",
        platform,
        metro: market?.metroName ?? "Dallas-Fort Worth",
        leverageScore: market?.buyerLeverageScore ?? 6.1,
        hookType: "savings",
        contentCategory: "trend",
        scheduledHour: times[4],
      });
    }
  }

  // ─── Breaking/viral posts (bonus — drawn from topic_signals) ────────────────
  // Each breaking signal is distributed across platforms round-robin and posted
  // at 2PM, the breaking-news slot.
  for (const signal of topicSignals.slice(0, 3)) {
    const platform =
      platforms[
        signals.filter((s) => s.contentCategory === "breaking").length %
          platforms.length
      ];

    signals.push({
      id: signal.id,
      signalType: signal.signalType,
      franchiseSlug: "dealer_secret_daily", // default franchise for breaking
      platform,
      hookType: "controversy",
      contentCategory: "breaking",
      scheduledHour: 14, // 2PM for breaking news
    });
  }

  // ─── Instagram repurposing ──────────────────────────────────────────────────
  // Reuse the day's top TikTok concept as Instagram post #1, reformatted for IG.
  // Saves a generation pass and reinforces the same hook across feeds.
  const tiktokSignals = signals.filter((s) => s.platform === "tiktok");
  const instagramSignals = signals.filter((s) => s.platform === "instagram");

  if (tiktokSignals[0] && instagramSignals[0]) {
    instagramSignals[0].signalType = tiktokSignals[0].signalType;
    instagramSignals[0].franchiseSlug = tiktokSignals[0].franchiseSlug;
    instagramSignals[0].hookType = tiktokSignals[0].hookType;
    instagramSignals[0].make = tiktokSignals[0].make;
    instagramSignals[0].metro = tiktokSignals[0].metro;
    instagramSignals[0].isRepurpose = true;
  }

  logger.info(
    `[daily-signal] generated ${signals.length} signals for ${today.toDateString()}`,
    `(${signals.filter((s) => s.contentCategory === "evergreen").length} evergreen,`,
    `${signals.filter((s) => s.contentCategory === "trend").length} trend,`,
    `${signals.filter((s) => s.contentCategory === "breaking").length} breaking)`,
  );

  return signals;
}
