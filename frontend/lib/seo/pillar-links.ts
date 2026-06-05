// Phase C0 — Internal linking architecture for the AutoLenis content engine.
// The six cornerstone pillar pages anchor topical authority. Programmatic
// articles (Phase C2) link back to the relevant pillars for their cluster via
// CLUSTER_PILLAR_MAP. National scope — no city-specific framing.

export interface PillarPage {
  slug: string;
  title: string;
  cluster: string;
  url: string;
}

export const PILLAR_PAGES: PillarPage[] = [
  {
    slug: "how-to-get-best-car-price",
    title: "How to Get the Best Price on Any Car",
    cluster: "price_research",
    url: "/buying-guide/how-to-get-best-car-price",
  },
  {
    slug: "how-to-negotiate-car-price",
    title: "How to Negotiate Car Price With Dealers",
    cluster: "negotiation",
    url: "/buying-guide/how-to-negotiate-car-price",
  },
  {
    slug: "dealer-fees-complete-guide",
    title: "Every Dealer Fee Explained",
    cluster: "dealer_fees",
    url: "/buying-guide/dealer-fees-complete-guide",
  },
  {
    slug: "lease-vs-buy-car",
    title: "Lease vs Buy: The Complete Decision Framework",
    cluster: "leasing",
    url: "/buying-guide/lease-vs-buy-car",
  },
  {
    slug: "car-trade-in-value-guide",
    title: "How to Get the Best Trade-In Value",
    cluster: "trade_in",
    url: "/buying-guide/car-trade-in-value-guide",
  },
  {
    slug: "car-buying-concierge-service",
    title: "What Is a Car Buying Concierge?",
    cluster: "concierge",
    url: "/buying-guide/car-buying-concierge-service",
  },
];

// Cluster → which pillar pages to link to from programmatic articles.
export const CLUSTER_PILLAR_MAP: Record<string, string[]> = {
  dealer_quotes: ["how-to-get-best-car-price", "how-to-negotiate-car-price"],
  otd_price: ["how-to-get-best-car-price", "dealer-fees-complete-guide"],
  dealer_fees: ["dealer-fees-complete-guide", "how-to-negotiate-car-price"],
  trade_in: ["car-trade-in-value-guide", "how-to-get-best-car-price"],
  leasing: ["lease-vs-buy-car", "how-to-get-best-car-price"],
};

const PILLARS_BY_SLUG: Record<string, PillarPage> = Object.fromEntries(
  PILLAR_PAGES.map((p) => [p.slug, p]),
);

/** Return the pillar pages that programmatic articles in `cluster` link to. */
export function getPillarLinksForCluster(cluster: string): PillarPage[] {
  const slugs = CLUSTER_PILLAR_MAP[cluster] ?? [];
  return slugs
    .map((slug) => PILLARS_BY_SLUG[slug])
    .filter((p): p is PillarPage => Boolean(p));
}

/** Return the other pillar pages (everything except `currentSlug`). */
export function getRelatedPillars(currentSlug: string): PillarPage[] {
  return PILLAR_PAGES.filter((p) => p.slug !== currentSlug);
}

/** Look up a single pillar page by slug. */
export function getPillarBySlug(slug: string): PillarPage | undefined {
  return PILLARS_BY_SLUG[slug];
}
