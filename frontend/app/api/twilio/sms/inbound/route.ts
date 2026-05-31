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

import { prisma } from "@/lib/prisma";
import { twimlResponse, verifyTwilioRequest } from "@/lib/voice/twilio-verify";
import { detectOptOutIntent } from "@/lib/ai/acquisition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OPT_OUT_KEYWORDS = new Set(["STOP", "UNSUBSCRIBE", "CANCEL", "QUIT", "END"]);

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
    console.error("[sms/inbound] signature verification failed", {
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

  // ── START / re-subscribe ───────────────────────────────────────────────
  if (upper === "START") {
    await prisma.smsOptOut.deleteMany({ where: { phone: from } });
    await prisma.buyer.updateMany({
      where: { phone: from },
      data: { optedOutSms: false },
    });
    return reply("You are re-subscribed to AutoLenis texts.");
  }

  // ── Opt-out: keyword first, then safeguard model ───────────────────────
  let isOptOut = OPT_OUT_KEYWORDS.has(upper);
  let reason: string;
  if (isOptOut) {
    reason = `keyword:${upper}`;
  } else if (body.length > 0) {
    const aiSaidOptOut = await detectOptOutIntent(body);
    if (aiSaidOptOut) {
      isOptOut = true;
      reason = "ai_classified";
    } else {
      reason = "";
    }
  } else {
    reason = "";
  }

  if (isOptOut) {
    await prisma.smsOptOut.upsert({
      where: { phone: from },
      create: { phone: from, reason },
      update: { reason },
    });
    await prisma.buyer.updateMany({
      where: { phone: from },
      data: { optedOutSms: true },
    });
    return reply("You have been unsubscribed from AutoLenis texts. Reply START to re-subscribe at any time.");
  }

  // ── Default ────────────────────────────────────────────────────────────
  return reply("Thanks for your message. An AutoLenis team member will follow up with you shortly.");
}
