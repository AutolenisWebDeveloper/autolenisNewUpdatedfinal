// Phase C-Leads — Lead Magnet registry.
//
// Lead magnets are the top-of-funnel offers that convert anonymous content
// readers into known buyers. The flagship is "The Car Buyer's Honest Guide"
// (national scope — no city/region framing). Cluster-aligned magnets let each
// buying-guide cluster surface the most relevant offer.
//
// This module is the single source of truth for:
//   - what magnets exist (slug, copy, deliverable access path)
//   - how a buyer's timeline maps to a lead temperature + nurture track
// Both the public capture form, the capture API, and the email sequence read
// from here so the segmentation logic never drifts.

export type BuyerTimeline =
  | "30_days"
  | "1_3_months"
  | "3_6_months"
  | "researching";

export type LeadTemperature = "HOT" | "WARM" | "COLD";

// Three nurture tracks — one per intent band. "all 3 tracks" in the launch
// checklist refers to these.
export type SequenceTrack = "ready" | "soon" | "researching";

// Content clusters mirror lib/seo/pillar-links.ts CLUSTER_PILLAR_MAP so a
// cluster page can request the magnet that best fits its topic.
export type LeadMagnetCluster =
  | "dealer_quotes"
  | "otd_price"
  | "dealer_fees"
  | "trade_in"
  | "leasing";

export interface LeadMagnet {
  slug: string;
  /** Headline title shown on the offer card / landing page. */
  title: string;
  /** One-line value proposition. */
  subtitle: string;
  /** Longer description for the landing page intro + email body. */
  description: string;
  /** Bullet list of what's inside the guide. */
  bullets: string[];
  /** Button label for the capture form. */
  ctaLabel: string;
  /** Cluster this magnet is the best fit for (used for recommendation). */
  cluster?: LeadMagnetCluster;
  /**
   * Path where the buyer reads/downloads the deliverable after capture. The
   * delivery email links here; the thank-you page renders it inline.
   */
  accessPath: string;
  /** UTM campaign tag recorded on the CRM contact. */
  utmCampaign: string;
}

// ── Flagship + cluster-aligned magnets ──────────────────────────────────────

export const LEAD_MAGNETS: LeadMagnet[] = [
  {
    slug: "honest-guide",
    title: "The Car Buyer's Honest Guide",
    subtitle:
      "Everything dealerships hope you never learn — in one straight-talking guide.",
    description:
      "A no-spin walkthrough of how car pricing actually works, which fees are real, and how to make dealers compete for your business instead of the other way around. Written for buyers in every US market.",
    bullets: [
      "The 3 numbers that decide whether you got a good deal",
      "Every dealer fee explained — what's required, what's negotiable, what's pure markup",
      "The exact lines that get add-ons removed from your contract",
      "How to compare out-the-door prices across dealers without getting played",
      "When to walk — and how dealers respond when you do",
    ],
    ctaLabel: "Get the Free Guide",
    accessPath: "/guide/thank-you",
    utmCampaign: "lead_magnet_honest_guide",
  },
  {
    slug: "dealer-fee-cheatsheet",
    title: "The Dealer Fee Cheat Sheet",
    subtitle:
      "A one-page verdict on every fee a dealer can put in front of you.",
    description:
      "Doc fees, market adjustments, nitrogen tires, VIN etching, GAP, paint protection — each one labeled required, negotiable, or reject, with the line to say when it shows up on your worksheet.",
    bullets: [
      "Every common dealer fee with a clear verdict",
      "State doc-fee caps and typical ranges",
      "What to say to remove each junk fee",
      "How 'market adjustments' really work",
    ],
    ctaLabel: "Get the Cheat Sheet",
    cluster: "dealer_fees",
    accessPath: "/guide/thank-you",
    utmCampaign: "lead_magnet_dealer_fee_cheatsheet",
  },
  {
    slug: "trade-in-playbook",
    title: "The Trade-In Value Playbook",
    subtitle: "Stop leaving money on the table when you trade in.",
    description:
      "How dealers really value trade-ins, why you should negotiate the car and the trade separately, and how to know your floor before you walk in.",
    bullets: [
      "How to find your car's real trade-in floor",
      "Why you negotiate price and trade-in separately",
      "Trade-in vs. selling privately — the honest math",
      "The tax-credit angle most buyers miss",
    ],
    ctaLabel: "Get the Playbook",
    cluster: "trade_in",
    accessPath: "/guide/thank-you",
    utmCampaign: "lead_magnet_trade_in_playbook",
  },
  {
    slug: "otd-price-worksheet",
    title: "The Out-the-Door Price Worksheet",
    subtitle: "Compare dealers on the only number that matters.",
    description:
      "A simple worksheet that turns confusing quotes into a single out-the-door number you can compare apples-to-apples across every dealer.",
    bullets: [
      "Build a true out-the-door total in minutes",
      "Separate price, fees, and taxes cleanly",
      "Spot padded quotes instantly",
      "A side-by-side dealer comparison grid",
    ],
    ctaLabel: "Get the Worksheet",
    cluster: "otd_price",
    accessPath: "/guide/thank-you",
    utmCampaign: "lead_magnet_otd_worksheet",
  },
  {
    slug: "lease-decision-kit",
    title: "The Lease vs. Buy Decision Kit",
    subtitle: "Decide with math, not a salesperson's pitch.",
    description:
      "Money factor, residual, and total cost of ownership explained plainly — plus a framework for when leasing genuinely beats buying.",
    bullets: [
      "Money factor and residual in plain English",
      "The total-cost-of-ownership comparison",
      "When leasing actually wins",
      "Lease terms dealers hope you won't question",
    ],
    ctaLabel: "Get the Decision Kit",
    cluster: "leasing",
    accessPath: "/guide/thank-you",
    utmCampaign: "lead_magnet_lease_kit",
  },
];

