// A′ — pure decision for what side effects one concierge (Zura) chat turn should
// trigger. Kept dependency-free so the streaming route stays thin and the
// race-sensitive enqueue rule is unit-testable in isolation.

export interface IntakeTurnState {
  /** A full, sourceable request has been captured this session. */
  allCaptured: boolean;
  /** The opportunity was already marked completed before this turn. */
  alreadyCompleted: boolean;
  /** Phone transitioned null → value on this turn (a newly contactable lead). */
  phoneJustCaptured: boolean;
}

export interface IntakeTurnActions {
  /** Create the sourceable VehicleRequest (completion). */
  promote: boolean;
  /** Mirror the lead onto the CRM contact plane. */
  crmCapture: boolean;
}

/**
 * Decide the side effects for one chat turn.
 *
 * Buyer-intake orchestration (discovery, enrichment, hot-lead notifications) is
 * Inngest-free and is run by the intake-reconcile cron (processBuyerOpportunityIntake)
 * off the persisted BuyerOpportunity — the chat never triggers it directly. So the
 * turn only decides two things: `promote` (create the VehicleRequest once a full
 * request has been captured) and `crmCapture` (mirror a newly contactable lead onto
 * the CRM contact plane). The row's intakeProcessedAt IS NULL makes the cron pick it
 * up; no per-turn enqueue means there is nothing for the cron to race with.
 */
export function decideIntakeTurnActions(s: IntakeTurnState): IntakeTurnActions {
  const promote = s.allCaptured && !s.alreadyCompleted;
  const crmCapture = s.phoneJustCaptured;
  return { promote, crmCapture };
}
