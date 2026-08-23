import { type SupabaseClient } from '@supabase/supabase-js';
import { inngest } from './client';
import { getSupabase } from './idempotency';
import { SuppressionService } from '../services/suppression.service';
import { TemplateService } from '../services/template.service';
// Per-recipient sends now ride the internal comms-dispatch queue (comms_outbox),
// not the retired autolenis/email.send + autolenis/sms.send Inngest workers.
import { enqueueEmail, enqueueSms } from '../services/comms/comms-outbox.service';
import type { TemplateVariable } from '../types/crm';

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

    // Fan-out per-recipient sends onto the internal comms-dispatch queue. Each
    // enqueue is dedup'd on its stable idempotencyKey (campaign:{id}:{contact}:
    // {channel}) → a retried fan-out never double-enqueues, and the outbox drain
    // applies the same consent/DNC/suppression/TCPA gates the workers did.
    let sent_email = 0;
    let sent_sms = 0;
    await step.run('dispatch-send-events', async () => {
      for (const c of eligible) {
        const recipient_id = recipientByContactId[c.id];
        if (c.email_ok) {
          sent_email += 1;
          await enqueueEmail({
            contactId: c.id,
            // email_ok guarantees a non-null email (see the eligibility filter).
            email: c.email!,
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
          });
        }
        if (c.sms_ok) {
          sent_sms += 1;
          await enqueueSms({
            contactId: c.id,
            // sms_ok guarantees a non-null phone (see the eligibility filter).
            phone: c.phone!,
            body: campaign.sms_body,
            campaignId: campaign_id,
            campaignRecipientId: recipient_id,
            idempotencyKey: `campaign:${campaign_id}:${c.id}:sms`,
          });
        }
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

// WORKFLOW RESUME WORKER — MIGRATED (Batch 5) off Inngest onto the internal
// Vercel-Cron substrate. The WorkflowEngine delay node now persists durable
// resume state (workflow_enrollments.resume_at/resume_node_id) and the
// `workflow-resume-drain` cron (app/api/cron/workflow-resume-drain →
// lib/services/crm/workflow-resume-drain.service.ts) re-enters
// WorkflowEngine.resumeEnrollment when it falls due. No Inngest event remains.

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
      await enqueueEmail({
        contactId:      contact_id,
        email:          contact_email,
        type:           'marketing',
        subject:        rendered.subject,
        html:           rendered.html,
        text:           rendered.text,
        idempotencyKey: `${idempotency_key}-touch1`,
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
      await enqueueEmail({
        contactId:      contact_id,
        email:          contact_email,
        type:           'marketing',
        subject:        rendered.subject,
        html:           rendered.html,
        text:           rendered.text,
        idempotencyKey: `${idempotency_key}-touch2`,
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
        await enqueueEmail({
          contactId:      contact_id,
          email:          contact_email,
          type:           'marketing',
          subject:        rendered.subject,
          html:           rendered.html,
          text:           rendered.text,
          idempotencyKey: `${idempotency_key}-touch3`,
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
      await enqueueEmail({
        contactId:      contact_id,
        email:          contact_email,
        type:           'marketing',
        subject:        rendered.subject,
        html:           rendered.html,
        text:           rendered.text,
        idempotencyKey: `${idempotency_key}-recovery`,
      });
    });

    return { status: 'completed' };
  }
);

export const inngestFunctions = [
  campaignFanoutFn,
  scheduledCampaignCronFn,
  // Migrated off Inngest and removed from this array so Inngest no longer
  // schedules/handles them:
  //   - analyticsRefreshFn / inactivityScannerFn / savedSearchMatcherFn (Batch 3)
  //   - workflowResumeFn (Batch 5) → workflow-resume-drain cron
  //   - emailSendFn / smsSendFn (Batch 6b) → comms-outbox-drain cron
  //     (every email.send/sms.send emitter now calls enqueueEmail/enqueueSms).
  // campaignFanoutFn / scheduledCampaignCronFn / formAbandonmentFn / exitIntentFn
  // remain on Inngest for now; their per-recipient sends already enqueue to the
  // outbox (migrations #4/#5/#10/#11 will move their triggers next).
  formAbandonmentFn,
  exitIntentFn,
];
