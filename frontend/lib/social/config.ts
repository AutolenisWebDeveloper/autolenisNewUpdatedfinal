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
// Trade-in has no dedicated tool yet, so it points at /request-a-car.
export const FUNNEL_DESTINATIONS: Record<string, string> = {
  dealer_secret_daily: "/tools/dealer-fee-calculator",
  city_market_alert: "/request-a-car",
  vehicle_price_watch: "/request-a-car",
  trade_in_tuesday: "/request-a-car",
  financing_friday: "/request-a-car",
  dealer_fee_breakdown: "/tools/dealer-fee-calculator",
  autolenis_market_index: "/buying-guide",
  buyer_win_story: "/request-a-car",
  how_autolenis_works: "/request-a-car",
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
