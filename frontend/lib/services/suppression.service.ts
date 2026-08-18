import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger';
import { normalizeEmail, normalizePhone } from '../utils/phone';
import type { EmailSuppressionReason, SmsSuppressionReason } from '../types/crm';
import { writeCrmAuditLog, type CrmAuditActor } from './admin/crm-audit';

export class SuppressionService {
  static async isEmailSuppressed(supabase: SupabaseClient, email: string): Promise<boolean> {
    const clean = normalizeEmail(email);
    if (!clean) return true;
    const { data, error } = await supabase
      .from('email_suppression')
      .select('id')
      .eq('email', clean)
      .maybeSingle();
    // Fail closed on a returned (non-thrown) query error. Every caller is a bare
    // `if (suppressed) skip` (bulk campaign send, CRM dispatch route, qstash
    // notify, nurture/lead-magnet sequences, the dealer cold-send wrapper, the
    // marketing branch of the email worker), so returning `true` on a lookup
    // outage skips the send rather than risk cold-emailing a bounced/complained
    // address. Unlike isEmailHardSuppressed (2 callers, both retry/throw-safe),
    // these callers do not handle a throw — a thrown error would 500 routes and
    // abort batches — so this sibling returns `true` instead of throwing.
    if (error) {
      logger.error('[suppression] isEmailSuppressed lookup failed (failing closed):', error);
      return true;
    }
    return !!data;
  }

  // The "hard" email-suppression reasons — bounces, spam complaints, and
  // spam-traps — the same set that flags contacts.do_not_contact (see
  // suppressEmail below). Soft/marketing reasons ('unsubscribed', 'admin_added')
  // are intentionally excluded so TRANSACTIONAL deal emails still reach a buyer
  // who merely opted out of marketing, while a genuinely bad address is blocked.
  static readonly HARD_EMAIL_SUPPRESSION_REASONS: EmailSuppressionReason[] = [
    'bounced',
    'complained',
    'spam_trap',
  ];

  // Reason-aware suppression check for transactional sends: blocks ONLY on a
  // hard reason. email is @unique in email_suppression, so this matches at most
  // one row.
  static async isEmailHardSuppressed(supabase: SupabaseClient, email: string): Promise<boolean> {
    const clean = normalizeEmail(email);
    if (!clean) return true; // unparseable address — fail closed
    const { data, error } = await supabase
      .from('email_suppression')
      .select('id')
      .eq('email', clean)
      .in('reason', SuppressionService.HARD_EMAIL_SUPPRESSION_REASONS)
      .maybeSingle();
    // Fail closed on a returned (non-thrown) query error, but do it LOUDLY: the
    // Supabase client resolves with { data:null, error } instead of throwing, so
    // if we swallowed it and returned a boolean, the transactional email worker
    // would treat a lookup outage as a definitive answer — either sending to a
    // possibly-suppressed address (return false) or silently dropping a
    // legitimate deal email with no retry (return true, status:'SUPPRESSED').
    // Throwing routes it into the worker's existing retry → FAILED-audit / DLQ
    // path (same as a Resend outage), and callers that must fail-closed-and-skip
    // (dealer cold outreach's isSuppressed) already wrap this in try/catch.
    if (error) {
      logger.error('[suppression] isEmailHardSuppressed lookup failed:', error);
      throw new Error(`SUPPRESSION_LOOKUP_FAILED: ${error.message ?? 'unknown error'}`);
    }
    return !!data;
  }

  static async isSmsSuppressed(supabase: SupabaseClient, phone: string): Promise<boolean> {
    const standardized = normalizePhone(phone);
    if (!standardized) return true;
    const { data } = await supabase
      .from('sms_suppression')
      .select('id')
      .eq('phone', standardized)
      .maybeSingle();
    return !!data;
  }

  static async suppressEmail(
    supabase: SupabaseClient,
    email: string,
    reason: EmailSuppressionReason,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    const clean = normalizeEmail(email);
    if (!clean) return;

    // No-downgrade guard: email_suppression holds ONE row per address (onConflict
    // 'email'), so a plain upsert would let a later SOFT reason (unsubscribed /
    // admin_added) overwrite an existing HARD reason (bounced / complained /
    // spam_trap). That would silently un-block transactional deal emails to a
    // genuinely bad address (isEmailHardSuppressed reads `reason`). Hard reasons
    // always win: if the incoming reason is soft and a hard reason is already on
    // file, leave the row untouched.
    const incomingIsHard = SuppressionService.HARD_EMAIL_SUPPRESSION_REASONS.includes(reason);
    if (!incomingIsHard) {
      const { data: existing } = await supabase
        .from('email_suppression')
        .select('reason')
        .eq('email', clean)
        .maybeSingle();
      if (
        existing &&
        SuppressionService.HARD_EMAIL_SUPPRESSION_REASONS.includes(
          existing.reason as EmailSuppressionReason,
        )
      ) {
        return;
      }
    }

    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .eq('email', clean)
      .is('deleted_at', null)
      .maybeSingle();

    await supabase.from('email_suppression').upsert(
      {
        email: clean,
        reason,
        contact_id: contact?.id ?? null,
        metadata,
        suppressed_at: new Date().toISOString(),
      },
      { onConflict: 'email' }
    );

    if (contact?.id) {
      // Hard bounce + complaint also flag do_not_contact; unsub does not (email-only).
      if (reason === 'bounced' || reason === 'complained' || reason === 'spam_trap') {
        await supabase.from('contacts').update({ do_not_contact: true }).eq('id', contact.id);
      }
      await supabase.from('contact_timeline_events').insert({
        contact_id: contact.id,
        event_type: 'email_unsubscribed',
        event_data: { reason, metadata },
      });
    }
  }

