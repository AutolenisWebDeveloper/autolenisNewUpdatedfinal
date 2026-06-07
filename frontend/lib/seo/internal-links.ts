// Phase C4 — Internal linking engine for the content engine.
//
// Pillar links (lib/seo/pillar-links.ts) point articles UP to the six
// cornerstone guides. This module builds the LATERAL graph: programmatic
// article → related programmatic articles. A dense, relevant internal link
// graph spreads crawl equity, keeps readers on-site, and signals topical
// clustering to search + answer engines.
//
// The ranking is a pure function so it can be unit-tested and so the DB layer
// stays a thin candidate-fetch. We over-fetch a candidate pool (sharing city,
// vehicle, or cluster) and rank it here into a small, varied set of links.

export interface RelatedArticleCandidate {
  slug: string;
  title: string;
  h1: string;
  cluster: string;
  make: string | null;
  model: string | null;
  city: string;
  state: string;
  metro: string | null;
}

export interface RelatedArticleLink extends RelatedArticleCandidate {
  /** Why it was surfaced — drives the small relationship label in the UI. */
  reason: "same_vehicle_other_city" | "same_city_other_topic" | "same_topic_nearby" | "related";
  score: number;
}

export const RELATED_LINK_LIMIT = 6;

function sameVehicle(a: RelatedArticleCandidate, b: RelatedArticleCandidate): boolean {
  return Boolean(a.make && a.model && a.make === b.make && a.model === b.model);
}

function sameLocale(a: RelatedArticleCandidate, b: RelatedArticleCandidate): boolean {
  return a.city === b.city && a.state === b.state;
}

/**
 * Score a candidate's relevance to the current article. Higher = more relevant.
 * The weights favour the two link types readers find most useful: comparing the
 * same vehicle across cities, and exploring other money topics in their own city.
 */
function scoreCandidate(
  current: RelatedArticleCandidate,
  cand: RelatedArticleCandidate,
): { score: number; reason: RelatedArticleLink["reason"] } {
  let score = 0;
  let reason: RelatedArticleLink["reason"] = "related";

  const vehicleMatch = sameVehicle(current, cand);
  const localeMatch = sameLocale(current, cand);

  if (vehicleMatch && localeMatch) {
    // Same car, same city, different angle (e.g. quotes ↔ OTD price).
    score += 6;
    reason = "same_city_other_topic";
  } else if (vehicleMatch) {
    // Same car in another market — strong comparison intent.
    score += 5;
    reason = "same_vehicle_other_city";
  } else if (localeMatch && cand.cluster !== current.cluster) {
    // Same city, adjacent money topic — natural next read.
    score += 4;
    reason = "same_city_other_topic";
  } else if (localeMatch) {
    score += 3;
    reason = "same_city_other_topic";
  }

  if (cand.cluster === current.cluster) {
    score += 1;
    if (cand.metro && cand.metro === current.metro && !localeMatch) {
      // Same topic in a neighbouring city of the same metro.
      score += 1;
      if (reason === "related") reason = "same_topic_nearby";
    }
  }

  return { score, reason };
}

/**
 * Rank a candidate pool into the final set of related links. Pure + deterministic.
 *
 * Variety guard: caps how many links share the current article's cluster so the
 * block doesn't become six near-identical rows, while still allowing same-topic
 * cross-city links when there's nothing more relevant to show.
 */
export function rankRelatedArticles(
  current: RelatedArticleCandidate,
  candidates: RelatedArticleCandidate[],
  limit: number = RELATED_LINK_LIMIT,
): RelatedArticleLink[] {
  const scored = candidates
    .filter((c) => c.slug !== current.slug)
    .map((c) => ({ ...c, ...scoreCandidate(current, c) }))
    .filter((c) => c.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        // Stable, deterministic tiebreak so output never depends on DB order.
        a.slug.localeCompare(b.slug),
    );

  const sameClusterCap = Math.ceil(limit / 2);
  const out: RelatedArticleLink[] = [];
  let sameClusterCount = 0;

  for (const c of scored) {
    if (out.length >= limit) break;
    const isSameCluster = c.cluster === current.cluster;
    if (isSameCluster && sameClusterCount >= sameClusterCap) continue;
    out.push(c);
    if (isSameCluster) sameClusterCount += 1;
  }

  // If the variety cap left us short (sparse pool), backfill with whatever
  // scored candidates remain rather than showing an empty block.
  if (out.length < limit) {
    for (const c of scored) {
      if (out.length >= limit) break;
      if (!out.includes(c)) out.push(c);
    }
  }

  return out;
}

/** Human label for a relationship reason, used in the related-links UI. */
export function relationLabel(reason: RelatedArticleLink["reason"]): string {
  switch (reason) {
    case "same_vehicle_other_city":
      return "Same vehicle, another city";
    case "same_city_other_topic":
      return "More for your city";
    case "same_topic_nearby":
      return "Nearby city";
    default:
      return "Related guide";
  }
}
