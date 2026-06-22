import 'server-only';
import { logger } from '@/lib/logger';
import { sendSms } from '@/lib/services/sms/twilio.service';
import { SuppressionService } from '@/lib/services/suppression.service';
import { getServiceSupabase } from '@/lib/supabase-service';

// Suppression-gated transactional SMS for the voice receptionist (F-015).
//
// The raw `sendSms` sender in twilio.service.ts has NO suppression check, so a
// caller-initiated confirmation text would still go out to a number that had
// previously replied STOP. TCPA/CTIA require STOP to be honored on every send,
// on every channel — even transactional ones. This wrapper consults the
// canonical `sms_suppression` store (the single source of truth, see
// SuppressionService.isSmsSuppressed) before delegating to `sendSms`.
//
// Fail-closed: if the suppression lookup errors we DO NOT send, because sending
// to a possibly-suppressed number is the worse outcome. Never throws — callers
// fire-and-forget.
export async function sendTransactionalSmsIfAllowed(
  to: string,
  body: string,
): Promise<boolean> {
  try {
    const supabase = getServiceSupabase();
    if (await SuppressionService.isSmsSuppressed(supabase, to)) {
      logger.info('[voice/transactional-sms] suppressed — STOP on file, not sending', { to });
      return false;
    }
  } catch (err) {
    logger.error('[voice/transactional-sms] suppression check failed — failing closed', err);
    return false;
  }
  return sendSms(to, body);
}
