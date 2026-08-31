// lib/services/acquisition/twilio.service.ts
// Outbound SMS for the acquisition flow.
//   - sendSms: low-level Twilio wrapper
//   - notifyFounderHotLead: founder-facing hot-lead alert (templated)
//   - sendHotLeadBuyerSms: buyer-facing first-contact SMS, drafted by
//     Claude Haiku — this is the conversion moment. The Anthropic call
//     happens via direct fetch (we don't import the SDK to keep the
//     bundle small); on any failure we fall back to a deterministic
//     template so the buyer ALWAYS receives a text.

import { logger } from "@/lib/logger";
import twilio from "twilio";
import { normalizePhone } from "@/lib/utils/phone";
import { SuppressionService } from "@/lib/services/suppression.service";
import { getServiceSupabase } from "@/lib/supabase-service";
import { complete } from "@/lib/ai/provider";

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
    logger.error("[twilio.sendSms] failed", { to, err });
    throw new TwilioSendError("Twilio message send failed", err);
  }
}

// ─── Founder hot-lead alert ──────────────────────────────────────────────────
export async function notifyFounderHotLead(lead: HotLeadData): Promise<void> {
  const founderPhone = process.env.FOUNDER_PHONE_NUMBER;
  if (!founderPhone) {
    logger.warn(
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
    logger.error("[twilio.notifyFounderHotLead] send failed", err);
  }
}

// ─── Buyer first-contact SMS (Claude Haiku) ──────────────────────────────────
// THIS IS THE MOST IMPORTANT MESSAGE IN PHASE 1.
// It must always send. On any Anthropic failure we fall through to the
// deterministic template — the buyer never gets silence.


function buildFallbackBuyerSms(lead: HotLeadData): string {
  const name = lead.firstName?.trim() || "there";
  const vehicle = lead.vehicle || "vehicle";
  const zip = lead.zip || "you";
  return `Hi ${name}! Your ${vehicle} auction is almost ready. Up to 8 dealers near ${zip} will compete for your business. Activate now: autolenis.com`;
}

async function draftBuyerSmsWithClaude(lead: HotLeadData): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.warn(
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
- Ends with one clear call to action to activate their $99 auction deposit
- Is under 160 characters total
- Never mentions AI
- Never uses exclamation marks more than once`;

  try {
    // Transport only — model, system prompt, user prompt and token cap
    // unchanged. Routing through the provider chokepoint is what brings the
    // Anthropic path under the AI kill switch.
    const result = await complete({
      purpose: "acquisition.hot_lead_buyer_sms",
      model: "claude-haiku-4-5",
      maxTokens: 160,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
    });
    const text = result.content.trim();
    return text.length > 0 ? text : null;
  } catch (err) {
    logger.error("[twilio.sendHotLeadBuyerSms] anthropic call failed", err);
    return null;
  }
}

export async function sendHotLeadBuyerSms(lead: HotLeadData): Promise<void> {
  if (!lead.phone) {
    logger.warn("[twilio.sendHotLeadBuyerSms] no buyer phone — skipping");
    return;
  }

  // TCPA: a STOP must be honored even on this transactional first-contact send.
  // Check the canonical suppression store; fail closed on lookup error so a
  // suppressed number can never be messaged.
  try {
    const normalized = normalizePhone(lead.phone) ?? lead.phone;
    if (await SuppressionService.isSmsSuppressed(getServiceSupabase(), normalized)) {
      logger.info("[twilio.sendHotLeadBuyerSms] recipient suppressed — skipping");
      return;
    }
  } catch (err) {
    logger.error("[twilio.sendHotLeadBuyerSms] suppression check failed — skipping:", err);
    return;
  }

  const claudeMessage = await draftBuyerSmsWithClaude(lead);
  const message = claudeMessage ?? buildFallbackBuyerSms(lead);

  try {
    await sendSms(lead.phone, message);
  } catch (err) {
    // We've already exhausted the AI fallback — log and swallow so the
    // finder flow returns 200 to the buyer regardless.
    logger.error("[twilio.sendHotLeadBuyerSms] final send failed", err);
  }
}
