import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { normalizePhone } from '@/lib/utils/phone';
import { SuppressionService } from '@/lib/services/suppression.service';
import { isRecipientInQuietHours } from '@/lib/crm/recipient-timezone';

// ---------------------------------------------------------------------------
// MARKETING SMS COMPLIANCE GATE (TCPA) for senders OUTSIDE the contact-centric
// CRM dispatch path — e.g. social market alerts and auction-update nudges that
// only know a phone number. Mirrors the controls in lib/services/sms/crm-sms.ts:
//   1. canonical suppression (sms_suppression — STOP honored everywhere)
//   2. explicit consent + not globally opted out
//   3. recipient-local quiet hours (08:00–21:00; CONUS-safe ET∩PT fallback when
//      location is unknown)
// Fails CLOSED on any lookup error so a transient DB issue never lets a
// non-compliant marketing message through.
// ---------------------------------------------------------------------------

export type SmsGateDecision =
  | { allowed: true; phone: string }
  | { allowed: false; reason: string };

export async function gateMarketingSms(
  supabase: SupabaseClient,
  rawPhone: string,
  loc?: { state?: string | null; zip?: string | null },
): Promise<SmsGateDecision> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { allowed: false, reason: 'invalid_phone' };

  try {
    if (await SuppressionService.isSmsSuppressed(supabase, phone)) {
      return { allowed: false, reason: 'suppressed' };
    }
    const { data: contact } = await supabase
      .from('contacts')
      .select('consent_sms, do_not_contact')
      .eq('phone', phone)
      .is('deleted_at', null)
      .maybeSingle();
    if (!contact || !contact.consent_sms || contact.do_not_contact) {
      return { allowed: false, reason: 'no_consent' };
    }
  } catch (err) {
    logger.error('[sms-gate] suppression/consent lookup failed — failing closed:', err);
    return { allowed: false, reason: 'gate_error' };
  }

  if (isRecipientInQuietHours(new Date(), { state: loc?.state, zip: loc?.zip })) {
    return { allowed: false, reason: 'quiet_hours' };
  }

  return { allowed: true, phone };
}
