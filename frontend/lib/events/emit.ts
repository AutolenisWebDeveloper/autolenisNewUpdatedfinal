import { logger } from "@/lib/logger";
import 'server-only';
import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceSupabase } from '@/lib/supabase-service';
import { ContactService } from '@/lib/services/contact.service';
import type { ContactInput, WorkflowTriggerType } from '@/lib/types/crm';
import { forwardToMake, type DomainEventEnvelope } from './make-webhook';
import { resolveStageAdvance } from './lifecycle-advance';
import { recordScoringAction } from '@/lib/services/crm/lead-action-scoring.service';
import type { ScoringAction } from '@/lib/crm/scoring-actions';

// Layer 4 — map the domain events that correspond to a scored behavior onto the
// spec's scoring actions. Events with no behavioral score (signups, reminders,
// admin/dealer/affiliate lifecycle) are intentionally absent. Front-end-only
// signals (landing_page_visit, article_read, offer_favorite) have no domain
// event and are reported directly via POST /api/crm/dispatch/track.
const EVENT_TO_SCORING_ACTION: Partial<Record<DomainEventType, ScoringAction>> = {
  vehicle_request_submitted: 'vehicle_request',
  saved_search_created: 'vehicle_search',
  calculator_completed: 'calculator_use',
  zura_conversation_captured: 'zura_conversation',
  lead_magnet_downloaded: 'article_read',
  offer_received: 'offer_view',
  offer_selected: 'offer_accepted',
  purchase_completed: 'deal_completed',
};

// ---------------------------------------------------------------------------
// DOMAIN EVENT EMITTER (Step 2)
// ---------------------------------------------------------------------------
// The single seam AutoLenis calls on a lifecycle event. It:
//   1. resolves/upserts the CRM contact (email→phone dedup already in
//      ContactService),
//   2. builds a versioned, idempotency-keyed envelope,
//   3. records a contact_timeline_events row,
//   4. forwards the envelope to Make.com NON-BLOCKING (after()),
//   5. OPTIONALLY also drives the legacy in-app engine while
//      CRM_INAPP_ENGINE_ENABLED === 'true' (cutover flag, default OFF).
//
// Every side effect is isolated — one failure never blocks the others, and the
// function NEVER throws to the caller (lifecycle writes must already be safe).

// The emittable events = workflow triggers minus the human-initiated 'manual'.
export type DomainEventType = Exclude<WorkflowTriggerType, 'manual'>;

export interface EmitDomainEventInput {
  // Stable id of the domain entity this event is about (buyerId, affiliateId,
  // invitationId, leadId, vehicleRequestId/contactId…). Drives the
  // idempotency key so the same logical event collapses across retries.
  domainEntityId: string;
  // Contact resolution input — passed straight to ContactService.upsertContact
  // (it dedupes by email then phone and merges consent upward).
  contact: ContactInput;
  // Domain-specific fields surfaced to Make scenarios.
  data?: Record<string, unknown>;
  // Optional pre-resolved Supabase client (reuse the caller's). Defaults to the
  // service-role client.
  supabase?: SupabaseClient;
}

export interface EmitDomainEventResult {
  contactId: string | null;
  idempotencyKey: string;
  // Which side effects actually fired (for observability / tests).
  fired: {
    timeline: boolean;
    webhookScheduled: boolean;
    inAppEngine: boolean;
  };
}

