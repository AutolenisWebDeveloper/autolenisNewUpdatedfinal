// lib/services/acquisition/twilio.service.ts
// Outbound SMS helpers for the acquisition flow. The founder hot-lead
// notification is the primary consumer — it MUST never throw out into the
// finder route, since a missed SMS is recoverable but a 500 to the buyer is
// not. Twilio client is built lazily so test environments without creds
// don't fail at import time.

import twilio from "twilio";

export class TwilioSendError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "TwilioSendError";
  }
}

let _client: ReturnType<typeof twilio> | null = null;

function getClient(): ReturnType<typeof twilio> {
  if (_client) return _client;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new TwilioSendError(
      "Twilio credentials are not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)",
    );
  }
  _client = twilio(sid, token);
  return _client;
}

export async function sendSms(to: string, body: string): Promise<string> {
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!from) {
    throw new TwilioSendError("TWILIO_PHONE_NUMBER is not configured");
  }
  try {
    const message = await getClient().messages.create({ from, to, body });
    return message.sid;
  } catch (err) {
    console.error("[twilio.sendSms] failed", { to, err });
    throw new TwilioSendError("Twilio message send failed", err);
  }
}

export interface HotLeadData {
  firstName?: string;
  vehicle: string;
  budget: string;
  timeline: string;
  zip: string;
  score: number;
  sessionId: string;
}

export async function notifyFounderHotLead(lead: HotLeadData): Promise<void> {
  const founderPhone = process.env.FOUNDER_PHONE_NUMBER;
  if (!founderPhone) {
    console.warn("[twilio.notifyFounderHotLead] FOUNDER_PHONE_NUMBER not set — skipping");
    return;
  }
  const name = lead.firstName?.trim() || "New Buyer";
  const body =
    `🔥 HOT LEAD — ${name}\n` +
    `Vehicle: ${lead.vehicle}\n` +
    `Budget: ${lead.budget}\n` +
    `Timeline: ${lead.timeline}\n` +
    `ZIP: ${lead.zip}\n` +
    `Score: ${lead.score}/100\n` +
    `View: https://autolenis.com/admin/buyers`;

  try {
    await sendSms(founderPhone, body);
  } catch (err) {
    // Hot-lead notification is best-effort. Never break scoring on send failure.
    console.error("[twilio.notifyFounderHotLead] send failed", err);
  }
}
