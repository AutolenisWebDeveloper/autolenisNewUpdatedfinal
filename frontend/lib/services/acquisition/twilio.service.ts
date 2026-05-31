// lib/services/acquisition/twilio.service.ts
// Outbound SMS for the acquisition flow.
//   - sendSms: low-level Twilio wrapper
//   - notifyFounderHotLead: founder-facing hot-lead alert (templated)
//   - sendHotLeadBuyerSms: buyer-facing first-contact SMS, drafted by
//     Claude Haiku — this is the conversion moment. The Anthropic call
//     happens via direct fetch (we don't import the SDK to keep the
//     bundle small); on any failure we fall back to a deterministic
//     template so the buyer ALWAYS receives a text.

import twilio from "twilio";

export class TwilioSendError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "TwilioSendError";
  }
}

const getClient = () =>
  twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);

export interface HotLeadData {
  firstName?: string;
  vehicle: string;
  budget: string;
  timeline: string;
  zip: string;
  score: number;
  sessionId: string;
  phone: string;
}

export async function sendSms(to: string, body: string): Promise<string> {
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!from) {
    throw new TwilioSendError("TWILIO_PHONE_NUMBER is not configured");
  }
  try {
    const msg = await getClient().messages.create({ from, to, body });
    return msg.sid;
  } catch (err) {
    console.error("[twilio.sendSms] failed", { to, err });
    throw new TwilioSendError("Twilio message send failed", err);
  }
}

// ─── Founder hot-lead alert ──────────────────────────────────────────────────
export async function notifyFounderHotLead(lead: HotLeadData): Promise<void> {
  const founderPhone = process.env.FOUNDER_PHONE_NUMBER;
  if (!founderPhone) {
    console.warn(
      "[twilio.notifyFounderHotLead] FOUNDER_PHONE_NUMBER not set — skipping",
    );
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
    // Best-effort — never break the scoring flow.
    console.error("[twilio.notifyFounderHotLead] send failed", err);
  }
}

// ─── Buyer first-contact SMS (Claude Haiku) ──────────────────────────────────
// THIS IS THE MOST IMPORTANT MESSAGE IN PHASE 1.
// It must always send. On any Anthropic failure we fall through to the
// deterministic template — the buyer never gets silence.

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
}

function buildFallbackBuyerSms(lead: HotLeadData): string {
  const name = lead.firstName?.trim() || "there";
  const vehicle = lead.vehicle || "vehicle";
  const zip = lead.zip || "you";
  return `Hi ${name}! Your ${vehicle} auction is almost ready. Up to 8 dealers near ${zip} will compete for your business. Activate now: autolenis.com`;
}

async function draftBuyerSmsWithClaude(lead: HotLeadData): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn(
      "[twilio.sendHotLeadBuyerSms] ANTHROPIC_API_KEY not set — using fallback",
    );
    return null;
  }

  const name = lead.firstName?.trim() || "there";
  const userPrompt = `Write the first-contact SMS for:
Name: ${name}
Vehicle: ${lead.vehicle}
Budget: ${lead.budget}
Timeline: ${lead.timeline}
ZIP: ${lead.zip}`;

  const system = `You write short, warm, conversion-focused SMS messages for AutoLenis — a premium car buying service where verified dealers compete for the buyer's business in a private 48-hour reverse auction. The buyer just told us what they want. Write a first SMS that:
- Feels personal and human, not robotic
- Creates genuine excitement about dealers competing for their specific vehicle
- Ends with one clear call to action to activate their refundable $99 auction deposit
- Is under 160 characters total
- Never mentions AI
- Never uses exclamation marks more than once`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 160,
        system,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[twilio.sendHotLeadBuyerSms] anthropic HTTP error", {
        status: res.status,
        detail: detail.slice(0, 300),
      });
      return null;
    }

    const data = (await res.json()) as AnthropicResponse;
    const text = data.content?.find((b) => b.type === "text")?.text?.trim();
    return text && text.length > 0 ? text : null;
  } catch (err) {
    console.error("[twilio.sendHotLeadBuyerSms] anthropic call failed", err);
    return null;
  }
}

export async function sendHotLeadBuyerSms(lead: HotLeadData): Promise<void> {
  if (!lead.phone) {
    console.warn("[twilio.sendHotLeadBuyerSms] no buyer phone — skipping");
    return;
  }

  const claudeMessage = await draftBuyerSmsWithClaude(lead);
  const message = claudeMessage ?? buildFallbackBuyerSms(lead);

  try {
    await sendSms(lead.phone, message);
  } catch (err) {
    // We've already exhausted the AI fallback — log and swallow so the
    // finder flow returns 200 to the buyer regardless.
    console.error("[twilio.sendHotLeadBuyerSms] final send failed", err);
  }
}