  static async unsuppressEmail(
    supabase: SupabaseClient,
    email: string,
    actor: CrmAuditActor
  ): Promise<void> {
    const clean = normalizeEmail(email);
    if (!clean) return;

    const { data: existing } = await supabase
      .from('email_suppression')
      .select('*')
      .eq('email', clean)
      .maybeSingle();

    await supabase.from('email_suppression').delete().eq('email', clean);

    await writeCrmAuditLog(supabase, actor, {
      action: 'UNSUPPRESS_EMAIL',
      entity_type: 'email_suppression',
      entity_id: clean,
      previous_state: existing,
      new_state: null,
    });
  }

  static async suppressSms(
    supabase: SupabaseClient,
    phone: string,
    reason: SmsSuppressionReason
  ): Promise<void> {
    const standardized = normalizePhone(phone);
    if (!standardized) return;

    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .eq('phone', standardized)
      .is('deleted_at', null)
      .maybeSingle();

    await supabase.from('sms_suppression').upsert(
      {
        phone: standardized,
        reason,
        contact_id: contact?.id ?? null,
        suppressed_at: new Date().toISOString(),
      },
      { onConflict: 'phone' }
    );

    if (contact?.id) {
      await supabase.from('contact_timeline_events').insert({
        contact_id: contact.id,
        event_type: 'sms_stopped',
        event_data: { reason },
      });
    }
  }

  // TCPA: STOP must be honored immediately, but START must NOT auto-re-enable
  // sending. The suppression row is preserved (restarted_at stamped) so the
  // audit trail survives, and an admin task is created for manual review.
  static async handleSmsStart(supabase: SupabaseClient, phone: string): Promise<void> {
    const standardized = normalizePhone(phone);
    if (!standardized) return;

    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .eq('phone', standardized)
      .is('deleted_at', null)
      .maybeSingle();

    await supabase
      .from('sms_suppression')
      .update({ restarted_at: new Date().toISOString() })
      .eq('phone', standardized);

    await supabase.from('crm_tasks').insert({
      title: 'TCPA Re-opt-in Review Required',
      description: `${standardized} sent START. Do not resume SMS until consent is manually verified and documented.`,
      priority: 'high',
      status: 'open',
      contact_id: contact?.id ?? null,
      scope: contact?.id ? 'contact' : 'system',
      source: 'sms_start_inbound',
    });

    if (contact?.id) {
      await supabase.from('contact_timeline_events').insert({
        contact_id: contact.id,
        event_type: 'admin_action',
        event_data: { action: 'sms_start_received', phone: standardized },
      });
    }
  }

  static async filterEmailsSuppressed(
    supabase: SupabaseClient,
    emails: string[]
  ): Promise<{ allowed: string[]; suppressed: string[] }> {
    const cleaned = emails.map(normalizeEmail).filter((e): e is string => !!e);
    if (cleaned.length === 0) return { allowed: [], suppressed: [] };

    const { data } = await supabase
      .from('email_suppression')
      .select('email')
      .in('email', cleaned);

    const suppressedSet = new Set((data ?? []).map((r) => r.email));
    const allowed = cleaned.filter((e) => !suppressedSet.has(e));
    const suppressed = cleaned.filter((e) => suppressedSet.has(e));
    return { allowed, suppressed };
  }

  static async filterPhonesSuppressed(
    supabase: SupabaseClient,
    phones: string[]
  ): Promise<{ allowed: string[]; suppressed: string[] }> {
    const cleaned = phones.map((p) => normalizePhone(p)).filter((p) => !!p);
    if (cleaned.length === 0) return { allowed: [], suppressed: [] };

    const { data } = await supabase
      .from('sms_suppression')
      .select('phone')
      .in('phone', cleaned);

    const suppressedSet = new Set((data ?? []).map((r) => r.phone));
    const allowed = cleaned.filter((p) => !suppressedSet.has(p));
    const suppressed = cleaned.filter((p) => suppressedSet.has(p));
    return { allowed, suppressed };
  }
}
