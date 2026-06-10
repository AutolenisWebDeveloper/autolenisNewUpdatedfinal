import 'server-only';
import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceSupabase } from '@/lib/supabase-service';
import { ContactService } from '@/lib/services/contact.service';
import type { ContactInput, WorkflowTriggerType } from '@/lib/types/crm';
import { forwardToMake, type DomainEventEnvelope } from './make-webhook';

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
    console.error(`[emit] contact resolve failed for '${event}' (${idempotencyKey})`, err);
    return { contactId: null, idempotencyKey, fired };
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
    console.error(`[emit] timeline write failed for '${event}' (${idempotencyKey})`, err);
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
        console.error(`[emit] detached make forward failed (${idempotencyKey})`, err),
      );
      fired.webhookScheduled = true;
    }
  } else {
    console.warn(
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
      console.error(`[emit] in-app engine trigger failed for '${event}' (${idempotencyKey})`, err);
    }
  }

  // Cutover observability — which downstream path(s) actually fired.
  const paths = [
    fired.webhookScheduled ? 'make' : null,
    fired.inAppEngine ? 'inapp' : null,
  ].filter(Boolean);
  console.info(
    `[emit] '${event}' contact=${contact.id} key=${idempotencyKey} ` +
      `paths=${paths.length ? paths.join('+') : 'none'} fired=${JSON.stringify(fired)}`,
  );
  return { contactId: contact.id, idempotencyKey, fired };
}
