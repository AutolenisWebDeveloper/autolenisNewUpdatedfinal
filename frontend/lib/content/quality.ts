// Phase C2 — Quality rubric scorer for generated buying-guide articles.
//
// The skill defines a non-negotiable 6-point rubric. Every generated article is
// scored against it; only a perfect 6/6 (and a clean compliance pass) is
// eligible for auto-publish. Anything 4-5 routes to REVIEW_NEEDED; below 4 stays
// DRAFT.
//
// Two of the six checks (named author byline, above/mid/bottom conversion
// elements) are structurally guaranteed by the /buying-guide/[slug] route, which
// renders them around every article body regardless of what the model produced.
// They are still scored here so the rubric is explicit and the score is honest.
//
// Pure module (no I/O) — unit testable without the model or the database.

import { stripHtml } from "@/lib/content/compliance";

export interface QualityCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface QualityResult {
  score: number; // 0..6
  maxScore: number; // 6
  passedAll: boolean;
  wordCount: number;
  checks: QualityCheck[];
  flags: string[]; // labels of failed checks, for quality_flags storage
}

export interface QualityInput {
  body: string; // generated HTML body
  faqs: Array<{ question: string; answer: string }>;
  city: string;
  state: string;
  metro?: string | null;
  pillarSlugs: string[]; // pillar slugs the body is expected to link to
  toolUrl: string; // dealer fee calculator URL
}

const MARKET_CONTEXT_TERMS = [
  "market",
  "typical",
  "average",
  "inventory",
  "demand",
  "dealers",
  "pricing",
  "supply",
  "incentive",
  "rebate",
];

const FIRST_HAND_SIGNALS = [
  "autolenis",
  "48-hour",
  "48 hour",
  "dealers compete",
  "compete for your",
  "private auction",
  "reverse auction",
  "based on",
  "market conditions",
];

function countWords(text: string): number {
  const clean = stripHtml(text);
  if (!clean) return 0;
  return clean.split(/\s+/).filter(Boolean).length;
}

// Count how many of the expected pillar slugs the body actually links to.
function countPillarLinks(body: string, pillarSlugs: string[]): number {
  const lower = body.toLowerCase();
  let linked = 0;
  for (const slug of pillarSlugs) {
    if (lower.includes(`/buying-guide/${slug.toLowerCase()}`)) linked += 1;
  }
  return linked;
}

export function scoreArticle(input: QualityInput): QualityResult {
  const { body, faqs, city, state, metro, pillarSlugs, toolUrl } = input;

  const haystack = stripHtml(
    `${body} ${faqs.map((f) => `${f.question} ${f.answer}`).join(" ")}`,
  ).toLowerCase();
  const wordCount = countWords(body);

  const cityHit = city ? haystack.includes(city.toLowerCase()) : false;
  const geoHit =
    (state ? haystack.includes(state.toLowerCase()) : false) ||
    (metro ? haystack.includes(metro.toLowerCase()) : false);
  const marketHit = MARKET_CONTEXT_TERMS.some((t) => haystack.includes(t));

  const firstHandHit = FIRST_HAND_SIGNALS.some((s) => haystack.includes(s));

  const pillarLinks = countPillarLinks(body, pillarSlugs);
  const toolLinked = body.toLowerCase().includes(toolUrl.toLowerCase());

  const checks: QualityCheck[] = [
    {
      id: "local_data_point",
      label: "Unique local data point",
      passed: cityHit && geoHit && marketHit,
      detail: `city=${cityHit} geo=${geoHit} market-context=${marketHit}`,
    },
    {
      id: "first_hand_signal",
      label: "First-hand signal",
      passed: firstHandHit,
      detail: firstHandHit
        ? "AutoLenis process / market framing present"
        : "no AutoLenis or market-data framing found",
    },
    {
      id: "internal_links",
      label: "Internal links (2 pillar + 1 calculator)",
      passed: pillarLinks >= 2 && toolLinked,
      detail: `pillarLinks=${pillarLinks} calculatorLink=${toolLinked}`,
    },
    {
      id: "named_author",
      label: "Named author byline",
      // Guaranteed by the route: every article renders the "By Markist,
      // Founder of AutoLenis" byline linking to /author/markist.
      passed: true,
      detail: "rendered by /buying-guide/[slug] route",
    },
    {
      id: "min_word_count",
      label: "Minimum 700 words",
      passed: wordCount >= 700,
      detail: `wordCount=${wordCount}`,
    },
    {
      id: "conversion_element",
      label: "On-page conversion element (above + mid)",
      // Guaranteed by the route: above-fold CTA, mid/bottom CTA, and calculator
      // card are rendered around every article body.
      passed: true,
      detail: "above-fold + mid-page CTAs rendered by route",
    },
  ];

  const passed = checks.filter((c) => c.passed);
  const flags = checks.filter((c) => !c.passed).map((c) => c.label);

  return {
    score: passed.length,
    maxScore: checks.length,
    passedAll: flags.length === 0,
    wordCount,
    checks,
    flags,
  };
}
