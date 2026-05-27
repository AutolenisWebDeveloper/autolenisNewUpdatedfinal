import { NextRequest } from "next/server";
import { parseTwilioRequest, twimlResponse, escapeXml, sanitizeForSpeech } from "@/lib/voice/twilio-verify";
import { getConversation, updateConversation, type VehicleRequestDraft } from "@/lib/voice/conversation-store";
import { dispatchVehicleRequest } from "@/lib/voice/dispatch-request";
import { ZURA_VOICE_PROMPT } from "@/lib/ai/zura-voice";
import { groqChat, type ChatMessage } from "@/lib/ai/groq-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATH = "/api/twilio/voice/process";
const HISTORY_LIMIT = 10;
const MIN_CONFIDENCE = 0.3;
const TRANSFER_KEYWORDS = ["human", "person", "agent", "someone", "transfer", "real person"];

// A spoken <Gather> block reused after every Zura reply so the conversation
// continues until the caller hangs up or asks for a transfer.
function gatherBlock(): string {
  return `<Gather input="speech" action="${PATH}" method="POST" speechTimeout="auto" speechModel="phone_call" enhanced="true" timeout="5"></Gather>`;
}

function say(text: string): string {
  return `<Say voice="Polly.Joanna">${escapeXml(text)}</Say>`;
}

function wantsTransfer(speech: string): boolean {
  const lower = speech.toLowerCase();
  return TRANSFER_KEYWORDS.some((k) => lower.includes(k));
}

function isComplete(req: VehicleRequestDraft | null): req is VehicleRequestDraft {
  return !!(req && req.firstName && req.lastName && req.email && req.make && req.model);
}

// Best-effort structured extraction. Runs a second, cheap Groq call that returns
// only the vehicle-request fields mentioned so far as JSON. Failures are
// swallowed — extraction never blocks the spoken reply.
async function extractVehicleRequest(history: ChatMessage[]): Promise<VehicleRequestDraft | null> {
  const system =
    "Extract vehicle-request details from this phone conversation. " +
    "Return ONLY a JSON object with these keys: firstName, lastName, email, make, model, budget, timeline, newOrUsed. " +
    "Use null for anything the caller has not clearly provided. No prose, no markdown, JSON only.";
  try {
    const result = await groqChat(
      [{ role: "system", content: system }, ...history],
      { maxTokens: 200, temperature: 0 },
    );
    const match = result.content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const draft: VehicleRequestDraft = {};
    for (const key of ["firstName", "lastName", "email", "make", "model", "budget", "timeline", "newOrUsed"] as const) {
      const v = parsed[key];
      if (typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null") {
        draft[key] = v.trim();
      }
    }
    return Object.keys(draft).length ? draft : null;
  } catch (err) {
    console.error("[voice/process] extraction failed:", err);
    return null;
  }
}

export async function POST(request: NextRequest) {
  const { params, verified } = await parseTwilioRequest(request, PATH);
  if (!verified) {
    return new Response("Unauthorized", { status: 401 });
  }

  const speech = (params.SpeechResult ?? "").trim();
  const callSid = params.CallSid ?? "";
  const from = params.From ?? "";
  const confidence = parseFloat(params.Confidence ?? "1");

  // Couldn't make out the caller — ask them to repeat without losing the call.
  if (!speech || (Number.isFinite(confidence) && confidence < MIN_CONFIDENCE)) {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say("Sorry, I did not catch that. Could you please repeat that?")}
  ${gatherBlock()}
</Response>`;
    return twimlResponse(twiml);
  }

  const conv = getConversation(callSid);
  if (from && !conv.callerPhone) conv.callerPhone = from;

  const history: ChatMessage[] = conv.history
    .slice(-HISTORY_LIMIT)
    .map((m) => ({ role: m.role, content: m.content }));

  const messages: ChatMessage[] = [
    { role: "system", content: ZURA_VOICE_PROMPT },
    ...history,
    { role: "user", content: speech },
  ];

  let aiText: string;
  try {
    const result = await groqChat(messages, { maxTokens: 150, temperature: 0.7 });
    aiText = sanitizeForSpeech(result.content) ||
      "I am sorry, could you say that again?";
  } catch (err) {
    console.error("[voice/process] Groq call failed:", err);
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say("I am having trouble hearing you right now. Please call back shortly or email us at support at autolenis dot com.")}
</Response>`;
    return twimlResponse(twiml);
  }

  // Persist the turn.
  const newHistory = [
    ...conv.history,
    { role: "user" as const, content: speech },
    { role: "assistant" as const, content: aiText },
  ].slice(-HISTORY_LIMIT * 2);
  updateConversation(callSid, { history: newHistory, callerPhone: conv.callerPhone });

  // Live-agent transfer.
  if (wantsTransfer(speech)) {
    const transferNumber = process.env.TWILIO_TRANSFER_NUMBER;
    if (transferNumber) {
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say(aiText)}
  <Dial>${escapeXml(transferNumber)}</Dial>
</Response>`;
      return twimlResponse(twiml);
    }
    // No transfer line configured — stay on the line gracefully.
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say("I am not able to connect a live agent right now, but I can help you here, or you can email support at autolenis dot com.")}
  ${gatherBlock()}
</Response>`;
    return twimlResponse(twiml);
  }

  // Update the structured request draft and dispatch once it is complete.
  const extracted = await extractVehicleRequest([...history, { role: "user", content: speech }]);
  const refreshed = extracted
    ? updateConversation(callSid, { vehicleRequest: extracted })
    : getConversation(callSid);

  if (isComplete(refreshed.vehicleRequest) && !refreshed.requestDispatched) {
    updateConversation(callSid, { requestDispatched: true });
    dispatchVehicleRequest(refreshed.vehicleRequest, refreshed.callerPhone).catch((err) =>
      console.error("[voice/process] dispatch failed:", err),
    );
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say(aiText)}
  ${gatherBlock()}
  ${say("Is there anything else I can help you with today?")}
</Response>`;
  return twimlResponse(twiml);
}
