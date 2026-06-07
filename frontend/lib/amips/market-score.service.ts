// AMIPS Phase 0 — Market Score Engine.
//
// The AutoLenis Market Score is displayed on every Tier C/D/E page. It is
// computed entirely from database fields — never estimated. The formula is
// public, so the score is defensible:
//
//   Overall Buyer Advantage =
//     (Dealer Competition  x 0.30) +
//     (Inventory           x 0.30) +
//     (Negotiation         x 0.25) +
//     (Financing           x 0.15)
//
// Each component is mapped from a real data field onto a 0–10 scale, and the
// overall score is rounded to one decimal. The markdown formatter produces the
// display table embedded into Tier C/D/E pages; the JSON formatter produces the
// Dataset structured-data payload.

export type InventorySignal = "low" | "normal" | "high";
export type NegotiationDifficulty = "easy" | "moderate" | "hard";
export type IncentiveStatus = "none" | "some" | "strong";

export interface MarketScoreInput {
  dealersWithin30mi: number;
  inventorySignal: InventorySignal;
  negotiationDifficulty: NegotiationDifficulty;
  incentiveStatus: IncentiveStatus;
}

export interface MarketScoreResult {
  dealerCompetition: number; // 0-10
  inventoryScore: number; // 0-10
  negotiationOpportunity: number; // 0-10
  financingIncentives: number; // 0-10
  overallBuyerAdvantage: number; // 0-10, one decimal
  computedAt: string; // ISO date
}

// Component weights for the overall score. Must sum to 1.0.
const WEIGHTS = {
  dealerCompetition: 0.3,
  inventoryScore: 0.3,
  negotiationOpportunity: 0.25,
  financingIncentives: 0.15,
} as const;

// Dealer Competition Score (0–10) from dealers within 30 miles.
function scoreDealerCompetition(dealersWithin30mi: number): number {
  if (dealersWithin30mi <= 2) return 2;
  if (dealersWithin30mi <= 5) return 4;
  if (dealersWithin30mi <= 9) return 7;
  if (dealersWithin30mi <= 14) return 8;
  return 10; // 15+
}

// Inventory Score (0–10) from the inventory signal.
function scoreInventory(signal: InventorySignal): number {
  switch (signal) {
    case "low":
      return 2;
    case "normal":
      return 5;
    case "high":
      return 9;
  }
}

// Negotiation Opportunity Score (0–10) from negotiation difficulty.
function scoreNegotiation(difficulty: NegotiationDifficulty): number {
  switch (difficulty) {
    case "hard":
      return 3;
    case "moderate":
      return 6;
    case "easy":
      return 9;
  }
}

// Financing Incentives Score (0–10) from incentive status.
function scoreFinancing(status: IncentiveStatus): number {
  switch (status) {
    case "none":
      return 3;
    case "some":
      return 6;
    case "strong":
      return 9;
  }
}

// Round to one decimal place.
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Compute the AutoLenis Market Score from real data fields.
 */
export function computeMarketScore(input: MarketScoreInput): MarketScoreResult {
  const dealerCompetition = scoreDealerCompetition(input.dealersWithin30mi);
  const inventoryScore = scoreInventory(input.inventorySignal);
  const negotiationOpportunity = scoreNegotiation(input.negotiationDifficulty);
  const financingIncentives = scoreFinancing(input.incentiveStatus);

  const overallBuyerAdvantage = round1(
    dealerCompetition * WEIGHTS.dealerCompetition +
      inventoryScore * WEIGHTS.inventoryScore +
      negotiationOpportunity * WEIGHTS.negotiationOpportunity +
      financingIncentives * WEIGHTS.financingIncentives,
  );

  return {
    dealerCompetition,
    inventoryScore,
    negotiationOpportunity,
    financingIncentives,
    overallBuyerAdvantage,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Produce the markdown display table embedded into every Tier C/D/E page.
 */
export function formatScoreAsMarkdown(
  result: MarketScoreResult,
  vehicle: string,
  metro: string,
): string {
  const asOf = result.computedAt.slice(0, 10); // YYYY-MM-DD
  return [
    `### AutoLenis Market Score — ${vehicle} in ${metro}`,
    "",
    "| Factor | Score (0–10) |",
    "|---|---|",
    `| Dealer Competition | ${result.dealerCompetition.toFixed(1)} |`,
    `| Inventory | ${result.inventoryScore.toFixed(1)} |`,
    `| Negotiation Opportunity | ${result.negotiationOpportunity.toFixed(1)} |`,
    `| Financing Incentives | ${result.financingIncentives.toFixed(1)} |`,
    `| **Overall Buyer Advantage** | **${result.overallBuyerAdvantage.toFixed(1)}** |`,
    "",
    `*Data as of ${asOf}. Computed from AutoLenis market data — never estimated.*`,
  ].join("\n");
}

/**
 * Produce the Dataset structured-data JSON for the score.
 */
export function formatScoreAsJson(result: MarketScoreResult): string {
  return JSON.stringify(
    {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: "AutoLenis Market Score",
      description:
        "Buyer-advantage score computed from dealer competition, inventory, negotiation difficulty, and financing incentives.",
      variableMeasured: [
        { "@type": "PropertyValue", name: "Dealer Competition", value: result.dealerCompetition, maxValue: 10 },
        { "@type": "PropertyValue", name: "Inventory", value: result.inventoryScore, maxValue: 10 },
        { "@type": "PropertyValue", name: "Negotiation Opportunity", value: result.negotiationOpportunity, maxValue: 10 },
        { "@type": "PropertyValue", name: "Financing Incentives", value: result.financingIncentives, maxValue: 10 },
        { "@type": "PropertyValue", name: "Overall Buyer Advantage", value: result.overallBuyerAdvantage, maxValue: 10 },
      ],
      dateModified: result.computedAt,
    },
    null,
    2,
  );
}
