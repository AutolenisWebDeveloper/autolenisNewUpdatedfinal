import { logger } from '@/lib/logger';
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { prisma } from '@/lib/prisma';
import {
  type ScoringAction,
  pointsForAction,
  temperatureForScore,
  crossedHotThreshold,
} from '@/lib/crm/scoring-actions';

// ---------------------------------------------------------------------------
// LEAD ACTION SCORING SERVICE (Layer 4 + Layer 9)
// ---------------------------------------------------------------------------
// Accrues an action's points onto a contact's cumulative lead_score, re-derives
// the temperature, mirrors it onto the linked Buyer + a LeadScore history row,
// and — when the contact FIRST crosses the HOT threshold — opens a deduped
// priority-outreach CRM task (Layer 9). Every step is isolated and best-effort;
// the function NEVER throws to the caller (it runs inside the event spine and
// behind the dispatch route, neither of which may be blocked by a side effect).
//
// Idempotency: when `idempotencyKey` is supplied the action is recorded at most
// once (partial unique index uq_lead_scoring_events_idem). A duplicate returns
// early WITHOUT re-accruing, so retries and re-fired domain events are safe.

export interface RecordScoringActionInput {
  contactId: string;
  action: ScoringAction;
  source?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RecordScoringActionResult {
  status: 'scored' | 'duplicate' | 'error';
  action: ScoringAction;
  pointsAdded: number;
  score: number;
  temperature: string;
  taskCreated: boolean;
}

async function findBuyerId(supabase: SupabaseClient, contactId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('contact_identities')
      .select('entity_id')
      .eq('contact_id', contactId)
      .eq('entity_type', 'buyer')
      .maybeSingle();
    return (data?.entity_id as string | undefined) ?? null;
  } catch (err) {
    logger.error('[lead-action-scoring] buyer identity lookup failed:', err);
    return null;
  }
}

// Open a priority-outreach task once per hot contact. Deduped on an existing
// open/in-progress task from this source so repeated hot-scoring actions don't
// pile up duplicate tasks. Best-effort.
async function ensurePriorityOutreachTask(
  supabase: SupabaseClient,
  contactId: string,
  score: number,
): Promise<boolean> {
  try {
    const { data: existing } = await supabase
      .from('crm_tasks')
      .select('id')
      .eq('contact_id', contactId)
      .eq('source', 'lead_scoring')
      .in('status', ['open', 'in_progress'])
      .limit(1)
      .maybeSingle();
    if (existing) return false;

    const dueAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(); // 4h SLA
    const { error } = await supabase.from('crm_tasks').insert({
      title: 'Priority outreach — hot lead',
      description: `Lead score crossed the hot threshold (score ${score}). Reach out promptly.`,
      priority: 'urgent',
      status: 'open',
      contact_id: contactId,
      scope: 'contact',
      due_at: dueAt,
      source: 'lead_scoring',
    });
    if (error) {
      logger.error('[lead-action-scoring] priority task insert failed:', error);
      return false;
    }
    await supabase.from('contact_timeline_events').insert({
      contact_id: contactId,
      event_type: 'task_created',
      event_data: { kind: 'priority_outreach', reason: 'hot_threshold_crossed', score },
    });
    return true;
  } catch (err) {
    logger.error('[lead-action-scoring] priority task error:', err);
    return false;
  }
}

export async function recordScoringAction(
  supabase: SupabaseClient,
  input: RecordScoringActionInput,
): Promise<RecordScoringActionResult> {
  const points = pointsForAction(input.action);
  const fail = (): RecordScoringActionResult => ({
    status: 'error',
    action: input.action,
    pointsAdded: 0,
    score: 0,
    temperature: 'cold',
    taskCreated: false,
  });

  // (1) Record the ledger row FIRST so concurrent duplicates are rejected by the
  // unique index before any accrual happens. A 23505 ⇒ this action already
  // accrued; return without double-counting.
  try {
    const { error } = await supabase.from('lead_scoring_events').insert({
      contact_id: input.contactId,
      action: input.action,
      points,
      source: input.source ?? null,
      idempotency_key: input.idempotencyKey ?? null,
      metadata: input.metadata ?? {},
    });
    if (error) {
      if ((error as { code?: string }).code === '23505') {
        return {
          status: 'duplicate',
          action: input.action,
          pointsAdded: 0,
          score: 0,
          temperature: 'cold',
          taskCreated: false,
        };
      }
      logger.error('[lead-action-scoring] ledger insert failed:', error);
      return fail();
    }
  } catch (err) {
    logger.error('[lead-action-scoring] ledger insert threw:', err);
    return fail();
  }

  // (2) Read the current cumulative score off the contacts plane and accrue.
  let priorScore = 0;
  try {
    const { data: contact } = await supabase
      .from('contacts')
      .select('lead_score')
      .eq('id', input.contactId)
      .maybeSingle();
    priorScore = (contact?.lead_score as number | null) ?? 0;
  } catch (err) {
    logger.error('[lead-action-scoring] current score read failed:', err);
  }
  const newScore = priorScore + points;
  const temperature = temperatureForScore(newScore);

  // (3) Persist the cumulative score + temperature on the contacts plane.
  try {
    await supabase
      .from('contacts')
      .update({ lead_score: newScore, lead_temperature: temperature, updated_at: new Date().toISOString() })
      .eq('id', input.contactId);
  } catch (err) {
    logger.error('[lead-action-scoring] contacts plane update failed:', err);
  }

  // (4) Mirror onto the linked Buyer (when one exists) and write a LeadScore
  // history row, matching the /dispatch/score persistence model.
  const buyerId = await findBuyerId(supabase, input.contactId);
  if (buyerId) {
    try {
      await prisma.buyer.update({
        where: { id: buyerId },
        data: { leadScore: newScore, leadTemperature: temperature },
      });
    } catch (err) {
      logger.error('[lead-action-scoring] buyer persist failed:', err);
    }
  }
  try {
    await prisma.leadScore.create({
      data: {
        buyerId: buyerId ?? null,
        sessionId: input.contactId,
        score: newScore,
        temperature,
        signals: { action: input.action, points, source: input.source ?? null },
        reasoning: `+${points} for ${input.action} (cumulative ${newScore})`,
      },
    });
  } catch (err) {
    logger.error('[lead-action-scoring] LeadScore history write failed:', err);
  }

  // (5) CRM timeline reflects the accrual regardless of buyer linkage.
  try {
    await supabase.from('contact_timeline_events').insert({
      contact_id: input.contactId,
      event_type: 'note_added',
      event_data: {
        kind: 'lead_score_action',
        action: input.action,
        points_added: points,
        score: newScore,
        temperature,
        source: input.source ?? null,
      },
    });
  } catch (err) {
    logger.error('[lead-action-scoring] timeline write failed:', err);
  }

  // (6) Layer 9 — open a priority-outreach task the first time this contact
  // crosses the hot threshold.
  let taskCreated = false;
  if (crossedHotThreshold(priorScore, newScore)) {
    taskCreated = await ensurePriorityOutreachTask(supabase, input.contactId, newScore);
  }

  return { status: 'scored', action: input.action, pointsAdded: points, score: newScore, temperature, taskCreated };
}
