// AutoLenis Social Intelligence & Media Engine — central config.
//
// Single source of truth for automation mode, feature flags, per-platform
// limits, franchise→funnel mapping, and UTM URL construction. Everything that
// gates automated behavior reads from here so a single env change flips the
// whole pipeline between manual, hybrid, and full-auto operation.

export type AutomationMode = "MANUAL_REVIEW" | "HYBRID_AUTO" | "FULL_AUTO";

function readMode(): AutomationMode {
  const raw = (process.env.SOCIAL_AUTOMATION_MODE ?? "HYBRID_AUTO").toUpperCase();
  if (raw === "MANUAL_REVIEW" || raw === "FULL_AUTO") return raw;
  return "HYBRID_AUTO";
}

const isTrue = (v: string | undefined) => v === "true";

export const AUTOMATION_MODE: AutomationMode = readMode();
export const ENABLE_VIDEO: boolean = isTrue(process.env.ENABLE_HIGGSFIELD_VIDEO);
export const ENABLE_PUBLISHING: boolean = isTrue(process.env.ENABLE_BUFFER_PUBLISHING);
export const ENABLE_AUTO_PUBLISH: boolean = isTrue(process.env.ENABLE_AUTO_PUBLISH);
export const ENABLE_CREATOR_DISTRIBUTION: boolean = isTrue(
  process.env.ENABLE_CREATOR_DISTRIBUTION,
);

// Franchises that may publish without manual review in HYBRID_AUTO mode.
export const AUTO_PUBLISH_FRANCHISES: string[] = [
  "dealer_secret_daily",
  "city_market_alert",
  "dealer_fee_breakdown",
  "how_autolenis_works",
];

// Franchises that always require human review before publishing (claims-heavy
// or social-proof content where compliance risk is higher).
export const REVIEW_REQUIRED_FRANCHISES: string[] = [
  "buyer_win_story",
  "vehicle_price_watch",
  "autolenis_market_index",
  "financing_friday",
  "trade_in_tuesday",
];

export interface PlatformConfig {
  maxCaptionChars: number;
  maxHashtags: number;
  linkInCaption: boolean;
  optimalDurationSecs: number;
}

export const PLATFORM_LIMITS: Record<string, PlatformConfig> = {
  facebook: { maxCaptionChars: 63206, maxHashtags: 30, linkInCaption: true, optimalDurationSecs: 45 },
  instagram: { maxCaptionChars: 2200, maxHashtags: 30, linkInCaption: false, optimalDurationSecs: 25 },
  tiktok: { maxCaptionChars: 2200, maxHashtags: 100, linkInCaption: true, optimalDurationSecs: 30 },
  youtube: { maxCaptionChars: 5000, maxHashtags: 15, linkInCaption: true, optimalDurationSecs: 45 },
  linkedin: { maxCaptionChars: 3000, maxHashtags: 5, linkInCaption: true, optimalDurationSecs: 45 },
};

export function getPlatformConfig(platform: string): PlatformConfig {
  return PLATFORM_LIMITS[platform.toLowerCase()] ?? PLATFORM_LIMITS.facebook;
}

// Maps a franchise slug to the AutoLenis page its content should drive toward.
// Social franchises now point at the dedicated /lp/[campaign] social landing
// pages (each slug renders a tailored headline/copy/CTA). buildUtmUrl() builds
// tracked links on top of whatever path getFunnelDestination() returns, so the
// whole social funnel picks up these destinations automatically.
export const FUNNEL_DESTINATIONS: Record<string, string> = {
  dealer_secret_daily: "/lp/dealer-secret",
  city_market_alert: "/lp/market-alert",
  vehicle_price_watch: "/lp/price-watch",
  trade_in_tuesday: "/lp/free-offers",
  financing_friday: "/lp/free-offers",
  dealer_fee_breakdown: "/lp/dealer-fees",
  autolenis_market_index: "/request-a-car",
  buyer_win_story: "/lp/free-offers",
  how_autolenis_works: "/lp/how-it-works",
  auction_countdown: "/buyer/auction",
  offer_received: "/buyer/auction",
  dealer_growth: "/for-dealers",
  market_stats_dealer: "/for-dealers",
};

export function getFunnelDestination(franchiseSlug: string): string {
  return FUNNEL_DESTINATIONS[franchiseSlug] ?? "/request-a-car";
}

const SITE_BASE = "https://www.autolenis.com";

function slug(value: string | undefined | null): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface UtmParams {
  path: string;
  platform: string;
  franchise: string;
  hookType: string;
  contentType: string;
  city?: string;
  make?: string;
  model?: string;
  creatorId?: string;
  affiliateId?: string;
}