export const DEFAULT_LEAD_MAGNET_SLUG = "honest-guide";

const MAGNET_BY_SLUG: Record<string, LeadMagnet> = Object.fromEntries(
  LEAD_MAGNETS.map((m) => [m.slug, m]),
);

export function getLeadMagnet(slug: string | null | undefined): LeadMagnet {
  if (slug && MAGNET_BY_SLUG[slug]) return MAGNET_BY_SLUG[slug];
  return MAGNET_BY_SLUG[DEFAULT_LEAD_MAGNET_SLUG];
}

export function isValidMagnetSlug(slug: unknown): slug is string {
  return typeof slug === "string" && slug in MAGNET_BY_SLUG;
}

/** Recommend the best magnet for a content cluster, falling back to flagship. */
export function getMagnetForCluster(
  cluster: LeadMagnetCluster | string | undefined,
): LeadMagnet {
  const match = LEAD_MAGNETS.find((m) => m.cluster === cluster);
  return match ?? getLeadMagnet(DEFAULT_LEAD_MAGNET_SLUG);
}

// ── Timeline → segmentation ─────────────────────────────────────────────────

export const TIMELINE_OPTIONS: Array<{ value: BuyerTimeline; label: string }> = [
  { value: "30_days", label: "Within 30 days" },
  { value: "1_3_months", label: "1-3 months" },
  { value: "3_6_months", label: "3-6 months" },
  { value: "researching", label: "Just researching" },
];

export function isValidTimeline(v: unknown): v is BuyerTimeline {
  return (
    v === "30_days" ||
    v === "1_3_months" ||
    v === "3_6_months" ||
    v === "researching"
  );
}

const TIMELINE_TO_TEMPERATURE: Record<BuyerTimeline, LeadTemperature> = {
  "30_days": "HOT",
  "1_3_months": "WARM",
  "3_6_months": "WARM",
  researching: "COLD",
};

const TIMELINE_TO_TRACK: Record<BuyerTimeline, SequenceTrack> = {
  "30_days": "ready",
  "1_3_months": "soon",
  "3_6_months": "soon",
  researching: "researching",
};

const TIMELINE_TO_SEGMENT: Record<BuyerTimeline, string> = {
  "30_days": "ready_to_buy",
  "1_3_months": "buying_soon",
  "3_6_months": "buying_later",
  researching: "researching",
};

export const TIMELINE_LABEL: Record<BuyerTimeline, string> = {
  "30_days": "Buying within 30 days",
  "1_3_months": "Buying in 1-3 months",
  "3_6_months": "Buying in 3-6 months",
  researching: "Just researching",
};

export function temperatureForTimeline(t: BuyerTimeline): LeadTemperature {
  return TIMELINE_TO_TEMPERATURE[t];
}

export function trackForTimeline(t: BuyerTimeline): SequenceTrack {
  return TIMELINE_TO_TRACK[t];
}

export function segmentForTimeline(t: BuyerTimeline): string {
  return TIMELINE_TO_SEGMENT[t];
}
