import { logger } from "@/lib/logger";
import 'server-only';
import twilio from 'twilio';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePhone } from '@/lib/utils/phone';
import { SuppressionService } from '@/lib/services/suppression.service';
import { isRecipientInQuietHours } from '@/lib/crm/recipient-timezone';
import type { Contact } from '@/lib/types/crm';

// ---------------------------------------------------------------------------
// HARDENED CRM SMS PATH (Step 4 — /api/crm/dispatch/sms)
// ---------------------------------------------------------------------------
// A NEW module — intentionally separate from lib/services/sms/twilio.service.ts,
// which the voice receptionist and social distribution depend on and must NOT
// change. This path captures a REAL delivery outcome (never a swallowed false)
// and hard-gates on TCPA consent + suppression + quiet hours.
//
// STOP/HELP keyword handling is owned by the inbound Twilio webhook
// (SuppressionService.suppressSms / handleSmsStart) — NOT duplicated here.

// Dedicated lazy client so we never import the voice sender's module.
let _client: ReturnType<typeof twilio> | null = null;
function getClient(): ReturnType<typeof twilio> | null {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  if (!_client) _client = twilio(sid, token);
  return _client;
}

export type CrmSmsFromPool = 'tollfree' | 'local';

export type CrmSmsStatus =
  | 'sent'
  | 'no_consent'
  | 'suppressed'
  | 'quiet_hours'
  | 'invalid_phone'
  | 'not_configured'
  | 'failed';

export interface CrmSmsResult {
  status: CrmSmsStatus;
  sid?: string;
  reason?: string;
}

function selectFrom(pool: CrmSmsFromPool): string | undefined {
  return pool === 'tollfree'
    ? process.env.TWILIO_TOLLFREE_NUMBER
    : process.env.TWILIO_LOCAL_NUMBER;
}

// Send a single CRM SMS with full gating + a verified outcome. The caller
// (dispatch route) records the result to contact_timeline_events + audit.
export async function sendCrmSms(params: {
  supabase: SupabaseClient;
  contact: Pick<Contact, 'id' | 'phone' | 'consent_sms' | 'do_not_contact'>;
  body: string;
  fromPool: CrmSmsFromPool;
  // Recipient location for TCPA quiet-hours derivation (08:00–21:00 LOCAL to the
  // recipient). state is preferred; zip is the fallback; when neither resolves
  // the CONUS-safe intersection (ET ∩ PT) applies. See lib/crm/recipient-timezone.
  state?: string | null;
  zip?: string | null;
  // Reserved for parity with the email path / future Twilio idempotency; the
  // dispatch-auth layer already enforces idempotency at the request boundary.
  idempotencyKey: string;
}): Promise<CrmSmsResult> {
  const { supabase, contact, body, fromPool, state, zip } = params;

  const phone = normalizePhone(contact.phone ?? '');
  if (!phone) return { status: 'invalid_phone' };

  // TCPA hard gate — explicit consent + not globally opted out.
  if (!contact.consent_sms || contact.do_not_contact) {
    return { status: 'no_consent', reason: 'TCPA_CONSENT_REQUIRED' };
  }

  // Suppression — the canonical store is `sms_suppression` (written by the
  // inbound STOP handlers). The Prisma `SmsOptOut` table was read here but has
  // NO writer anywhere, so the check was dead and created false assurance of a
  // second plane (F-014). Removed — `sms_suppression` is the single source of
  // truth that every send path consults.
  try {
    if (await SuppressionService.isSmsSuppressed(supabase, phone)) {
      return { status: 'suppressed', reason: 'sms_suppression' };
    }
  } catch (err) {
    logger.error('[crm-sms] suppression lookup failed — failing closed:', err);
    return { status: 'failed', reason: 'suppression_check_error' };
  }

  // Quiet-hours backstop — local to the RECIPIENT (TCPA), not a global tz.
  if (isRecipientInQuietHours(new Date(), { state, zip })) {
    return { status: 'quiet_hours' };
  }

  const from = selectFrom(fromPool);
  const client = getClient();
  if (!client || !from) {
    return { status: 'not_configured', reason: !from ? `missing_${fromPool}_number` : 'no_twilio' };
  }

  // Capture the REAL outcome. messages.create resolves with a sid + status on
  // acceptance and rejects on failure — we surface both honestly.
  try {
    const message = await client.messages.create({
      from,
      to: phone,
      body: `${body}\n\nReply STOP to opt out.`,
    });
    if (!message.sid) return { status: 'failed', reason: 'no_sid' };
    return { status: 'sent', sid: message.sid };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error('[crm-sms] twilio send failed:', reason);
    return { status: 'failed', reason };
  }
}
