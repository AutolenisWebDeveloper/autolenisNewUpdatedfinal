// lib/crm/reconcile-selection.ts
// PHASE A — pure decision core for the NLLB reconciliation sweep.
// Dependency-free (no next/server, prisma, supabase) so it is unit-testable in
// isolation — mirrors dispatch-auth-decision.ts / dispatch-idempotency.ts.
//
// "Uncovered" (No Lead Left Behind candidate) = a live, contactable contact that
// is NOT in an active campaign, NOT already in re-engagement, and has gone stale
// (or was never contacted). The actual DB filter lives in the route's SQL; this
// module is the single source of truth for the RULE so the SQL and the tests
// agree.

export interface ReconcileContactState {
  do_not_contact: boolean;
  deleted_at: string | null;
  nurture_status: 'none' | 'active' | 'suppressed' | 'reengagement' | string;
  // last verified contact; null = never contacted.
  last_contacted_at: string | null;
  // fallback recency when last_contacted_at is null (e.g. created_at).
  created_at: string;
}

export interface ReconcileOptions {
  now: Date;
  staleDays: number; // N — contact is stale if last activity older than this.
}

// Returns true iff the contact should be enrolled into a re-engagement sweep.
// Order of checks is deliberate (cheapest exclusions first) and each is the
// negation of a "covered/uncontactable" state.
export function isUncovered(
  c: ReconcileContactState,
  opts: ReconcileOptions,
): boolean {
  if (c.deleted_at) return false;            // soft-deleted → never
  if (c.do_not_contact) return false;        // hard opt-out → never
  if (c.nurture_status === 'active') return false;        // already covered
  if (c.nurture_status === 'reengagement') return false;  // already being re-engaged
  if (c.nurture_status === 'suppressed') return false;    // explicitly held out

  const cutoff = opts.now.getTime() - opts.staleDays * 24 * 60 * 60 * 1000;
  const lastTouch = c.last_contacted_at ?? c.created_at; // fallback to created_at
  const lastTouchMs = Date.parse(lastTouch);
  if (Number.isNaN(lastTouchMs)) return true; // unparseable → treat as never-contacted
  return lastTouchMs < cutoff;               // stale → uncovered
}

// Deterministic idempotency key so the same contact swept on the same UTC day
// collapses across retries / overlapping cron runs. day-bucketed so a contact
// can be re-swept on a later day if still uncovered.
export function reengageIdempotencyKey(contactId: string, now: Date): string {
  const day = now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  return `reengagement_sweep:${contactId}:${day}`;
}

// Build the signed-envelope payload the Router consumes. event is a free string
// on DomainEventEnvelope (make-webhook.ts:31), so this needs NO change to the
// typed DomainEventType union — the Router maps 'reengagement_sweep' → the
// re-engagement campaign.
export interface ReengageEnvelopeContact {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  consentEmail: boolean;
  consentSms: boolean;
  lifecycleStage: string;
}

export function buildReengageEnvelope(
  contact: ReengageEnvelopeContact,
  meta: { now: Date; staleDays: number; job: string },
) {
  return {
    event: 'reengagement_sweep' as const,
    version: 1 as const,
    idempotencyKey: reengageIdempotencyKey(contact.id, meta.now),
    occurredAt: meta.now.toISOString(),
    contact,
    data: { reason: 'nllb_coverage_backfill', job: meta.job, stale_days: meta.staleDays },
  };
}
