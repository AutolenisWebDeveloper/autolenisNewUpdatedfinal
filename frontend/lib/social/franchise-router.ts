// AutoLenis Social Engine — Content Franchise Router.
//
// Maps a TopicSignal to the franchises that should produce content from it,
// along with the target platforms and the derivative asset types per platform.
// Franchise records are loaded from the DB by slug so the router always
// reflects live franchise config (platforms, active flag, review requirement).

import { prisma } from "@/lib/prisma";
import type { ContentFranchise, TopicSignal } from "@prisma/client";
import { AUTOMATION_MODE, AUTO_PUBLISH_FRANCHISES } from "@/lib/social/config";

export interface FranchiseRoute {
  franchise: ContentFranchise;
  platforms: string[];
  assetTypes: string[];
}

// signalType → { franchise slugs, asset types }. Platforms are derived from
// each franchise's own `platforms` array unless overridden.
const ROUTING: Record<string, { slugs: string[]; assetTypes: string[] }> = {
  buyer_leverage: {
    slugs: ["city_market_alert", "vehicle_price_watch"],
    assetTypes: ["tiktok_video", "instagram_reel", "facebook_reel", "linkedin_post"],
  },
  price_drop: {
    slugs: ["vehicle_price_watch", "city_market_alert"],
    assetTypes: ["tiktok_video", "instagram_carousel", "facebook_reel"],
  },
  high_ctr_article: {
    slugs: ["dealer_secret_daily", "how_autolenis_works"],
    assetTypes: ["tiktok_video", "instagram_reel", "youtube_short"],
  },
  dealer_competition_change: {
    slugs: ["city_market_alert", "autolenis_market_index"],
    assetTypes: ["linkedin_post", "facebook_reel", "instagram_reel"],
  },
};

const DEFAULT_ROUTE = {
  slugs: ["how_autolenis_works"],
  assetTypes: ["tiktok_video", "instagram_reel", "facebook_reel"],
  platforms: ["tiktok", "instagram", "facebook"],
};

// Resolves a signal to concrete franchise routes. Inactive or missing
// franchises are skipped silently.
export async function routeSignalToFranchises(
  signal: TopicSignal,
): Promise<FranchiseRoute[]> {
  const mapping = ROUTING[signal.signalType];
  const slugs = mapping?.slugs ?? DEFAULT_ROUTE.slugs;
  const assetTypes = mapping?.assetTypes ?? DEFAULT_ROUTE.assetTypes;

  const franchises = await prisma.contentFranchise.findMany({
    where: { slug: { in: slugs }, active: true },
  });

  // Preserve the routing order from the mapping.
  const bySlug = new Map(franchises.map((f) => [f.slug, f]));

  const routes: FranchiseRoute[] = [];
  for (const slug of slugs) {
    const franchise = bySlug.get(slug);
    if (!franchise) continue;
    const platforms =
      franchise.platforms.length > 0 ? franchise.platforms : DEFAULT_ROUTE.platforms;
    routes.push({ franchise, platforms, assetTypes });
  }
  return routes;
}

// Whether a franchise's content must be held for manual review before publish.
// True when: MANUAL_REVIEW mode (everything is reviewed), the franchise is not
// in the auto-publish allowlist, or HYBRID_AUTO + franchise.requiresReview.
export function requiresReview(franchise: ContentFranchise): boolean {
  if (AUTOMATION_MODE === "MANUAL_REVIEW") return true;
  if (AUTOMATION_MODE === "FULL_AUTO") {
    return !AUTO_PUBLISH_FRANCHISES.includes(franchise.slug) && franchise.requiresReview;
  }
  // HYBRID_AUTO
  if (!AUTO_PUBLISH_FRANCHISES.includes(franchise.slug)) return true;
  return franchise.requiresReview;
}
