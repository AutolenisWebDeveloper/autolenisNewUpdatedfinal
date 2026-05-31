// app/api/twilio/sms/inbound/route.ts
// Twilio inbound SMS webhook. Handles opt-out (STOP/UNSUBSCRIBE/CANCEL/QUIT/END
// plus AI-classified intent), opt-in (START), and generic acknowledgement
// replies. Always returns TwiML 200 — Twilio will retry on non-200.
//
// Body parsing note: parseTwilioRequest consumes the request body once
// (urlencoded form, which is Twilio's webhook format) and validates the
// x-twilio-signature header against the rebuilt public URL. We reuse it
// rather than calling formData() separately because a Request body can
// only be read once.

import { prisma } from "@/lib/prisma";
import { parseTwilioRequest, twimlResponse } from "@/lib/voice/twilio-verify";
import { groqChat } from "@/lib/ai/groq-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OPT_OUT_KEYWORDS = ["STOP", "UNSUBSCRIBE", "CANCEL", "QUIT", "END"];

function reply(message: string): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`;
  return twimlResponse(xml);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function classifyOptOutWithAi(message: string): Promise<boolean> {
  try {
    const result = await groqChat(
      [
        {
          role: "system",
          content:
            'Reply with JSON only: { "isOptOut": boolean }. Is this message requesting to stop receiving texts?',
        },
        { role: "user", content: message },
      ],
      { maxTokens: 50, temperature: 0.0 },
    );
    const match = result.content.match(/\{[\s\S]*\}/);
    if (!match) return false;
    const parsed = JSON.parse(match[0]) as { isOptOut?: unknown };
    return parsed.isOptOut === true;
  } catch (err) {
    console.error("[sms/inbound] opt-out classification failed", err);
    return false;
  }
}

export async function POST(req: Request) {
  const { params, verified } = await parseTwilioRequest(
    req,
    "/api/twilio/sms/inbound",
  );
  if (!verified) {
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

  // ── STOP keyword or AI-classified opt-out ──────────────────────────────
  const keywordOptOut = OPT_OUT_KEYWORDS.includes(upper);
  const isOptOut =
    keywordOptOut || (body.length > 0 && (await classifyOptOutWithAi(body)));
  if (isOptOut) {
    await prisma.smsOptOut.upsert({
      where: { phone: from },
      create: { phone: from, reason: keywordOptOut ? `keyword:${upper}` : "ai_classified" },
      update: { reason: keywordOptOut ? `keyword:${upper}` : "ai_classified" },
    });
    await prisma.buyer.updateMany({
      where: { phone: from },
      data: { optedOutSms: true },
    });
    return reply("You have been unsubscribed from AutoLenis texts. Reply START to re-subscribe.");
  }

  // ── Default acknowledgement ─────────────────────────────────────────────
  return reply("Thanks for your message. An AutoLenis team member will follow up with you shortly.");
}
