// lib/services/inventory/inventory-match-score.ts — Batch 1
//
// Deterministic, pure vehicle-match scoring shared by request matching and buyer
// matching. Same inputs → same score, always. No DB, no clock, no randomness.

export interface MatchCriteria {
  make?: string | null;
  model?: string | null;
  yearMin?: number | null;
  yearMax?: number | null;
  maxPriceCents?: number | null;
}

export interface ScorableItem {
  make: string;
  model: string;
  year: number;
  priceCents: number;
  lane: string; // LANE_1 | LANE_2 | LANE_3
}

export interface MatchScore {
  score: number; // 0..1, rounded to 4 dp
  factors: {
    make: number;
    model: number;
    year: number;
    price: number;
    lane: number;
  };
}

// Weights sum to 1. A criterion that is not specified is treated as satisfied
// (it is not constraining) so the score reflects only the constraints the buyer set.
const W = { make: 0.35, model: 0.25, year: 0.15, price: 0.15, lane: 0.1 } as const;

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function makeScore(criteria: MatchCriteria, item: ScorableItem): number {
  if (!criteria.make) return 1;
  const a = norm(criteria.make);
  const b = norm(item.make);
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) return 0.6;
  return 0;
}

function modelScore(criteria: MatchCriteria, item: ScorableItem): number {
  if (!criteria.model) return 1;
  const a = norm(criteria.model);
  const b = norm(item.model);
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) return 0.7;
  return 0;
}

function yearScore(criteria: MatchCriteria, item: ScorableItem): number {
  const { yearMin, yearMax } = criteria;
  if (yearMin == null && yearMax == null) return 1;
  if ((yearMin == null || item.year >= yearMin) && (yearMax == null || item.year <= yearMax)) return 1;
  // Linear decay of 0.1 per year outside the band, floored at 0.
  const dist = yearMin != null && item.year < yearMin ? yearMin - item.year
    : yearMax != null && item.year > yearMax ? item.year - yearMax
    : 0;
  return Math.max(0, 1 - dist * 0.1);
}

function priceScore(criteria: MatchCriteria, item: ScorableItem): number {
  const max = criteria.maxPriceCents;
  if (max == null || max <= 0) return 1;
  if (item.priceCents > max) return 0;
  // Full credit within budget; a small headroom nudge keeps ordering stable.
  const headroom = (max - item.priceCents) / max; // 0..1
  return Math.min(1, 0.9 + headroom * 0.1);
}

function laneScore(item: ScorableItem): number {
  switch (item.lane) {
    case "LANE_1": return 1; // dealer-owned / verified
    case "LANE_2": return 0.6; // partner-adjacent
    default: return 0.3; // open-market
  }
}

export function computeMatchScore(criteria: MatchCriteria, item: ScorableItem): MatchScore {
  const factors = {
    make: makeScore(criteria, item),
    model: modelScore(criteria, item),
    year: yearScore(criteria, item),
    price: priceScore(criteria, item),
    lane: laneScore(item),
  };
  const raw = factors.make * W.make + factors.model * W.model + factors.year * W.year + factors.price * W.price + factors.lane * W.lane;
  return { score: Math.round(raw * 10000) / 10000, factors };
}
