import { logger } from "@/lib/logger";
import twilio from "twilio";

// Shared Twilio SMS sender for one-off transactional messages (e.g. the voice
// receptionist's caller confirmations). Mirrors the lazy client pattern used in
// lib/qstash/notify.ts. Bodies passed in must already contain any required
// "Reply STOP to opt out." disclosure — nothing is appended here.

let _client: ReturnType<typeof twilio> | null = null;
function getTwilioClient(): ReturnType<typeof twilio> | null {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  if (!_client) _client = twilio(sid, token);
  return _client;
}

// Re-exported from lib/utils/phone so existing callers keep working. The
// definition moved there because it is pure and client-reachable, and this
// module is not: importing it from here drags the Twilio SDK along.
export { isValidUsPhone } from "@/lib/utils/phone";

// Send an SMS. Returns true on success. Never throws — send failures and a
// missing Twilio config are logged and swallowed so callers can fire-and-forget.
export async function sendSms(to: string, body: string): Promise<boolean> {
  const from = process.env.TWILIO_FROM_NUMBER;
  const client = getTwilioClient();
  if (!client || !from) {
    logger.warn("[sms/twilio] Twilio not configured — SMS skipped");
    return false;
  }
  try {
    await client.messages.create({ from, to, body });
    return true;
  } catch (err) {
    logger.error("[sms/twilio] send failed:", err);
    return false;
  }
}
