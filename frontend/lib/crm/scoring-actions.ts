// ---------------------------------------------------------------------------
// LEAD SCORING ACTIONS (Layer 4) — pure, no I/O
// ---------------------------------------------------------------------------
// The spec's action→points table. Every tracked behavior accrues points onto
// the contact's cumulative lead_score (migration 06). Accrual is additive and
// therefore inherently NON-DOWNGRADING — it mirrors the platform's no-downgrade
// score policy (score-policy.ts) without needing a max() because points are
// always positive. Temperature is derived from the cumulative score using the
// same hot/warm/cold thresholds as the intake scorer (scoring.service.ts), so
// the two scoring paths agree on what "hot" means and both satisfy the
// contacts_lead_temperature_chk CHECK ('hot' | 'warm' | 'cold').

export type ScoringAction =
  | 'landing_page_visit'
  | 'article_read'
  | 'vehicle_search'
  | 'calculator_use'
  | 'zura_conversation'
  | 'vehicle_request'
  | 'offer_view'
  | 'offer_favorite'
  | 'offer_accepted'
  | 'deal_completed';

// Point values are the spec's table verbatim. Changing a number here changes
// the scoring everywhere (dispatch endpoint + event-spine wiring).
export const ACTION_POINTS: Record<ScoringAction, number> = {
  landing_page_visit: 1,
  article_read: 5,
  vehicle_search: 10,
  calculator_use: 20,
  zura_conversation: 25,
  vehicle_request: 100,
  offer_view: 50,
  offer_favorite: 75,
  offer_accepted: 200,
  deal_completed: 500,
};

export function isScoringAction(value: unknown): value is ScoringAction {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ACTION_POINTS, value);
}

export function pointsForAction(action: ScoringAction): number {
  return ACTION_POINTS[action];
}

// Temperature thresholds on the CUMULATIVE score. Aligned with the intake
// scorer's hot≥85 / warm≥50 / cold split.
export const TEMP_WARM_MIN = 50;
export const TEMP_HOT_MIN = 85;
// "Ready To Buy" — a buyer who has accepted an offer (+200) or beyond. Used by
// the seeded Buyer segment (migration 11) and as a documented high-water mark.
export const READY_TO_BUY_MIN = 200;

export type Temperature = 'hot' | 'warm' | 'cold';

export function temperatureForScore(score: number): Temperature {
  if (score >= TEMP_HOT_MIN) return 'hot';
  if (score >= TEMP_WARM_MIN) return 'warm';
  return 'cold';
}

// A "priority outreach" task fires the moment a contact FIRST crosses the HOT
// threshold — i.e. the accrual took them from below HOT to at/above it. Pure
// predicate so the trigger boundary is unit-testable without the DB.
export function crossedHotThreshold(priorScore: number, newScore: number): boolean {
  return priorScore < TEMP_HOT_MIN && newScore >= TEMP_HOT_MIN;
}
