// Phase C1 — National keyword database for the AutoLenis content engine.
//
// AutoLenis' dealer-discovery system finds 5-8 local dealers near any US zip
// code, so the content engine targets the entire country. This file is the
// Wave 1 keyword map: the top 25 US metros by car sales, across five content
// clusters. Phase C2 reads these rows to generate the actual articles, and the
// /buying-guide/[slug] route serves whatever has been generated + published.
//
// Everything here is generated from a small set of source tables (metros +
// models + cluster templates) so the map stays consistent and easy to extend
// to Waves 2 and 3. Slugs are unique by construction (every slug carries the
// city + state), which matches the @unique slug column on ContentArticle.
//
// Compliance: titles/descriptions reference factual mechanics only — never a
// specific dollar savings amount, guarantee, or testimonial.

import { CLUSTER_PILLAR_MAP } from "@/lib/seo/pillar-links";

export type ContentCluster =
  | "dealer_quotes"
  | "otd_price"
  | "dealer_fees"
  | "trade_in"
  | "leasing";

export interface ContentKeyword {
  slug: string;
  cluster: ContentCluster;
  make?: string;
  model?: string;
  city: string;
  state: string;
  metro: string;
  wave: 1 | 2 | 3;
  targetKeyword: string;
  title: string;
  metaDescription: string;
  h1: string;
  searchIntent: "transactional" | "commercial" | "informational";
  priority: 1 | 2 | 3;
  pillarSlugs: string[]; // from pillar-links.ts CLUSTER_PILLAR_MAP
  toolUrl: string; // always the state-aware dealer fee calculator
}

const TOOL_URL = "/tools/dealer-fee-calculator";

// ── Source table: Wave 1 metros (top 25 US metros by car sales) ─────────────
interface MetroSeed {
  city: string;
  state: string; // USPS abbreviation, matches ContentArticle.state
  stateName: string; // natural-language for state-only keywords
  metro: string; // grouping label
}

const WAVE_1_METROS: MetroSeed[] = [
  { city: "Dallas", state: "TX", stateName: "Texas", metro: "Dallas-Fort Worth" },
  { city: "Houston", state: "TX", stateName: "Texas", metro: "Houston" },
  { city: "Los Angeles", state: "CA", stateName: "California", metro: "Los Angeles" },
  { city: "Chicago", state: "IL", stateName: "Illinois", metro: "Chicago" },
  { city: "Miami", state: "FL", stateName: "Florida", metro: "Miami" },
  { city: "Atlanta", state: "GA", stateName: "Georgia", metro: "Atlanta" },
  { city: "Washington", state: "DC", stateName: "Washington DC", metro: "Washington DC" },
  { city: "Phoenix", state: "AZ", stateName: "Arizona", metro: "Phoenix" },
  { city: "Philadelphia", state: "PA", stateName: "Pennsylvania", metro: "Philadelphia" },
  { city: "Detroit", state: "MI", stateName: "Michigan", metro: "Detroit" },
  { city: "Boston", state: "MA", stateName: "Massachusetts", metro: "Boston" },
  { city: "San Antonio", state: "TX", stateName: "Texas", metro: "San Antonio" },
  { city: "Austin", state: "TX", stateName: "Texas", metro: "Austin" },
  { city: "Seattle", state: "WA", stateName: "Washington", metro: "Seattle" },
  { city: "Denver", state: "CO", stateName: "Colorado", metro: "Denver" },
  { city: "Minneapolis", state: "MN", stateName: "Minnesota", metro: "Minneapolis" },
  { city: "Tampa", state: "FL", stateName: "Florida", metro: "Tampa" },
  { city: "Charlotte", state: "NC", stateName: "North Carolina", metro: "Charlotte" },
  { city: "San Diego", state: "CA", stateName: "California", metro: "San Diego" },
  { city: "Portland", state: "OR", stateName: "Oregon", metro: "Portland" },
  { city: "Las Vegas", state: "NV", stateName: "Nevada", metro: "Las Vegas" },
  { city: "Nashville", state: "TN", stateName: "Tennessee", metro: "Nashville" },
  { city: "Baltimore", state: "MD", stateName: "Maryland", metro: "Baltimore" },
  { city: "Sacramento", state: "CA", stateName: "California", metro: "Sacramento" },
  { city: "New York", state: "NY", stateName: "New York", metro: "New York" },
];

