// app/api/twilio/sms/inbound/route.ts
// Twilio inbound SMS webhook. Handles opt-out (STOP/UNSUBSCRIBE/CANCEL/QUIT/END
// plus AI-classified intent via gpt-oss-safeguard-20b), opt-in (START), and
// generic acknowledgement replies. Always returns TwiML 200 — Twilio will
// retry on non-200.
//
// Body parsing + signature: Twilio sends application/x-www-form-urlencoded,
// so we read req.formData() per spec. Because a Request body can only be
// read once, we then validate the x-twilio-signature header manually using
// verifyTwilioRequest against process.env.TWILIO_WEBHOOK_URL (the public
// URL Twilio actually signed against).

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { twimlResponse, verifyTwilioRequest } from "@/lib/voice/twilio-verify";
import { detectOptOutIntent } from "@/lib/ai/acquisition";
import { getServiceSupabase } from "@/lib/supabase-service";
import { SuppressionService } from "@/lib/services/suppression.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Keyword sets unified with the canonical webhook (/api/webhooks/twilio/inbound)
// so both inbound routes honor the same STOP/START vocabulary.
const OPT_OUT_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "QUIT", "END"]);
const START_KEYWORDS = new Set(["START", "YES", "UNSTOP"]);

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function reply(message: string): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`;
  return twimlResponse(xml);
}

export async function POST(req: Request) {
  // 1. Parse form body (per spec) — done first so we can hand the same
  //    params to the signature validator below.
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    params[key] = typeof value === "string" ? value : "";
  }

  // 2. Validate signature against TWILIO_WEBHOOK_URL.
  const signature = req.headers.get("x-twilio-signature") ?? "";
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
  const webhookUrl = process.env.TWILIO_WEBHOOK_URL ?? "";
  const verified =
    !!authToken &&
    !!webhookUrl &&
    !!signature &&
    verifyTwilioRequest(authToken, signature, webhookUrl, params);

  if (!verified) {
    logger.error("[sms/inbound] signature verification failed", {
      hasAuthToken: !!authToken,
      hasWebhookUrl: !!webhookUrl,
      hasSignature: !!signature,
    });
    return new Response("Forbidden", { status: 403 });
  }

  const body = (params.Body ?? "").trim();
  const from = params.From ?? "";

  if (!from) {
    return reply("Thanks for your message. An AutoLenis team member will follow up with you shortly.");
  }

  const upper = body.toUpperCase();
  const supabase = getServiceSupabase();

  // ── START / re-subscribe ───────────────────────────────────────────────
  // TCPA: START must NOT auto-re-enable sending. Delegate to the canonical
  // handler, which preserves the suppression row (stamps restarted_at) and
  // opens a manual-review task — consent must be re-verified before SMS resumes.
  if (START_KEYWORDS.has(upper)) {
    await SuppressionService.handleSmsStart(supabase, from);
    return reply("AutoLenis received your opt-in request. An agent will verify your consent before SMS resumes.");
  }

  // ── Opt-out: keyword first, then safeguard model ───────────────────────
  let isOptOut = OPT_OUT_KEYWORDS.has(upper);
  if (!isOptOut && body.length > 0) {
    isOptOut = await detectOptOutIntent(body);
  }

  if (isOptOut) {
    // Write to the CANONICAL suppression store (sms_suppression) so every send
    // path — CRM dispatch, Inngest, QStash, admin reply — honors the opt-out.
    await SuppressionService.suppressSms(supabase, from, "stop");
    // Keep the Buyer-plane flag in sync for buyer-facing logic that reads it.
    await prisma.buyer.updateMany({
      where: { phone: from },
      data: { optedOutSms: true },
    });
    return reply("You have been unsubscribed from AutoLenis texts. Reply START to re-subscribe at any time.");
  }

  // ── Default ────────────────────────────────────────────────────────────
  return reply("Thanks for your message. An AutoLenis team member will follow up with you shortly.");
}
