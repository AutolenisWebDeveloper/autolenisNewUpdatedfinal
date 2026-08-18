import { logger } from "@/lib/logger";
import crypto from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import twilio from 'twilio';
import { inngest } from './client';
import { SuppressionService } from '../services/suppression.service';
import { TemplateService } from '../services/template.service';
import { recordTransactionalEmailSend, transactionalEmailAlreadySent } from '../services/email/email-send-log';
import { normalizePhone } from '../utils/phone';
import { prisma } from '../prisma';
import { Prisma } from '@prisma/client';
import type { TemplateVariable, ContactSource } from '../types/crm';

function getSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Lazy-init these clients so module load (e.g. Next.js page-data collection at
// build time) doesn't crash when env vars are absent. They're only invoked
// inside Inngest steps at runtime.
let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

let _twilioClient: ReturnType<typeof twilio> | null = null;
function getTwilio(): ReturnType<typeof twilio> {
  if (!_twilioClient) {
    _twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return _twilioClient;
}

async function acquireIdempotencyGuard(supabase: SupabaseClient, key: string): Promise<boolean> {
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const { error } = await supabase
    .from('idempotency_keys')
    .insert({ key_hash: hash, execution_status: 'processing' });
  // 23505 = unique_violation → another worker already owns this key
  if (error && (error as { code?: string }).code === '23505') return false;
  if (error) throw error;
  return true;
}

async function updateIdempotencyState(
  supabase: SupabaseClient,
  key: string,
  status: 'completed' | 'failed',
  payload: Record<string, unknown> = {}
): Promise<void> {
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  await supabase
    .from('idempotency_keys')
    .update({ execution_status: status, response_payload: payload })
    .eq('key_hash', hash);
}

async function moveJobToDeadLetter(
  supabase: SupabaseClient,
  jobId: string,
  eventName: string,
  payload: unknown,
  errorMessage: string
): Promise<void> {
  await supabase.from('jobs_dead_letter').insert({
    job_id: jobId,
    event_name: eventName,
    payload: payload as Record<string, unknown>,
    error_message: errorMessage,
  });
}

// Inngest v3 exposes attempt count on the function context. The exact name has
// shifted across SDK minor versions, so probe both shapes safely.
function isFinalAttempt(ctx: Record<string, unknown>): boolean {
  const attempt = (ctx.attempt ?? ctx.currentRetry) as number | undefined;
  const max = (ctx.maxAttempt ?? ctx.maxRetries) as number | undefined;
  if (typeof attempt !== 'number' || typeof max !== 'number') return false;
  return attempt >= max;
}

// ---------------------------------------------------------------------------
// EMAIL SEND WORKER — transactional + direct-payload marketing
// Phase 1 deliberately does NOT couple to campaigns/templates (Phase 3).
// ---------------------------------------------------------------------------
export const emailSendFn = inngest.createFunction(
  { id: 'email-send-worker', name: 'Email Dispatcher', retries: 3 },
  { event: 'autolenis/email.send' },
  async (ctx) => {
    const { event, step } = ctx;
    const data = event.data as {
      contactId?: string;
      email: string;
      // Direct payload path — used by ad-hoc admin sends and Phase 1
      // transactional triggers. Phase 3 templated path is below.
      subject?: string;
      html?: string;
      text?: string;
      // Templated path — render via TemplateService at dispatch time.
      templateId?: string;
      templateVariables?: Partial<Record<TemplateVariable | string, string | number | null>>;
      // Campaign integration — when set, the recipient row gets stamped with
      // the resend id so the bounce/complaint webhook can attribute deliveries.
      campaignId?: string;
      campaignRecipientId?: string;
      type?: 'transactional' | 'marketing';
      idempotencyKey?: string;
    };
    const supabase = getSupabase();

    // Transactional lifecycle emails (deal-selected, offers-ready, dealer
    // award/loss…) are migrated from the direct resend rail and MUST keep that
    // rail's semantics: they carry a stable idempotencyKey, no contactId (they
    // record on EmailSendLog only, never contact_timeline_events), and dedup on
    // EmailSendLog's SENT-precheck — which is retriable after a transient
    // failure. The idempotency_keys guard below is insert-once and never
    // released in this worker, so routing transactional sends through it would
    // permanently poison the key after a single first-attempt failure.
    const isTransactional =
      data.type === 'transactional' && !!data.idempotencyKey && !data.contactId;

    const uniqueKey =
      data.idempotencyKey ||
      `${data.contactId ?? data.email}:email_send:${new Date().toISOString().slice(0, 10)}`;

    if (isTransactional) {
      const alreadySent = await step.run('check-email-send-log', async () =>
        transactionalEmailAlreadySent(data.idempotencyKey!)
      );
      if (alreadySent) return { status: 'DUPLICATE_BLOCKED' };
    } else {
      const proceed = await step.run('evaluate-idempotency', async () =>
        acquireIdempotencyGuard(supabase, uniqueKey)
      );
      if (!proceed) return { status: 'DUPLICATE_BLOCKED' };
    }

    try {
      const contact = data.contactId
        ? await step.run('load-contact', async () => {
            const { data: row } = await supabase
              .from('contacts')
              .select('*')
              .eq('id', data.contactId)
              .maybeSingle();
            return row;
          })
        : null;

      if (data.contactId && (!contact || contact.do_not_contact)) {
        await updateIdempotencyState(supabase, uniqueKey, 'completed', {
          reason: 'CONTACT_MISSING_OR_DNC',
        });
        return { status: 'GATED' };
      }

      // Transactional lifecycle emails bypass the marketing/soft suppression
      // tier (a buyer who unsubscribed from MARKETING must still receive their
      // own deal emails) but still honor HARD suppression (bounce / complaint /
      // spam-trap). Marketing sends keep the full lumped check.
      const suppressed = await step.run('check-suppression', async () =>
        data.type === 'transactional'
          ? SuppressionService.isEmailHardSuppressed(supabase, data.email)
          : SuppressionService.isEmailSuppressed(supabase, data.email)
      );
      if (suppressed) {
        if (!isTransactional) {
          await updateIdempotencyState(supabase, uniqueKey, 'completed', { reason: 'SUPPRESSED' });
        }
        return { status: 'SUPPRESSED' };
      }

      if (data.type === 'marketing' && contact && !contact.consent_email) {
        await updateIdempotencyState(supabase, uniqueKey, 'completed', {
          reason: 'NO_MARKETING_EMAIL_CONSENT',
        });
        return { status: 'CONSENT_GATED' };
      }

      // Resolve the actual subject/html/text. Two paths:
      //  - templateId present → render via TemplateService (Phase 3 path)
      //  - else fall back to the direct subject/html payload (Phase 1 path)
      const rendered = await step.run('resolve-content', async () => {
        if (data.templateId) {
          const baseVars: Record<string, string> = {
            firstName: contact?.first_name ?? '',
            lastName: contact?.last_name ?? '',
            fullName: [contact?.first_name, contact?.last_name].filter(Boolean).join(' '),
            supportEmail: process.env.SUPPORT_EMAIL ?? '',
            dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/buyer/dashboard`,
            unsubscribeUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/unsubscribe`,
          };
          const vars = { ...baseVars, ...(data.templateVariables ?? {}) };
          return TemplateService.renderTemplate(supabase, data.templateId, vars);
        }
        if (!data.subject || !data.html) {
          throw new Error('EMAIL_PAYLOAD_INCOMPLETE');
        }
        return {
          subject: data.subject,
          html: data.html,
          text: data.text ?? '',
        };
      });

      const sendResult = await step.run('dispatch-resend', async () => {
        const out = await getResend().emails.send({
          from: process.env.RESEND_FROM_EMAIL!,
          to: data.email,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
          headers: {
            'List-Unsubscribe': `<${process.env.NEXT_PUBLIC_APP_URL}/unsubscribe>`,
          },
        });
        if (out.error) throw new Error(`RESEND_API_EXCEPTION: ${out.error.message}`);
        return out.data;
      });

      if (data.campaignRecipientId) {
        await step.run('update-campaign-recipient', async () => {
          await supabase
            .from('campaign_recipients')
            .update({
              status: 'sent',
              sent_at: new Date().toISOString(),
              resend_id: sendResult?.id ?? null,
            })
            .eq('id', data.campaignRecipientId);
        });
      }

      if (data.contactId) {
        await step.run('log-timeline', async () => {
          await supabase.from('contact_timeline_events').insert({
            contact_id: data.contactId,
            event_type: 'email_sent',
            event_data: {
              resend_id: sendResult?.id,
              subject: rendered.subject,
              template_id: data.templateId ?? null,
              campaign_id: data.campaignId ?? null,
            },
          });
        });
      }

      // S3 — EmailSendLog parity for migrated transactional lifecycle emails.
      // isTransactional guarantees type:'transactional', a stable idempotencyKey,
      // and NO contactId — so the audit row matches exactly what the direct
      // resend rail wrote pre-migration (same key, no duplicate), and because
      // contactId is absent the contact_timeline_events write above is skipped:
      // the send is recorded on exactly ONE plane (EmailSendLog), never
      // double-counted. status defaults to SENT.
      if (isTransactional) {
        await step.run('record-email-send-log', async () =>
          recordTransactionalEmailSend({
            idempotencyKey: data.idempotencyKey!,
            recipient: data.email,
            templateId: data.templateId ?? 'transactional',
            resendId: sendResult?.id ?? null,
          })
        );
      }

      if (!isTransactional) {
        await updateIdempotencyState(supabase, uniqueKey, 'completed', {
          resendId: sendResult?.id,
        });
      }
      return { status: 'SUCCESS', resendId: sendResult?.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isTransactional) {
        // Parity with the direct rail (sendIdempotent): record the failed
        // attempt on EmailSendLog as FAILED — NOT SENT — so the audit trail
        // shows the outage while the SENT-precheck keeps the key retriable on
        // the next Inngest attempt. Best-effort: a logging failure must never
        // mask the real send error that Inngest needs to drive the retry.
        try {
          await recordTransactionalEmailSend({
            idempotencyKey: data.idempotencyKey!,
            recipient: data.email,
            templateId: data.templateId ?? 'transactional',
            status: 'FAILED',
            resendId: null,
          });
        } catch (logErr) {
          logger.error('[email-send-worker] EmailSendLog FAILED write failed', logErr);
        }
      } else {
        await updateIdempotencyState(supabase, uniqueKey, 'failed', { error: message });
        if (isFinalAttempt(ctx as unknown as Record<string, unknown>)) {
          await moveJobToDeadLetter(
            supabase,
            (ctx as unknown as { runId?: string }).runId ?? 'unknown',
            'autolenis/email.send',
            data,
            message
          );
        }
      }
      throw err;
    }
  }
);

// ---------------------------------------------------------------------------
// SMS SEND WORKER — TCPA hard-gated (consent_sms + !do_not_contact)
// ---------------------------------------------------------------------------
export const smsSendFn = inngest.createFunction(
  { id: 'sms-send-worker', name: 'SMS Dispatcher', retries: 3 },
  { event: 'autolenis/sms.send' },
  async (ctx) => {
    const { event, step } = ctx;
    const data = event.data as {
      contactId?: string;
      phone: string;
      body: string;
      idempotencyKey?: string;
    };
    const supabase = getSupabase();
    const standardized = normalizePhone(data.phone);

    if (!standardized) return { status: 'INVALID_PHONE' };

    const uniqueKey =
      data.idempotencyKey ||
      `${data.contactId ?? standardized}:sms_send:${new Date().toISOString().slice(0, 10)}`;

    const proceed = await step.run('evaluate-idempotency', async () =>
      acquireIdempotencyGuard(supabase, uniqueKey)
    );
    if (!proceed) return { status: 'DUPLICATE_BLOCKED' };

    try {
      const contact = data.contactId
        ? await step.run('load-contact', async () => {
            const { data: row } = await supabase
              .from('contacts')
              .select('*')
              .eq('id', data.contactId)
              .maybeSingle();
            return row;
          })
        : null;

      // TCPA hard gate — every SMS path requires explicit consent.
      if (!contact || !contact.consent_sms || contact.do_not_contact) {
        await updateIdempotencyState(supabase, uniqueKey, 'completed', {
          reason: 'TCPA_CONSENT_REJECTED',
        });
        return { status: 'TCPA_GATED' };
      }

      const suppressed = await step.run('check-suppression', async () =>
        SuppressionService.isSmsSuppressed(supabase, standardized)
      );
      if (suppressed) {
        await updateIdempotencyState(supabase, uniqueKey, 'completed', { reason: 'SUPPRESSED' });
        return { status: 'SUPPRESSED' };
      }

      const result = await step.run('dispatch-twilio', async () =>
        getTwilio().messages.create({
          from: process.env.TWILIO_FROM_NUMBER!,
          to: standardized,
          body: `${data.body}\n\nReply STOP to opt out.`,
        })
      );

      if (data.contactId) {
        await step.run('log-timeline', async () => {
          await supabase.from('contact_timeline_events').insert({
            contact_id: data.contactId,
            event_type: 'sms_sent',
            event_data: { twilio_sid: result.sid },
          });
        });
      }

      await updateIdempotencyState(supabase, uniqueKey, 'completed', { sid: result.sid });
      return { status: 'SUCCESS', sid: result.sid };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await updateIdempotencyState(supabase, uniqueKey, 'failed', { error: message });
      if (isFinalAttempt(ctx as unknown as Record<string, unknown>)) {
        await moveJobToDeadLetter(
          supabase,
          (ctx as unknown as { runId?: string }).runId ?? 'unknown',
          'autolenis/sms.send',
          data,
          message
        );
      }
      throw err;
    }
  }
);

// ---------------------------------------------------------------------------
// CAMPAIGN FAN-OUT WORKER
// Triggered by the API after a campaign is created in "send_immediately" mode,
// and by the scheduled-campaign cron when scheduled_at <= now.
//
// Pipeline:
//   1. Load campaign + segment, mark campaign 'running'
//   2. Resolve segment contacts
//   3. Filter suppressed / DNC / missing-channel / no-consent contacts
//   4. Insert campaign_recipients rows in batches of 500 (status='pending')
//   5. Emit individual email.send / sms.send events for each recipient
//   6. Update campaign counters + mark 'completed'
//
// Idempotency: insert into campaign_recipients is UNIQUE(campaign_id, contact_id),
// so a retried fan-out won't double-write recipients. Per-recipient send jobs
// carry an idempotency key of `campaign:{campaign_id}:{contact_id}:{channel}`
// so the email/sms workers also dedupe.
// ---------------------------------------------------------------------------
export const campaignFanoutFn = inngest.createFunction(
  { id: 'campaign-fanout-worker', name: 'Campaign Fan-out', retries: 3, concurrency: 5 },
  { event: 'autolenis/campaign.execute' },
  async (ctx) => {
    const { event, step } = ctx;
    const { campaign_id } = event.data as { campaign_id: string };
    const supabase = getSupabase();

    const { campaign, segment } = await step.run('load-campaign', async () => {
      const { data: c } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', campaign_id)
        .maybeSingle();
      if (!c) throw new Error('CAMPAIGN_NOT_FOUND');
      if (!c.segment_id) throw new Error('CAMPAIGN_NO_SEGMENT');

      const { data: s } = await supabase
        .from('segments')
        .select('*')
        .eq('id', c.segment_id)
        .maybeSingle();
      if (!s) throw new Error('SEGMENT_NOT_FOUND');

      // Only flip to running if we're starting from a runnable state — drafts
      // and scheduled campaigns can both transition; an already-running or
      // completed campaign exits immediately to avoid double-fan-out.
      if (!['draft', 'scheduled', 'paused'].includes(c.status)) {
        throw new Error(`CAMPAIGN_NOT_RUNNABLE: ${c.status}`);
      }
      await supabase
        .from('campaigns')
        .update({ status: 'running', started_at: new Date().toISOString() })
        .eq('id', c.id);

      return { campaign: c, segment: s };
    });

    const contacts = await step.run('resolve-segment-contacts', async () => {
      const { SegmentService } = await import('../services/segment.service');
      return SegmentService.resolveContacts(supabase, segment.conditions);
    });

    // Pre-filter in JS: DNC, missing channel, missing consent. Suppression is
    // checked separately because it's a different table; do it once in batch.
    const { SuppressionService } = await import('../services/suppression.service');

    const needsEmail = campaign.type === 'email' || campaign.type === 'mixed';
    const needsSms = campaign.type === 'sms' || campaign.type === 'mixed';

    const emailCandidates: string[] = [];
    const phoneCandidates: string[] = [];
    for (const c of contacts) {
      if (c.do_not_contact) continue;
      if (needsEmail && c.email && c.consent_email) emailCandidates.push(c.email);
      if (needsSms && c.phone && c.consent_sms) phoneCandidates.push(c.phone);
    }

    const emailSup = await SuppressionService.filterEmailsSuppressed(supabase, emailCandidates);
    const smsSup = await SuppressionService.filterPhonesSuppressed(supabase, phoneCandidates);
    const allowedEmails = new Set(emailSup.allowed);
    const allowedPhones = new Set(smsSup.allowed);

    // Reduce to one row per eligible contact. A mixed-mode contact who can
    // receive both channels generates two send jobs but one recipient row —
    // recipient.status reflects the campaign as a whole, send-level state
    // lives on contact_timeline_events.
    type Reachable = (typeof contacts)[number] & {
      email_ok: boolean;
      sms_ok: boolean;
    };
    const eligible: Reachable[] = [];
    let suppressed_count = 0;
    for (const c of contacts) {
      if (c.do_not_contact) {
        suppressed_count += 1;
        continue;
      }
      const email_ok =
        needsEmail && !!c.email && c.consent_email && allowedEmails.has(c.email);
      const sms_ok =
        needsSms && !!c.phone && c.consent_sms && allowedPhones.has(c.phone);
      if (email_ok || sms_ok) {
        eligible.push({ ...c, email_ok, sms_ok });
      } else {
        suppressed_count += 1;
      }
    }

    // Insert recipients in 500-row batches. UNIQUE(campaign_id, contact_id)
    // collisions are tolerated — a retried fan-out should be idempotent.
    await step.run('insert-recipients', async () => {
      const rows = eligible.map((c) => ({
        campaign_id,
        contact_id: c.id,
        status: 'pending' as const,
      }));
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        await supabase
          .from('campaign_recipients')
          .upsert(batch, { onConflict: 'campaign_id,contact_id', ignoreDuplicates: true });
      }
    });

    // Pull back recipient ids so we can stamp them on send events.
    const recipientByContactId = await step.run('load-recipient-ids', async () => {
      const map: Record<string, string> = {};
      const ids = eligible.map((c) => c.id);
      for (let i = 0; i < ids.length; i += 500) {
        const batch = ids.slice(i, i + 500);
        const { data } = await supabase
          .from('campaign_recipients')
          .select('id, contact_id')
          .eq('campaign_id', campaign_id)
          .in('contact_id', batch);
        for (const row of data ?? []) map[row.contact_id] = row.id;
      }
      return map;
    });

    // Fan-out actual send events. Inngest.sendBatch accepts arrays — batching
    // 100 at a time keeps each network call small without flooding the queue.
    let sent_email = 0;
    let sent_sms = 0;
    await step.run('dispatch-send-events', async () => {
      const emailEvents: { name: string; data: Record<string, unknown> }[] = [];
      const smsEvents: { name: string; data: Record<string, unknown> }[] = [];

      for (const c of eligible) {
        const recipient_id = recipientByContactId[c.id];
        if (c.email_ok) {
          sent_email += 1;
          emailEvents.push({
            name: 'autolenis/email.send',
            data: {
              contactId: c.id,
              email: c.email,
              templateId: campaign.template_id,
              templateVariables: {
                firstName: c.first_name ?? '',
                lastName: c.last_name ?? '',
                fullName: [c.first_name, c.last_name].filter(Boolean).join(' '),
              },
              type: 'marketing',
              campaignId: campaign_id,
              campaignRecipientId: recipient_id,
              idempotencyKey: `campaign:${campaign_id}:${c.id}:email`,
            },
          });
        }
        if (c.sms_ok) {
          sent_sms += 1;
          smsEvents.push({
            name: 'autolenis/sms.send',
            data: {
              contactId: c.id,
              phone: c.phone,
              body: campaign.sms_body,
              campaignId: campaign_id,
              campaignRecipientId: recipient_id,
              idempotencyKey: `campaign:${campaign_id}:${c.id}:sms`,
            },
          });
        }
      }

      const all = [...emailEvents, ...smsEvents];
      for (let i = 0; i < all.length; i += 100) {
        const batch = all.slice(i, i + 100);
        await inngest.send(batch);
      }
    });

    // Finalize counters + mark complete. The send workers update individual
    // recipient rows in flight, so these counters reflect dispatch state, not
    // delivery state. Delivery counters are bumped by the Resend / Twilio
    // webhooks (handled in Phase 1 + the worker stamp added above).
    await step.run('finalize-campaign', async () => {
      await supabase
        .from('campaigns')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          recipient_count: eligible.length,
          sent_count: sent_email + sent_sms,
          suppressed_count,
        })
        .eq('id', campaign_id);
    });

    return {
      status: 'OK',
      campaign_id,
      eligible: eligible.length,
      suppressed: suppressed_count,
      email_dispatched: sent_email,
      sms_dispatched: sent_sms,
    };
  }
);

