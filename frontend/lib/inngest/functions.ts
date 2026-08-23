import { type SupabaseClient } from '@supabase/supabase-js';
import { inngest } from './client';
import { getSupabase } from './idempotency';
import { SuppressionService } from '../services/suppression.service';
import { TemplateService } from '../services/template.service';
// LP lead-nurture emails ride the internal comms-dispatch queue (comms_outbox),
// not the retired autolenis/email.send Inngest worker.
import { enqueueEmail } from '../services/comms/comms-outbox.service';
import type { TemplateVariable } from '../types/crm';
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
  // Migrated off Inngest and removed from this array so Inngest no longer
  // schedules/handles them:
  //   - analyticsRefreshFn / inactivityScannerFn / savedSearchMatcherFn (Batch 3)
  //   - workflowResumeFn (Batch 5) → workflow-resume-drain cron
  //   - emailSendFn / smsSendFn (Batch 6b) → comms-outbox-drain cron
  //   - campaignFanoutFn / scheduledCampaignCronFn (Batch 8) → campaign-dispatch cron
  // The two LP lead-nurture workers remain on Inngest for now; their per-recipient
  // sends already enqueue to the outbox (migrations #10/#11 will move their triggers).
  formAbandonmentFn,
  exitIntentFn,
];