// ── Source table: highest-volume makes/models nationally ────────────────────
interface ModelSeed {
  make: string;
  model: string;
}

const TARGET_MODELS: ModelSeed[] = [
  { make: "Ford", model: "F-150" },
  { make: "Chevrolet", model: "Silverado" },
  { make: "Toyota", model: "RAV4" },
  { make: "Honda", model: "CR-V" },
  { make: "Toyota", model: "Highlander" },
  { make: "Toyota", model: "Camry" },
  { make: "Honda", model: "Accord" },
  { make: "Ford", model: "Explorer" },
  { make: "Chevrolet", model: "Equinox" },
  { make: "Toyota", model: "Tacoma" },
];

// Top models used for the model-specific leasing keywords (per metro).
const TOP_LEASE_MODELS = TARGET_MODELS.slice(0, 2);

// ── Slug helpers ────────────────────────────────────────────────────────────
// City/state slugs preserve hyphenated words; model slugs strip punctuation to
// match the canonical examples ("rav4", "crv") in the Phase C1 spec.
function citySlug(city: string): string {
  return city.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
function stateSlug(state: string): string {
  return state.toLowerCase();
}
function tokenSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function geoSlug(m: MetroSeed): string {
  return `${citySlug(m.city)}-${stateSlug(m.state)}`;
}

// ── Per-cluster keyword builders ────────────────────────────────────────────
function dealerQuoteKeyword(m: MetroSeed, model: ModelSeed): ContentKeyword {
  const name = `${model.make} ${model.model}`;
  return {
    slug: `${tokenSlug(model.make)}-${tokenSlug(model.model)}-dealer-quotes-${geoSlug(m)}`,
    cluster: "dealer_quotes",
    make: model.make,
    model: model.model,
    city: m.city,
    state: m.state,
    metro: m.metro,
    wave: 1,
    targetKeyword: `${name} dealer quotes ${m.city} ${m.state}`,
    title: `${name} Dealer Quotes in ${m.city}, ${m.state} — Compare Real Offers`,
    metaDescription: `Get competing ${name} quotes from ${m.city}-area dealers. See how local ${m.stateName} dealers price the ${model.model} and make them compete for your business.`,
    h1: `${name} Dealer Quotes in ${m.city}, ${m.state}`,
    searchIntent: "transactional",
    priority: 1,
    pillarSlugs: CLUSTER_PILLAR_MAP.dealer_quotes ?? [],
    toolUrl: TOOL_URL,
  };
}

function otdPriceKeyword(m: MetroSeed, model: ModelSeed): ContentKeyword {
  const name = `${model.make} ${model.model}`;
  return {
    slug: `${tokenSlug(model.make)}-${tokenSlug(model.model)}-otd-price-${geoSlug(m)}`,
    cluster: "otd_price",
    make: model.make,
    model: model.model,
    city: m.city,
    state: m.state,
    metro: m.metro,
    wave: 1,
    targetKeyword: `${name} OTD price ${m.city} ${m.state}`,
    title: `${name} Out-the-Door Price in ${m.city}, ${m.state}`,
    metaDescription: `What's a fair out-the-door price on a ${name} in ${m.city}, ${m.state}? Break down MSRP, fees, and taxes so you know the real number before you sign.`,
    h1: `${name} Out-the-Door (OTD) Price in ${m.city}, ${m.state}`,
    searchIntent: "transactional",
    priority: 1,
    pillarSlugs: CLUSTER_PILLAR_MAP.otd_price ?? [],
    toolUrl: TOOL_URL,
  };
}

// Template for the five fixed (non-model) variations in a cluster.
interface VariationTemplate {
  slugPart: string;
  cluster: ContentCluster;
  searchIntent: ContentKeyword["searchIntent"];
  keyword: (m: MetroSeed) => string;
  title: (m: MetroSeed) => string;
  h1: (m: MetroSeed) => string;
  metaDescription: (m: MetroSeed) => string;
}

const DEALER_FEE_VARIATIONS: VariationTemplate[] = [
  {
    slugPart: "dealer-fees",
    cluster: "dealer_fees",
    searchIntent: "commercial",
    keyword: (m) => `dealer fees ${m.city} ${m.state}`,
    title: (m) => `Dealer Fees in ${m.city}, ${m.state} — What's Real and What's Junk`,
    h1: (m) => `Dealer Fees in ${m.city}, ${m.state}`,
    metaDescription: (m) =>
      `A plain-English breakdown of every dealer fee you'll see in ${m.city}, ${m.state} — which are required, which are negotiable, and which to reject.`,
  },
  {
    slugPart: "dealer-doc-fee",
    cluster: "dealer_fees",
    searchIntent: "commercial",
    keyword: (m) => `dealer doc fee ${m.city} ${m.state}`,
    title: (m) => `Dealer Doc Fee in ${m.city}, ${m.state} — How Much Is Normal?`,
    h1: (m) => `Dealer Doc Fee in ${m.city}, ${m.state}`,
    metaDescription: (m) =>
      `How much should a documentation fee cost in ${m.stateName}? See ${m.city} norms, whether your state caps the fee by law, and how to push back.`,
  },
  {
    slugPart: "negotiable-dealer-fees",
    cluster: "dealer_fees",
    searchIntent: "commercial",
    keyword: (m) => `what dealer fees are negotiable ${m.city}`,
    title: (m) => `Which Dealer Fees Are Negotiable in ${m.city}, ${m.state}?`,
    h1: (m) => `Which Dealer Fees Are Negotiable in ${m.city}, ${m.state}?`,
    metaDescription: (m) =>
      `Not every fee is set in stone. See which dealer fees ${m.city}, ${m.state} buyers can negotiate or remove — and the exact line items to question.`,
  },
  {
    slugPart: "dealer-fee-calculator",
    cluster: "dealer_fees",
    searchIntent: "commercial",
    keyword: (m) => `dealer fee calculator ${m.city}`,
    title: (m) => `Dealer Fee Calculator for ${m.city}, ${m.state} Car Buyers`,
    h1: (m) => `Dealer Fee Calculator for ${m.city}, ${m.state}`,
    metaDescription: (m) =>
      `Enter any fee from your ${m.city}, ${m.state} dealer worksheet and find out instantly whether it's required by law, negotiable, or pure markup.`,
  },
  {
    slugPart: "hidden-dealer-fees",
    cluster: "dealer_fees",
    searchIntent: "commercial",
    keyword: (m) => `hidden dealer fees ${m.stateName}`,
    title: (m) => `Hidden Dealer Fees in ${m.stateName} — Spot Them Before You Sign`,
    h1: (m) => `Hidden Dealer Fees in ${m.stateName}`,
    metaDescription: (m) =>
      `The add-ons and markups ${m.stateName} dealers slip onto the contract — and how ${m.city}-area buyers can catch them before signing.`,
  },
];

const TRADE_IN_VARIATIONS: VariationTemplate[] = [
  {
    slugPart: "trade-in-value",
    cluster: "trade_in",
    searchIntent: "commercial",
    keyword: (m) => `trade-in value ${m.city} ${m.state}`,
    title: (m) => `Trade-In Value in ${m.city}, ${m.state} — Get Top Dollar`,
    h1: (m) => `Trade-In Value in ${m.city}, ${m.state}`,
    metaDescription: (m) =>
      `How ${m.city}, ${m.state} dealers set your trade-in number, and the steps that protect your value when you trade and buy at the same time.`,
  },
  {
    slugPart: "maximize-trade-in-value",
    cluster: "trade_in",
    searchIntent: "commercial",
    keyword: (m) => `how to maximize trade-in value ${m.city}`,
    title: (m) => `How to Maximize Your Trade-In Value in ${m.city}, ${m.state}`,
    h1: (m) => `How to Maximize Your Trade-In Value in ${m.city}, ${m.state}`,
    metaDescription: (m) =>
      `Simple, no-cost moves that raise your trade-in offer from ${m.city}, ${m.state} dealers — and the mistake that quietly costs sellers the most.`,
  },
  {
    slugPart: "trade-in-vs-sell-privately",
    cluster: "trade_in",
    searchIntent: "commercial",
    keyword: (m) => `trade-in vs sell privately ${m.stateName}`,
    title: (m) => `Trade-In vs. Sell Privately in ${m.stateName} — Which Pays More?`,
    h1: (m) => `Trade-In vs. Sell Privately in ${m.stateName}`,
    metaDescription: (m) =>
      `The real trade-off for ${m.stateName} owners: the tax credit and convenience of trading in versus the higher price of selling your car privately.`,
  },
  {
    slugPart: "best-trade-in-value",
    cluster: "trade_in",
    searchIntent: "commercial",
    keyword: (m) => `best trade-in value ${m.city}`,
    title: (m) => `Where to Get the Best Trade-In Value in ${m.city}, ${m.state}`,
    h1: (m) => `Best Trade-In Value in ${m.city}, ${m.state}`,
    metaDescription: (m) =>
      `How to compare trade-in offers across ${m.city}, ${m.state} dealers so you know your car's real number before you ever start negotiating.`,
  },
  {
    slugPart: "car-trade-in-calculator",
    cluster: "trade_in",
    searchIntent: "commercial",
    keyword: (m) => `car trade-in calculator ${m.city}`,
    title: (m) => `Car Trade-In Value Guide for ${m.city}, ${m.state}`,
    h1: (m) => `Car Trade-In Value Guide for ${m.city}, ${m.state}`,
    metaDescription: (m) =>
      `Understand what drives your trade-in number in ${m.city}, ${m.state} and how to separate the trade from the purchase to protect both sides of the deal.`,
  },
];

// Leasing has three fixed variations plus one state-level tip article; the
// model-specific lease keywords are added separately (top 2 models per metro).
const LEASING_VARIATIONS: VariationTemplate[] = [
  {
    slugPart: "car-lease-deals",
    cluster: "leasing",
    searchIntent: "commercial",
    keyword: (m) => `car lease deals ${m.city} ${m.state}`,
    title: (m) => `Car Lease Deals in ${m.city}, ${m.state} — How to Compare Them`,
    h1: (m) => `Car Lease Deals in ${m.city}, ${m.state}`,
    metaDescription: (m) =>
      `How to read a ${m.city}, ${m.state} lease offer — money factor, residual, and fees — so you can compare deals on equal footing.`,
  },
  {
    slugPart: "best-lease-deals",
    cluster: "leasing",
    searchIntent: "commercial",
    keyword: (m) => `best lease deals ${m.city}`,
    title: (m) => `Best Lease Deals in ${m.city}, ${m.state} — What to Look For`,
    h1: (m) => `Best Lease Deals in ${m.city}, ${m.state}`,
    metaDescription: (m) =>
      `The numbers that actually make a lease a good deal in ${m.city}, ${m.state}, and how to get dealers to compete on the lease — not just the monthly payment.`,
  },
  {
    slugPart: "lease-vs-buy",
    cluster: "leasing",
    searchIntent: "commercial",
    keyword: (m) => `lease vs buy ${m.city} ${m.state}`,
    title: (m) => `Lease vs. Buy in ${m.city}, ${m.state} — Which Is Right for You?`,
    h1: (m) => `Lease vs. Buy a Car in ${m.city}, ${m.state}`,
    metaDescription: (m) =>
      `A clear framework for ${m.city}, ${m.state} buyers deciding between leasing and buying — total cost, mileage, and how long you keep a car.`,
  },
  {
    slugPart: "car-leasing-tips",
    cluster: "leasing",
    searchIntent: "commercial",
    keyword: (m) => `car leasing tips ${m.stateName}`,
    title: (m) => `Car Leasing Tips for ${m.stateName} Drivers`,
    h1: (m) => `Car Leasing Tips for ${m.stateName} Drivers`,
    metaDescription: (m) =>
      `The leasing fundamentals every ${m.stateName} driver should know before walking in — money factor, fees, mileage limits, and end-of-lease traps.`,
  },
];

function fromVariation(m: MetroSeed, v: VariationTemplate): ContentKeyword {
  return {
    slug: `${v.slugPart}-${geoSlug(m)}`,
    cluster: v.cluster,
    city: m.city,
    state: m.state,
    metro: m.metro,
    wave: 1,
    targetKeyword: v.keyword(m),
    title: v.title(m),
    metaDescription: v.metaDescription(m),
    h1: v.h1(m),
    searchIntent: v.searchIntent,
    priority: 1,
    pillarSlugs: CLUSTER_PILLAR_MAP[v.cluster] ?? [],
    toolUrl: TOOL_URL,
  };
}

function modelLeaseKeyword(m: MetroSeed, model: ModelSeed): ContentKeyword {
  const name = `${model.make} ${model.model}`;
  return {
    slug: `${tokenSlug(model.make)}-${tokenSlug(model.model)}-lease-deals-${geoSlug(m)}`,
    cluster: "leasing",
    make: model.make,
    model: model.model,
    city: m.city,
    state: m.state,
    metro: m.metro,
    wave: 1,
    targetKeyword: `${name} lease deals ${m.city}`,
    title: `${name} Lease Deals in ${m.city}, ${m.state}`,
    metaDescription: `What a competitive ${name} lease looks like in ${m.city}, ${m.state}, and how to make local dealers compete for your lease.`,
    h1: `${name} Lease Deals in ${m.city}, ${m.state}`,
    searchIntent: "commercial",
    priority: 1,
    pillarSlugs: CLUSTER_PILLAR_MAP.leasing ?? [],
    toolUrl: TOOL_URL,
  };
}

// ── Build the Wave 1 database ───────────────────────────────────────────────
function buildWave1(): ContentKeyword[] {
  const out: ContentKeyword[] = [];
  for (const m of WAVE_1_METROS) {
    // Cluster 1 + 2 — dealer quotes & OTD price (one per target model).
    for (const model of TARGET_MODELS) {
      out.push(dealerQuoteKeyword(m, model));
      out.push(otdPriceKeyword(m, model));
    }
    // Cluster 3 — dealer fees.
    for (const v of DEALER_FEE_VARIATIONS) out.push(fromVariation(m, v));
    // Cluster 4 — trade-in.
    for (const v of TRADE_IN_VARIATIONS) out.push(fromVariation(m, v));
    // Cluster 5 — leasing (fixed variations + top-2 model lease deals).
    for (const v of LEASING_VARIATIONS) out.push(fromVariation(m, v));
    for (const model of TOP_LEASE_MODELS) out.push(modelLeaseKeyword(m, model));
  }

  // Slugs must be unique (mirrors ContentArticle.slug @unique). Fail loudly in
  // dev if a template ever collides so the bug is caught before generation.
  const seen = new Set<string>();
  for (const k of out) {
    if (seen.has(k.slug)) {
      throw new Error(`Duplicate content keyword slug: ${k.slug}`);
    }
    seen.add(k.slug);
  }
  return out;
}

export const CONTENT_KEYWORDS: ContentKeyword[] = buildWave1();

// ── Aggregations + lookups ──────────────────────────────────────────────────
export const KEYWORD_COUNT_BY_WAVE: Record<number, number> = CONTENT_KEYWORDS.reduce(
  (acc, k) => {
    acc[k.wave] = (acc[k.wave] ?? 0) + 1;
    return acc;
  },
  {} as Record<number, number>,
);

export const KEYWORD_COUNT_BY_METRO: Record<string, number> = CONTENT_KEYWORDS.reduce(
  (acc, k) => {
    acc[k.metro] = (acc[k.metro] ?? 0) + 1;
    return acc;
  },
  {} as Record<string, number>,
);

export const KEYWORD_COUNT_BY_CLUSTER: Record<string, number> = CONTENT_KEYWORDS.reduce(
  (acc, k) => {
    acc[k.cluster] = (acc[k.cluster] ?? 0) + 1;
    return acc;
  },
  {} as Record<string, number>,
);

export function getKeywordsForMetro(metro: string): ContentKeyword[] {
  return CONTENT_KEYWORDS.filter((k) => k.metro === metro);
}

export function getKeywordsForCluster(cluster: string): ContentKeyword[] {
  return CONTENT_KEYWORDS.filter((k) => k.cluster === cluster);
}

export function getKeywordsForWave(wave: number): ContentKeyword[] {
  return CONTENT_KEYWORDS.filter((k) => k.wave === wave);
}

export function getKeywordBySlug(slug: string): ContentKeyword | undefined {
  return CONTENT_KEYWORDS.find((k) => k.slug === slug);
}