export async function emitDomainEvent(
  event: DomainEventType,
  input: EmitDomainEventInput,
): Promise<EmitDomainEventResult> {
  const idempotencyKey = `${event}:${input.domainEntityId}`;
  const fired = { timeline: false, webhookScheduled: false, inAppEngine: false };

  const supabase = input.supabase ?? getServiceSupabase();

  // (1) Resolve/upsert the contact. If this fails we cannot build a meaningful
  // envelope, so we log and bail — but still never throw to the caller.
  let contact: Awaited<ReturnType<typeof ContactService.upsertContact>> | null = null;
  try {
    contact = await ContactService.upsertContact(supabase, input.contact);
  } catch (err) {
    logger.error(`[emit] contact resolve failed for '${event}' (${idempotencyKey})`, err);
    return { contactId: null, idempotencyKey, fired };
  }

  // (1b) Forward-only lifecycle advance. The spine is the single place the
  // funnel stage moves on a domain event. Mirrors the lead-score
  // never-downgrade rule: an event may push the contact further along the
  // funnel but NEVER back to an earlier stage (ranking = the LifecycleStage
  // union's declared order; buyer_inactive is the lone exception that may set
  // 'inactive'). A stage_changed timeline row is written ONLY on a real
  // advance. Best-effort and isolated: a failure here never blocks the
  // envelope, timeline, or webhook.
  try {
    const advancedStage = resolveStageAdvance(contact.lifecycle_stage, event);
    if (advancedStage) {
      const previousStage = contact.lifecycle_stage;
      const { error } = await supabase
        .from('contacts')
        .update({ lifecycle_stage: advancedStage, updated_at: new Date().toISOString() })
        .eq('id', contact.id);
      if (error) {
        logger.error(`[emit] stage advance failed for '${event}' (${idempotencyKey})`, error);
      } else {
        // Keep the in-memory contact (and thus the envelope below) consistent
        // with the persisted stage.
        contact.lifecycle_stage = advancedStage;
        await supabase.from('contact_timeline_events').insert({
          contact_id: contact.id,
          event_type: 'stage_changed',
          event_data: { from: previousStage, to: advancedStage, via: event },
        });
      }
    }
  } catch (err) {
    logger.error(`[emit] stage advance error for '${event}' (${idempotencyKey})`, err);
  }

  // (2) Build the versioned envelope.
  const envelope: DomainEventEnvelope = {
    event,
    version: 1,
    idempotencyKey,
    occurredAt: new Date().toISOString(),
    contact: {
      id: contact.id,
      email: contact.email,
      phone: contact.phone,
      firstName: contact.first_name,
      lastName: contact.last_name,
      consentEmail: contact.consent_email,
      consentSms: contact.consent_sms,
      lifecycleStage: contact.lifecycle_stage,
    },
    data: input.data ?? {},
  };

  // (3) Timeline row — the local, durable record that the event happened.
  try {
    await supabase.from('contact_timeline_events').insert({
      contact_id: contact.id,
      event_type: 'domain_event',
      event_data: envelope as unknown as Record<string, unknown>,
    });
    fired.timeline = true;
  } catch (err) {
    logger.error(`[emit] timeline write failed for '${event}' (${idempotencyKey})`, err);
  }

  // (3b) Lead scoring — accrue the action's points when this event maps to a
  // scored behavior. Idempotency is bound to the event key so the same domain
  // event scores exactly once across retries. Isolated + best-effort.
  const scoringAction = EVENT_TO_SCORING_ACTION[event];
  if (scoringAction) {
    try {
      await recordScoringAction(supabase, {
        contactId: contact.id,
        action: scoringAction,
        source: `emit:${event}`,
        idempotencyKey,
      });
    } catch (err) {
      logger.error(`[emit] lead scoring failed for '${event}' (${idempotencyKey})`, err);
    }
  }

  // (4) Outbound webhook — non-blocking. Prefer Vercel after() so it runs after
  // the response flushes; if we're already outside a request scope (e.g. nested
  // inside another after()), fall back to a detached promise. When
  // MAKE_WEBHOOK_URL is unset we WARN (never silently swallow) so a prod
  // misconfig is visible in logs.
  if (process.env.MAKE_WEBHOOK_URL) {
    try {
      after(() => forwardToMake(envelope));
      fired.webhookScheduled = true;
    } catch {
      void forwardToMake(envelope).catch((err) =>
        logger.error(`[emit] detached make forward failed (${idempotencyKey})`, err),
      );
      fired.webhookScheduled = true;
    }
  } else {
    logger.warn(
      `[emit] MAKE_WEBHOOK_URL unset — '${event}' (${idempotencyKey}) NOT forwarded to Make`,
    );
  }

  // (5) Legacy in-app engine — only while the cutover flag is on, so the
  // existing workflows keep running during transition WITHOUT double-sending
  // once Make scenarios own the sends.
  if (process.env.CRM_INAPP_ENGINE_ENABLED === 'true') {
    try {
      const { WorkflowEngine } = await import('@/lib/services/workflow.engine');
      await WorkflowEngine.triggerForEvent(
        supabase,
        event as WorkflowTriggerType,
        contact.id,
        { ...(input.data ?? {}), source: 'emit' },
      );
      fired.inAppEngine = true;
    } catch (err) {
      logger.error(`[emit] in-app engine trigger failed for '${event}' (${idempotencyKey})`, err);
    }
  }

  // Cutover observability — which downstream path(s) actually fired.
  const paths = [
    fired.webhookScheduled ? 'make' : null,
    fired.inAppEngine ? 'inapp' : null,
  ].filter(Boolean);
  logger.info(
    `[emit] '${event}' contact=${contact.id} key=${idempotencyKey} ` +
      `paths=${paths.length ? paths.join('+') : 'none'} fired=${JSON.stringify(fired)}`,
  );
  return { contactId: contact.id, idempotencyKey, fired };
}
