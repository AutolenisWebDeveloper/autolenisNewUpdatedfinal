// ---------------------------------------------------------------------------
// LIFECYCLE STAGE ADVANCE POLICY — pure, no I/O
// ---------------------------------------------------------------------------
// The single source of truth for how a spine domain event moves a contact's
// funnel stage. Kept pure (no Supabase, no server-only) so it is trivially
// testable and importable from anywhere; emit.ts owns the actual DB write.
//
// Design mirrors the lead-score never-downgrade rule (see lib/crm/score-policy):
// an event may push a contact FURTHER along the funnel but NEVER back to an
// earlier stage. Ranking is the LifecycleStage union's declared order.

import type { LifecycleStage } from '@/lib/types/crm';
import type { DomainEventType } from './emit';

// Ranking = the LifecycleStage union's declared order (lead is lowest, inactive
// highest). A target only advances a contact when its rank is strictly greater
// than the current stage's rank.
export const STAGE_RANK: Record<LifecycleStage, number> = {
  lead: 0,
  prequal_started: 1,
  prequal_completed: 2,
  deposit_pending: 3,
  deposit_paid: 4,
  auction_active: 5,
  offer_received: 6,
  purchase_completed: 7,
  inactive: 8,
};

// Deterministic event→stage map. Every emittable domain event has an entry so
// there is no ambiguity / drift (DomainEventType is derived from
// WorkflowTriggerType). Top-of-funnel lead-capture events map to 'lead' — the
// floor — so they can never advance (and never downgrade) an existing contact;
// they exist in the map for exhaustiveness, not motion.
export const EVENT_TO_STAGE: Record<DomainEventType, LifecycleStage> = {
  // Lead-capture / top-of-funnel — floor stage, never advances an existing
  // contact past 'lead'.
  buyer_signup: 'lead',
  refinance_inquiry: 'lead',
  dealer_invited: 'lead',
  affiliate_signup: 'lead',
  trade_in_submitted: 'lead',
  saved_search_created: 'lead',
  // A saved-search match notifies an existing buyer that new inventory matched
  // their criteria — it re-engages, it does not advance the funnel (forward-only
  // keeps an active buyer where they are).
  saved_search_matched: 'lead',
  calculator_completed: 'lead',
  exit_intent_captured: 'lead',
  partial_lead_captured: 'lead',
  lead_magnet_downloaded: 'lead',
  zura_conversation_captured: 'lead',

  // Active funnel.
  vehicle_request_submitted: 'prequal_started',
  prequal_started: 'prequal_started',
  deposit_pending: 'deposit_pending',
  deposit_paid: 'deposit_paid',
  auction_started: 'auction_active',
  offer_received: 'offer_received',
  // Selecting / signing happen after an offer exists but before purchase; the
  // closest existing stage is offer_received. Forward-only means these are a
  // no-op once the contact is already at/past offer_received.
  offer_selected: 'offer_received',
  docusign_signed: 'offer_received',
  purchase_completed: 'purchase_completed',

  // Explicit exception — see resolveStageAdvance.
  buyer_inactive: 'inactive',
};

// Returns the stage the contact should move TO for this event, or null when the
// event must not change the stage (a same-or-earlier target). buyer_inactive is
// the lone exception: it may set 'inactive' from any active stage.
export function resolveStageAdvance(
  current: LifecycleStage,
  event: DomainEventType,
): LifecycleStage | null {
  // Explicit exception: a buyer going inactive is set regardless of the rank
  // ladder (it is a sidestep out of the funnel, not a forward step), but never
  // re-written when already inactive.
  if (event === 'buyer_inactive') {
    return current === 'inactive' ? null : 'inactive';
  }

  const target = EVENT_TO_STAGE[event];
  // Forward-only: advance only when the target sits strictly ahead of where the
  // contact already is. Never downgrade.
  return STAGE_RANK[target] > STAGE_RANK[current] ? target : null;
}
