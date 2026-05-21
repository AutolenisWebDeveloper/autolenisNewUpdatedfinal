import crypto from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import twilio from 'twilio';
import { inngest } from './client';
import { SuppressionService } from '../services/suppression.service';
import { normalizePhone } from '../utils/phone';

function getSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const resend = new Resend(process.env.RESEND_API_KEY);
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

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
      subject: string;
      html: string;
      text?: string;
      type?: 'transactional' | 'marketing';
      idempotencyKey?: string;
    };
    const supabase = getSupabase();

    const uniqueKey =
      data.idempotencyKey ||
      `${data.contactId ?? data.email}:email_send:${new Date().toISOString().slice(0, 10)}`;

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

      if (data.contactId && (!contact || contact.do_not_contact)) {
        await updateIdempotencyState(supabase, uniqueKey, 'completed', {
          reason: 'CONTACT_MISSING_OR_DNC',
        });
        return { status: 'GATED' };
      }

      const suppressed = await step.run('check-suppression', async () =>
        SuppressionService.isEmailSuppressed(supabase, data.email)
      );
      if (suppressed) {
        await updateIdempotencyState(supabase, uniqueKey, 'completed', { reason: 'SUPPRESSED' });
        return { status: 'SUPPRESSED' };
      }

      if (data.type === 'marketing' && contact && !contact.consent_email) {
        await updateIdempotencyState(supabase, uniqueKey, 'completed', {
          reason: 'NO_MARKETING_EMAIL_CONSENT',
        });
        return { status: 'CONSENT_GATED' };
      }

      const sendResult = await step.run('dispatch-resend', async () => {
        const out = await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL!,
          to: data.email,
          subject: data.subject,
          text: data.text ?? '',
          html: data.html,
          headers: {
            'List-Unsubscribe': `<${process.env.NEXT_PUBLIC_APP_URL}/unsubscribe>`,
          },
        });
        if (out.error) throw new Error(`RESEND_API_EXCEPTION: ${out.error.message}`);
        return out.data;
      });

      if (data.contactId) {
        await step.run('log-timeline', async () => {
          await supabase.from('contact_timeline_events').insert({
            contact_id: data.contactId,
            event_type: 'email_sent',
            event_data: { resend_id: sendResult?.id, subject: data.subject },
          });
        });
      }

      await updateIdempotencyState(supabase, uniqueKey, 'completed', {
        resendId: sendResult?.id,
      });
      return { status: 'SUCCESS', resendId: sendResult?.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
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
        twilioClient.messages.create({
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

export const inngestFunctions = [emailSendFn, smsSendFn];
