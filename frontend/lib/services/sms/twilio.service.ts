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

// A US number in strict E.164 form: "+1" followed by 10 digits = 12 chars.
export function isValidUsPhone(phone: string | null | undefined): boolean {
  return !!phone && phone.startsWith("+1") && phone.length === 12;
}

// Send an SMS. Returns true on success. Never throws — send failures and a
// missing Twilio config are logged and swallowed so callers can fire-and-forget.
export async function sendSms(to: string, body: string): Promise<boolean> {
  const from = process.env.TWILIO_FROM_NUMBER;
  const client = getTwilioClient();
  if (!client || !from) {
    console.warn("[sms/twilio] Twilio not configured — SMS skipped");
    return false;
  }
  try {
    await client.messages.create({ from, to, body });
    return true;
  } catch (err) {
    console.error("[sms/twilio] send failed:", err);
    return false;
  }
}
