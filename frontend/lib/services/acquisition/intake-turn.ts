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
  /** Create the VehicleRequest + enqueue the durable pipeline (completion). */
  promote: boolean;
  /** Enqueue the durable pipeline for scoring + hot-lead alerts, for an early
   *  contactable lead that has not completed a full request yet. */
  enqueuePipeline: boolean;
  /** Mirror the lead onto the CRM contact plane. */
  crmCapture: boolean;
}

/**
 * Decide the side effects for one chat turn.
 *
 * The durable Inngest pipeline (autolenis/intake.process) owns discovery,
 * enrichment, and hot-lead notifications; the chat only decides WHEN to trigger
 * it. `promote` handles completion (VehicleRequest + enqueue). `enqueuePipeline`
 * handles the earlier moment a lead first becomes contactable, preserving the
 * immediate hot-lead alert the retired inline Stage 4 used to send.
 *
 * Invariant: never both `promote` and `enqueuePipeline` in the same turn —
 * `promote` already enqueues, and two concurrent intake.process events for one
 * opportunity would each clear the pipeline's idempotency guards and double-
 * notify the founder.
 */
export function decideIntakeTurnActions(s: IntakeTurnState): IntakeTurnActions {
  const promote = s.allCaptured && !s.alreadyCompleted;
  const enqueuePipeline = s.phoneJustCaptured && !promote;
  const crmCapture = s.phoneJustCaptured;
  return { promote, enqueuePipeline, crmCapture };
}