// ---------------------------------------------------------------------------
// SCHEDULED CAMPAIGN CRON — flips due scheduled campaigns into running
// ---------------------------------------------------------------------------
// Hourly resolution is enough for the platform's send cadence; the scheduling
// UI explicitly notes that the actual send time is "around" the chosen slot.
export const scheduledCampaignCronFn = inngest.createFunction(
  { id: 'scheduled-campaign-cron', name: 'Scheduled Campaign Dispatcher', retries: 1 },
  { cron: '*/5 * * * *' },
  async ({ step }) => {
    const supabase = getSupabase();
    const now = new Date().toISOString();

    const due = await step.run('find-due-campaigns', async () => {
      const { data } = await supabase
        .from('campaigns')
        .select('id')
        .eq('status', 'scheduled')
        .lte('scheduled_at', now)
        .limit(50);
      return data ?? [];
    });

    if (due.length === 0) return { status: 'NO_DUE_CAMPAIGNS' };

    await step.run('enqueue-fanouts', async () => {
      await inngest.send(
        due.map((c) => ({ name: 'autolenis/campaign.execute', data: { campaign_id: c.id } })),
      );
    });

    return { status: 'OK', enqueued: due.length };
  }
);

// ---------------------------------------------------------------------------
// WORKFLOW RESUME WORKER — picks up enrollments suspended by a delay node
// ---------------------------------------------------------------------------
// The engine emits autolenis/workflow.resume with a future ts (= now + delay).
// Inngest holds the event until then, then dispatches it here. The handler
// is a thin shell — all the logic lives in WorkflowEngine so the same code
// path is exercised by initial enrollment and by post-delay resumption.
export const workflowResumeFn = inngest.createFunction(
  { id: 'workflow-resume-worker', name: 'Workflow Resume', retries: 3 },
  { event: 'autolenis/workflow.resume' },
  async (ctx) => {
    const { event, step } = ctx;
    const data = event.data as { enrollment_id: string; node_id: string };
    const supabase = getSupabase();

    // Lazy import — keeps the module graph for the rest of the workers light
    // and avoids pulling workflow.engine into edge-runtime bundles unless a
    // workflow actually resumes.
    const { WorkflowEngine } = await import('../services/workflow.engine');

    try {
      await step.run('resume-enrollment', async () =>
        WorkflowEngine.resumeEnrollment(supabase, data.enrollment_id, data.node_id),
      );
      return { status: 'OK' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isFinalAttempt(ctx as unknown as Record<string, unknown>)) {
        await moveJobToDeadLetter(
          supabase,
          (ctx as unknown as { runId?: string }).runId ?? 'unknown',
          'autolenis/workflow.resume',
          data,
          message,
        );
      }
      throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// INACTIVITY SCANNER — emits buyer_inactive domain events for early-stage contacts
// ---------------------------------------------------------------------------
// Runs hourly; finds contacts in early stages whose updated_at is > 72h ago and
// whose lifecycle hasn't already progressed, capped at 500 per run to bound the
// per-tick cost. Each stale contact is pushed through the domain-event spine
// (emitDomainEvent), which forwards to Make AND drives the legacy in-app engine
// while CRM_INAPP_ENGINE_ENABLED is on — exactly like every other event. The
// spine's lifecycle-advance moves the contact to 'inactive', so it falls out of
// EARLY_STAGES and is never re-emitted on the next run.
export const inactivityScannerFn = inngest.createFunction(
  { id: 'inactivity-scanner', name: 'Inactivity Scanner', retries: 1 },
  { cron: '0 * * * *' }, // hourly on the hour
  async ({ step }) => {
    const supabase = getSupabase();
    const cutoff = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
    const EARLY_STAGES = ['lead', 'prequal_started', 'prequal_completed', 'deposit_pending'];

    const stale = await step.run('find-stale-contacts', async () => {
      const { data } = await supabase
        .from('contacts')
        .select('id, email, phone, first_name, last_name, source')
        .in('lifecycle_stage', EARLY_STAGES)
        .lt('updated_at', cutoff)
        .is('deleted_at', null)
        .eq('do_not_contact', false)
        .limit(500);
      return data ?? [];
    });

    if (stale.length === 0) return { status: 'NO_STALE_CONTACTS' };

    const result = await step.run('emit-buyer-inactive', async () => {
      const { emitDomainEvent } = await import('../events/emit');
      let emitted = 0;
      for (const row of stale) {
        const email = (row.email as string | null) ?? null;
        const phone = (row.phone as string | null) ?? null;
        // emitDomainEvent resolves the contact by email→phone; a row with
        // neither can't be re-resolved without minting a duplicate, and can't
        // be messaged anyway, so skip it.
        if (!email && !phone) continue;
        try {
          await emitDomainEvent('buyer_inactive', {
            domainEntityId: row.id as string,
            supabase,
            contact: {
              email,
              phone,
              firstName: (row.first_name as string | null) ?? undefined,
              lastName: (row.last_name as string | null) ?? undefined,
              // Ignored on update (existing contact); never overwrites the
              // original source. Only used on the impossible insert path.
              source: ((row.source as ContactSource | null) ?? 'import'),
            },
            data: { source: 'inactivity_scanner', scanned_at: new Date().toISOString() },
          });
          emitted++;
        } catch (err) {
          // One contact's failure must not block the rest of the batch.
          logger.error('[inactivity-scanner] emit failed', row.id, err);
        }
      }
      return { emitted };
    });

    return { status: 'OK', scanned: stale.length, emitted: result.emitted };
  },
);

// ---------------------------------------------------------------------------
// SAVED SEARCH MATCHER — emits saved_search_matched when new inventory lands
// ---------------------------------------------------------------------------
// Every 6h, scan each saved search for inventory created since the search's
// last match cursor (lastMatchAt, falling back to the search's createdAt).
// When new matching items exist, push a saved_search_matched domain event
// (forwarded to Make for the "matching vehicle available" alert) and advance
// the per-search cursor so the same items never re-alert. Bounded to 500
// searches per run; per-search failures are isolated.

// Translate a saved search's free-form `filters` JSON into an InventoryItem
// where-clause. Exported so the mapping is unit-testable. Only the keys the
// buyer search UI writes are honored; unknown keys are ignored. Prices are
// stored as dollars in the filter and compared against price_cents.
export function buildInventoryWhereFromFilters(
  filters: Record<string, unknown>,
): Prisma.InventoryItemWhereInput {
  const where: Prisma.InventoryItemWhereInput = {};
  const str = (k: string): string | null => {
    const v = filters[k];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  const num = (k: string): number | null => {
    const v = filters[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
    return null;
  };

  const make = str('make');
  if (make) where.make = { equals: make, mode: 'insensitive' };
  const model = str('model');
  if (model) where.model = { equals: model, mode: 'insensitive' };

  const yearMin = num('yearMin');
  const yearMax = num('yearMax');
  if (yearMin !== null || yearMax !== null) {
    where.year = { ...(yearMin !== null ? { gte: yearMin } : {}), ...(yearMax !== null ? { lte: yearMax } : {}) };
  }

  const priceMin = num('priceMin');
  const priceMax = num('priceMax');
  if (priceMin !== null || priceMax !== null) {
    where.priceCents = {
      ...(priceMin !== null ? { gte: Math.round(priceMin * 100) } : {}),
      ...(priceMax !== null ? { lte: Math.round(priceMax * 100) } : {}),
    };
  }

  const mileageMax = num('mileageMax');
  if (mileageMax !== null) where.mileage = { lte: mileageMax };

  for (const k of ['condition', 'bodyType', 'transmission', 'drivetrain', 'fuelType'] as const) {
    const v = str(k);
    if (v) (where as Record<string, unknown>)[k] = { equals: v, mode: 'insensitive' };
  }

  return where;
}

export const savedSearchMatcherFn = inngest.createFunction(
  { id: 'saved-search-matcher', name: 'Saved Search Matcher', retries: 1 },
  { cron: '0 */6 * * *' },
  async ({ step }) => {
    const supabase = getSupabase();
    const runAt = new Date();

    const searches = await step.run('load-saved-searches', async () => {
      return prisma.savedSearch.findMany({
        take: 500,
        orderBy: { lastMatchAt: { sort: 'asc', nulls: 'first' } },
        include: { buyer: { include: { user: true } } },
      });
    });

    if (searches.length === 0) return { status: 'NO_SAVED_SEARCHES' };

    const result = await step.run('scan-and-emit', async () => {
      const { emitDomainEvent } = await import('../events/emit');
      let alerted = 0;
      let scanned = 0;
      for (const s of searches) {
        scanned++;
        const buyer = s.buyer;
        const email = buyer?.user?.email ?? null;
        const phone = buyer?.phone ?? null;
        // No addressable identity → nothing to notify.
        if (!email && !phone) continue;

        try {
          const filters = (s.filters ?? {}) as Record<string, unknown>;
          const since = s.lastMatchAt ?? s.createdAt;
          const where: Prisma.InventoryItemWhereInput = {
            ...buildInventoryWhereFromFilters(filters),
            isActive: true,
            createdAt: { gt: since },
          };

          const matchCount = await prisma.inventoryItem.count({ where });
          if (matchCount === 0) continue;

          const sample = await prisma.inventoryItem.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: 3,
            select: { id: true, year: true, make: true, model: true, priceCents: true },
          });

          await emitDomainEvent('saved_search_matched', {
            // Vary the key per run so genuinely new matches over time each emit
            // (the lastMatchAt cursor below prevents re-alerting the SAME items).
            domainEntityId: `${s.id}:${runAt.toISOString()}`,
            supabase,
            contact: {
              email,
              phone,
              firstName: buyer?.firstName ?? undefined,
              lastName: buyer?.lastName ?? undefined,
              source: 'saved_search',
            },
            data: {
              saved_search_id: s.id,
              buyer_id: s.buyerId,
              name: s.name,
              match_count: matchCount,
              // `since` is already an ISO string — step.run serializes the
              // loaded rows' Date fields to JSON before this closure sees them.
              since,
              sample,
              zip: buyer?.zip ?? null,
              state: buyer?.state ?? null,
            },
          });

          await prisma.savedSearch.update({
            where: { id: s.id },
            data: { lastMatchAt: runAt, matchCount: { increment: matchCount } },
          });
          alerted++;
        } catch (err) {
          // One search's failure must not block the rest of the batch.
          logger.error('[saved-search-matcher] scan failed', s.id, err);
        }
      }
      return { scanned, alerted };
    });

    return { status: 'OK', ...result };
  },
);

// ---------------------------------------------------------------------------
// ANALYTICS REFRESH — daily REFRESH MATERIALIZED VIEW
// ---------------------------------------------------------------------------
// The lifecycle funnel dashboard reads mv_funnel_metrics (Phase 5). The
// matview is refreshed CONCURRENTLY at 2am every day; that keeps the funnel
// dashboard reading a pre-aggregated surface no matter how large the
// contacts table grows, without blocking concurrent dashboard reads during
// the refresh itself.
export const analyticsRefreshFn = inngest.createFunction(
  { id: 'analytics-refresh', name: 'Analytics Refresh', retries: 2 },
  { cron: '0 2 * * *' },
  async ({ step }) => {
    const supabase = getSupabase();
    const { error } = await step.run('refresh-mv', async () =>
      supabase.rpc('refresh_analytics_views')
    );
    if (error) {
      // Don't dead-letter — the next day's run will pick up the same data.
      // Surface as a structured failure so Inngest's retry policy applies.
      throw new Error(`analytics_refresh_failed: ${error.message}`);
    }
    return { status: 'OK', refreshed_at: new Date().toISOString() };
  },
);

// ---------------------------------------------------------------------------
// LP FORM ABANDONMENT — 3-touch recovery sequence
// ---------------------------------------------------------------------------
// Triggered when a buyer completes Step 1 of the LP form but does not submit
// Step 2 within the recovery window. Each touch re-checks the contact's
// lifecycle stage before sending; once they advance past 'lead' the workflow
// exits cleanly so a converting buyer is never spammed by their own past.
//
// Emails flow through autolenis/email.send so suppression, DNC, and consent
// gates are inherited from the central dispatcher (no direct Resend calls).
function buildLpRecoveryUrl(campaign: string | null | undefined): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? '';
  return `${base}/lp/${campaign || 'default'}?resume=1`;
}

function buildUnsubUrl(email: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? '';
  return `${base}/unsubscribe?email=${encodeURIComponent(email)}`;
}

// Load + render a recovery template by its template_key. Inactive/missing
// rows surface as null so the caller can skip silently (admin disabled it)
// or throw and let Inngest retry (transient DB error or seed not yet applied).
async function renderRecoveryTemplate(
  supabase: SupabaseClient,
  templateKey: string,
  variables: Partial<Record<TemplateVariable | string, string | number | null>>,
): Promise<{ subject: string; html: string; text: string } | null> {
  const template = await TemplateService.getTemplateByKey(supabase, templateKey);
  if (!template) {
    // Missing → seed migration hasn't run or row was deleted. Throw so Inngest
    // retries; a permanently-missing template will dead-letter after 2 retries.
    throw new Error(`recovery_template_missing: ${templateKey}`);
  }
  if (template.status !== 'active') {
    // Inactive → marketing turned it off on purpose. Skip without retrying.
    return null;
  }
  return TemplateService.renderInline(template, variables);
}

export const formAbandonmentFn = inngest.createFunction(
  {
    id: 'lp-form-abandonment',
    name: 'LP Form Abandonment Recovery',
    retries: 2,
  },
  { event: 'autolenis/lead.form_abandoned' },
  async ({ event, step }) => {
    const { contact_id, contact_email, first_name, campaign, idempotency_key } =
      event.data as {
        contact_id: string;
        contact_email: string;
        first_name: string | null;
        campaign: string | null;
        idempotency_key: string;
      };

    const resumeUrl = buildLpRecoveryUrl(campaign);
    const unsubscribeUrl = buildUnsubUrl(contact_email);

    // Wait one hour before the first touch. If the buyer completes Step 2
    // within this window, the next completion-check exits the workflow.
    await step.sleep('wait-before-first-touch', '1h');

    const alreadyCompleted = await step.run('check-completion', async () => {
      const supabase = getSupabase();
      const { data } = await supabase
        .from('contacts')
        .select('lifecycle_stage')
        .eq('id', contact_id)
        .single();
      return data?.lifecycle_stage !== 'lead';
    });
    if (alreadyCompleted) return { status: 'skipped', reason: 'contact_completed_form' };

    await step.run('send-touch-1', async () => {
      const supabase = getSupabase();
      if (await SuppressionService.isEmailSuppressed(supabase, contact_email)) return;
      // firstName defaults to 'There' so the subject stays grammatical when
      // we never captured a name ("There, your auction request is waiting").
      const rendered = await renderRecoveryTemplate(supabase, 'abandonment_touch_1', {
        firstName: first_name ?? 'There',
        resumeUrl,
        unsubscribeUrl,
      });
      if (!rendered) return;
      await inngest.send({
        name: 'autolenis/email.send',
        data: {
          contactId:      contact_id,
          email:          contact_email,
          type:           'marketing',
          subject:        rendered.subject,
          html:           rendered.html,
          text:           rendered.text,
          idempotencyKey: `${idempotency_key}-touch1`,
        },
      });
    });

    await step.sleep('wait-before-second-touch', '23h');

    const completedAfterTouch1 = await step.run('check-completion-2', async () => {
      const supabase = getSupabase();
      const { data } = await supabase
        .from('contacts')
        .select('lifecycle_stage')
        .eq('id', contact_id)
        .single();
      return data?.lifecycle_stage !== 'lead';
    });
    if (completedAfterTouch1) return { status: 'skipped_after_touch1', reason: 'contact_completed_form' };

    await step.run('send-touch-2', async () => {
      const supabase = getSupabase();
      if (await SuppressionService.isEmailSuppressed(supabase, contact_email)) return;
      const rendered = await renderRecoveryTemplate(supabase, 'abandonment_touch_2', {
        firstName: first_name ?? 'There',
        resumeUrl,
        unsubscribeUrl,
      });
      if (!rendered) return;
      await inngest.send({
        name: 'autolenis/email.send',
        data: {
          contactId:      contact_id,
          email:          contact_email,
          type:           'marketing',
          subject:        rendered.subject,
          html:           rendered.html,
          text:           rendered.text,
          idempotencyKey: `${idempotency_key}-touch2`,
        },
      });
    });

    await step.sleep('wait-before-final-touch', '72h');

    const completedAfterTouch2 = await step.run('check-completion-3', async () => {
      const supabase = getSupabase();
      const { data } = await supabase
        .from('contacts')
        .select('lifecycle_stage')
        .eq('id', contact_id)
        .single();
      return data?.lifecycle_stage !== 'lead';
    });
    if (completedAfterTouch2) return { status: 'skipped_after_touch2', reason: 'contact_completed_form' };

    await step.run('send-touch-3', async () => {
      const supabase = getSupabase();
      if (await SuppressionService.isEmailSuppressed(supabase, contact_email)) return;
      const rendered = await renderRecoveryTemplate(supabase, 'abandonment_touch_3', {
        firstName: first_name ?? 'There',
        resumeUrl,
        unsubscribeUrl,
      });
      if (rendered) {
        await inngest.send({
          name: 'autolenis/email.send',
          data: {
            contactId:      contact_id,
            email:          contact_email,
            type:           'marketing',
            subject:        rendered.subject,
            html:           rendered.html,
            text:           rendered.text,
            idempotencyKey: `${idempotency_key}-touch3`,
          },
        });
      }

      // Mark inactive — but only if still 'lead'. A contact who advanced
      // mid-sleep should not be regressed. Runs even when the template is
      // inactive so the lifecycle bookkeeping stays consistent.
      await supabase
        .from('contacts')
        .update({ lifecycle_stage: 'inactive' })
        .eq('id', contact_id)
        .eq('lifecycle_stage', 'lead');
    });

    return { status: 'completed', touches_sent: 3 };
  }
);

// ---------------------------------------------------------------------------
// LP EXIT INTENT NURTURE — single recovery email after a 30-minute delay
// ---------------------------------------------------------------------------
// Lighter than form abandonment because the contact never engaged the form —
// they only submitted an email on the way out. A single nudge respects the
// implied lower intent; the inactivity scanner picks them up after 72h if
// still stuck in 'lead'.
export const exitIntentFn = inngest.createFunction(
  {
    id: 'lp-exit-intent-nurture',
    name: 'LP Exit Intent Nurture',
    retries: 2,
  },
  { event: 'autolenis/lead.exit_intent_captured' },
  async ({ event, step }) => {
    const { contact_id, contact_email, first_name, campaign, idempotency_key } =
      event.data as {
        contact_id: string;
        contact_email: string;
        first_name: string | null;
        campaign: string | null;
        idempotency_key: string;
      };

    const returnUrl = buildLpRecoveryUrl(campaign);
    const unsubscribeUrl = buildUnsubUrl(contact_email);

    await step.sleep('wait-before-exit-touch', '30m');

    const completed = await step.run('check-completion', async () => {
      const supabase = getSupabase();
      const { data } = await supabase
        .from('contacts')
        .select('lifecycle_stage')
        .eq('id', contact_id)
        .single();
      return data?.lifecycle_stage !== 'lead';
    });
    if (completed) return { status: 'skipped', reason: 'completed_form' };

    await step.run('send-exit-recovery', async () => {
      const supabase = getSupabase();
      if (await SuppressionService.isEmailSuppressed(supabase, contact_email)) return;
      const rendered = await renderRecoveryTemplate(supabase, 'exit_intent_recovery', {
        firstName: first_name ?? 'There',
        returnUrl,
        unsubscribeUrl,
      });
      if (!rendered) return;
      await inngest.send({
        name: 'autolenis/email.send',
        data: {
          contactId:      contact_id,
          email:          contact_email,
          type:           'marketing',
          subject:        rendered.subject,
          html:           rendered.html,
          text:           rendered.text,
          idempotencyKey: `${idempotency_key}-recovery`,
        },
      });
    });

    return { status: 'completed' };
  }
);

export const inngestFunctions = [
  emailSendFn,
  smsSendFn,
  campaignFanoutFn,
  scheduledCampaignCronFn,
  workflowResumeFn,
  inactivityScannerFn,
  savedSearchMatcherFn,
  analyticsRefreshFn,
  formAbandonmentFn,
  exitIntentFn,
];
