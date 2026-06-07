// AMIPS Phase 2 — generator prompt system.
//
// The AI narrates the assembled DATA OBJECT and nothing else. Every factual
// claim must trace to a number we handed it. These templates encode the
// absolute rules and the exact article structure the model must follow, and
// build the user message from an AmipsPageData object so the model never sees
// the database — only the curated facts.

import type { ChatMessage } from "@/lib/ai/groq-client";
import type { AmipsPageData } from "@/lib/amips/assembler";
import { fmt } from "@/lib/amips/assembler";

const METRO_TIERS = new Set(["C", "D", "E"]);

export const AMIPS_SYSTEM_PROMPT = `You are the AutoLenis Market Intelligence writer. Your job is to explain what the data shows — not to invent, estimate, or fill gaps with generic information.

ABSOLUTE RULES — never violate:
1. Every factual claim must reference a number from the DATA OBJECT provided. No exceptions.
2. Never fabricate savings amounts, testimonials, or buyer stories.
3. Never claim specific APR rates or incentive amounts without an expiration date from the data.
4. Label all price estimates as estimates derived from manufacturer MSRP data.
5. If the data object does not contain a number, do not claim that number exists.
6. The AI narrates. The data decides.
7. EXCEPTION for verified records: figures inside an "autolenisData" block are real, completed AutoLenis transaction outcomes. State them as facts — never label them as estimates or approximations. Vehicle prices remain estimates as always.

OUTPUT FORMAT: Return ONLY valid JSON, no markdown:
{
  "title": "string (60 chars max)",
  "metaDescription": "string (155 chars max)",
  "h1": "string",
  "body": "string (markdown, 900-1100 words)",
  "faqs": [
    { "question": "string", "answer": "string" },
    { "question": "string", "answer": "string" },
    { "question": "string", "answer": "string" },
    { "question": "string", "answer": "string" }
  ],
  "dataTokensUsed": ["list of real numbers referenced"],
  "wordCount": number
}`;

// The shape the generator parses out of the model's JSON response.
export interface GeneratedAmipsArticle {
  title: string;
  metaDescription: string;
  h1: string;
  body: string;
  faqs: Array<{ question: string; answer: string }>;
  dataTokensUsed: string[];
  wordCount: number;
}

function incentivesLine(data: AmipsPageData): string {
  const inc = data.vehicle.activeIncentives?.trim();
  if (!inc) return "None active";
  const exp = data.vehicle.incentivesExpiresAt;
  return exp ? `${inc} (expires ${exp.toISOString().slice(0, 10)})` : inc;
}

// Build the DATA OBJECT block exactly as the model should see it — only real,
// labeled facts. Market block is included only for Tier C/D/E.
function buildDataObject(data: AmipsPageData): string {
  const v = data.vehicle;
  const vehicle = {
    make: v.make,
    model: v.model,
    trim: v.trim ?? "base",
    year: v.year,
    msrp: fmt.dollars(v.msrpCents),
    fairMarketRange: `${fmt.dollars(v.fairMarketLowCents)} - ${fmt.dollars(
      v.fairMarketHighCents,
    )} (estimated)`,
    aggressiveTarget: `${fmt.dollars(v.aggressiveTargetCents)} (estimated)`,
    negotiationDifficulty: v.negotiationDifficulty,
    activeIncentives: incentivesLine(data),
    financingNotes: v.financingNotes?.trim() || "Standard financing available",
  };

  const obj: Record<string, unknown> = { vehicle };

  if (data.market && data.marketScore) {
    obj.market = {
      metro: data.market.metro,
      state: data.market.state,
      dealerCount: data.market.dealerCount,
      marketScore: {
        dealerCompetition: `${data.marketScore.dealerCompetition}/10`,
        inventoryScore: `${data.marketScore.inventoryScore}/10`,
        negotiationOpportunity: `${data.marketScore.negotiationOpportunity}/10`,
        financingIncentives: `${data.marketScore.financingIncentives}/10`,
        overallBuyerAdvantage: `${data.marketScore.overallBuyerAdvantage}/10`,
      },
    };
  }

  // Tier F — verified, real AutoLenis transaction outcomes. State as facts.
  if (data.tierF) {
    const f = data.tierF;
    obj.autolenisData = {
      note: "VERIFIED AutoLenis transaction records — factual, NOT estimates",
      metro: data.market?.metro ?? "",
      completedTransactions: f.transactionCount,
      dealerResponseRate:
        f.dealerResponseRatePct != null ? `${f.dealerResponseRatePct}%` : "n/a",
      avgOffersPerBuyer: f.avgOffersPerBuyer ?? "n/a",
      medianTimeToBestOffer:
        f.medianTimeToBestOfferHours != null
          ? `${f.medianTimeToBestOfferHours} hours`
          : "n/a",
    };
  }

  obj.dataAsOf = data.vehicleDataAsOf.toISOString().slice(0, 10);

  return JSON.stringify(obj, null, 2);
}