// Builds a fully UTM-tagged AutoLenis URL. utm_campaign encodes
// make_city_month so revenue can be grouped by vehicle + geo + cohort.
export function buildUtmUrl(params: UtmParams): string {
  const month = new Date()
    .toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "America/Chicago" })
    .toLowerCase()
    .replace(/\s+/g, "-");

  const campaignParts = [slug(params.make) || "general", slug(params.city) || "national", month].filter(Boolean);

  const url = new URL(params.path, SITE_BASE);
  const search = url.searchParams;
  search.set("utm_source", params.platform);
  search.set("utm_medium", "social");
  search.set("utm_campaign", campaignParts.join("_"));
  search.set("utm_content", params.franchise);
  search.set("utm_term", params.contentType);
  search.set("utm_hook", params.hookType);
  search.set("utm_platform", params.platform);
  if (params.model) search.set("utm_model", slug(params.model));
  if (params.creatorId) search.set("utm_creator", params.creatorId);
  if (params.affiliateId) search.set("utm_affiliate", params.affiliateId);

  return url.toString();
}

// ─── Platform performance benchmarks ─────────────────────────────────────────
// Industry baselines used to classify a post as viral / underperforming and to
// estimate expected reach. avgCTR / avgCompletionRate are the platform medians;
// viralMultiplier / underperformMultiplier bound performance against baseline;
// baselineViewsPerHour seeds reach estimates before real analytics land.
export const PLATFORM_BENCHMARKS: Record<
  string,
  {
    avgCTR: number;
    avgCompletionRate: number;
    viralMultiplier: number;
    underperformMultiplier: number;
    baselineViewsPerHour: number;
  }
> = {
  tiktok: {
    avgCTR: 0.038,
    avgCompletionRate: 0.45,
    viralMultiplier: 3.0,
    underperformMultiplier: 0.3,
    baselineViewsPerHour: 100,
  },
  instagram: {
    avgCTR: 0.019,
    avgCompletionRate: 0.38,
    viralMultiplier: 3.0,
    underperformMultiplier: 0.3,
    baselineViewsPerHour: 50,
  },
  facebook: {
    avgCTR: 0.009,
    avgCompletionRate: 0.25,
    viralMultiplier: 3.0,
    underperformMultiplier: 0.3,
    baselineViewsPerHour: 30,
  },
  youtube: {
    avgCTR: 0.042,
    avgCompletionRate: 0.55,
    viralMultiplier: 3.0,
    underperformMultiplier: 0.3,
    baselineViewsPerHour: 20,
  },
  linkedin: {
    avgCTR: 0.008,
    avgCompletionRate: 0.35,
    viralMultiplier: 3.0,
    underperformMultiplier: 0.3,
    baselineViewsPerHour: 10,
  },
};

// ─── Content calendar ────────────────────────────────────────────────────────
// Day-of-week volume multipliers (Friday is the highest-intent buying day),
// the franchises to prioritize per day, and high-intensity sales periods that
// scale generation volume around major automotive buying events.
export const CONTENT_CALENDAR = {
  volumeMultiplier: {
    0: 0.5, // Sunday
    1: 1.2, // Monday
    2: 1.0, // Tuesday
    3: 1.3, // Wednesday
    4: 1.2, // Thursday
    5: 1.5, // Friday — highest intent day
    6: 1.1, // Saturday
  } as Record<number, number>,

  franchiseByDay: {
    1: ["city_market_alert", "autolenis_market_index"],
    2: ["trade_in_tuesday"],
    3: ["dealer_secret_daily", "dealer_fee_breakdown"],
    4: ["financing_friday", "how_autolenis_works"],
    5: ["vehicle_price_watch", "dealer_fee_breakdown"],
    6: ["buyer_win_story", "how_autolenis_works"],
    0: ["autolenis_market_index", "buyer_win_story"],
  } as Record<number, string[]>,

  highIntensityPeriods: [
    { name: "Labor Day", monthDay: "09-01", weeksAhead: 2, multiplier: 5 },
    { name: "Memorial Day", monthDay: "05-25", weeksAhead: 2, multiplier: 4 },
    { name: "Tax Season", monthDay: "03-01", weeksAhead: 1, multiplier: 3 },
    { name: "Black Friday", monthDay: "11-25", weeksAhead: 2, multiplier: 4 },
    { name: "New Year", monthDay: "01-01", weeksAhead: 0, multiplier: 3 },
  ],
};

// Returns the active high-intensity sales period for `date` (within its lead
// window) or null. The window opens `weeksAhead` weeks before the event date and
// closes on the event date itself.
export function checkHighIntensityPeriod(
  date: Date,
): { name: string; multiplier: number } | null {
  for (const period of CONTENT_CALENDAR.highIntensityPeriods) {
    const [pMonth, pDay] = period.monthDay.split("-").map(Number);
    const periodDate = new Date(date.getFullYear(), pMonth - 1, pDay);
    const daysAhead = period.weeksAhead * 7;
    const windowStart = new Date(
      periodDate.getTime() - daysAhead * 24 * 60 * 60 * 1000,
    );
    const windowEnd = periodDate;
    if (date >= windowStart && date <= windowEnd) {
      return { name: period.name, multiplier: period.multiplier };
    }
  }
  return null;
}