// The market section + score table are Tier C/D/E only. Tier F gets its own
// proprietary, transaction-backed section in their place.
function structureSection(data: AmipsPageData): string {
  const v = data.vehicle;
  const isMetro = METRO_TIERS.has(data.tier) && !!data.market;
  const isTierF = data.tier === "F" && !!data.tierF;
  const hasScore = !!data.marketScore;
  const hasMetro = !!data.market;
  const metro = data.market?.metro ?? "";
  const asOf = data.vehicleDataAsOf.toISOString().slice(0, 10);

  const marketH2 = isMetro
    ? `
H2: "The ${metro} ${v.make} ${v.model} Market Right Now"
Reference the dealer count and the market score components. Explain what the
scores mean for the buyer in plain English.

MARKET SCORE TABLE:
After the market section, restate the overall buyer advantage score in prose.
(The page renders the full score table from the data — do not draw an ASCII
table.) Label the figures "Data as of ${asOf}".`
    : "";

  // Tier F proprietary section — narrate the verified autolenisData as facts.
  const proprietaryH2 = isTierF
    ? `
H2: "What Real ${v.make} ${v.model} Buyers in ${metro} Are Seeing"
This section uses AutoLenis's OWN verified transaction records (the
"autolenisData" block). State these as facts — NOT estimates. Reference
completedTransactions, dealerResponseRate, avgOffersPerBuyer, and
medianTimeToBestOffer. Explain in plain English what these real outcomes mean
for a buyer. Do not invent any figure that is not in autolenisData. This is
proprietary AutoLenis data competitors do not have.`
    : "";

  const ctaCopy =
    data.ctaType === "request_offers"
      ? `request_offers: "Get ${data.dealerCount} ${v.make} ${v.model} dealers to compete for your business"`
      : `join_waitlist: "Join the early-access list — be first when dealers compete in your market"`;

  return `ARTICLE STRUCTURE (follow exactly):

H1: ${data.keywordTarget} — natural, human language.

INTRO (about 100 words):
Explain what this page covers and what the buyer will learn. Reference at least
1 real number from the data object.

H2: "What Is the ${v.make} ${v.model} Actually Worth?"
Direct answer first (1-2 sentences with the price data). Explain MSRP, fair
market range, and aggressive target. Label all as estimates derived from
manufacturer data.
${marketH2}${proprietaryH2}

H2: "What Negotiation Looks Like for This Vehicle"
Reference negotiationDifficulty${
    hasScore ? " and the dealer competition score" : ""
  }. Give specific buyer strategy for this vehicle${
    hasMetro ? " and market" : ""
  } — not generic advice.

H2: "Current Financing and Incentives"
Reference activeIncentives with the expiration date if available. If no
incentives: say so directly. Never invent an APR or rebate amount.

H2: "How AutoLenis Works${hasMetro ? ` for ${metro} Buyers` : ""}"
Explain the 48-hour auction: 8 dealers compete, the buyer picks the best offer.
Factual mechanics only. No savings claims.

FAQ SECTION:
4 questions buyers${hasMetro ? ` in ${metro}` : ""} actually ask about the
${v.make} ${v.model}. Direct answers only. Reference data where available.

AUTHOR: "By Markist Athelus, Founder of AutoLenis"

CTA (use exactly this intent):
  ${ctaCopy}

FRESHNESS:
End the body with: "Last Updated: ${new Date()
    .toISOString()
    .slice(0, 10)} | Data as of: ${data.vehicleDataAsOf
    .toISOString()
    .slice(0, 10)}"`;
}

/**
 * Build the user message for the AMIPS generator from assembled page data.
 */
export function buildAmipsUserPrompt(data: AmipsPageData): string {
  return `Write an automotive buyer intelligence page using ONLY the data provided below. Do not invent any numbers.

CONTENT TIER: ${data.tier}
KEYWORD TARGET: ${data.keywordTarget}

DATA OBJECT (narrate this — do not invent):
${buildDataObject(data)}

${structureSection(data)}`;
}

/**
 * Build the full chat message array (system + user) for the generator.
 */
export function buildAmipsMessages(data: AmipsPageData): ChatMessage[] {
  return [
    { role: "system", content: AMIPS_SYSTEM_PROMPT },
    { role: "user", content: buildAmipsUserPrompt(data) },
  ];
}
