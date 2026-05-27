import { NextRequest } from "next/server";
import { parseTwilioRequest, twimlResponse, escapeXml, sanitizeForSpeech } from "@/lib/voice/twilio-verify";
import {
  getConversation,
  updateConversation,
  type VehicleRequestDraft,
  type VoiceMessage,
} from "@/lib/voice/conversation-store";
import { dispatchVehicleRequest } from "@/lib/voice/dispatch-request";
import { ZURA_VOICE_PROMPT } from "@/lib/ai/zura-voice";
import { groqChat, type ChatMessage } from "@/lib/ai/groq-client";
import { dispatch } from "@/lib/qstash/dispatch";
import { sendSms, isValidUsPhone } from "@/lib/services/sms/twilio.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATH = "/api/twilio/voice/process";
const HISTORY_LIMIT = 10;
const MIN_CONFIDENCE = 0.3;
const TRANSFER_KEYWORDS = ["human", "person", "agent", "someone", "transfer", "real person"];

// A spoken <Gather> block reused after every Zura reply so the conversation
// continues until the caller hangs up or asks for a transfer.
function gatherBlock(): string {
  return `<Gather input="speech" action="${PATH}" method="POST" speechTimeout="auto" speechModel="experimental_conversations" enhanced="true" timeout="5"></Gather>`;
}

function say(text: string): string {
  return `<Say voice="Polly.Joanna-Neural"><prosody rate="95%" pitch="+2%">${escapeXml(text)}</prosody></Say>`;
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

const FIELD_KEYS = [
  "firstName",
  "lastName",
  "email",
  "make",
  "model",
  "budget",
  "timeline",
  "newOrUsed",
] as const;

const CAR_MAKES = [
  "toyota", "honda", "ford", "chevrolet", "chevy", "nissan", "bmw",
  "mercedes-benz", "mercedes", "audi", "tesla", "jeep", "hyundai", "kia",
  "subaru", "lexus", "mazda", "volkswagen", "vw", "dodge", "ram", "gmc",
  "acura", "infiniti", "volvo", "porsche", "cadillac", "buick", "chrysler",
  "lincoln", "mitsubishi", "genesis", "range rover", "land rover", "jaguar",
  "mini", "fiat",
];

const TIMELINE_PHRASES = [
  "this week", "next week", "this weekend", "this month", "next month",
  "this year", "next year", "as soon as possible", "asap", "immediately",
  "right away", "within a month", "within 30 days", "within 60 days",
  "within 90 days", "90 days", "60 days", "30 days", "a few weeks",
  "a few months", "couple weeks", "couple months", "by the end of",
];

// Words that follow a self-introduction cue but are clearly not a name
// ("I'm looking for…"), so the name extraction skips them.
const NAME_STOPWORDS = new Set([
  "looking", "interested", "calling", "trying", "here", "not", "just",
  "hoping", "wondering", "ready", "good", "fine", "great", "okay", "ok",
  "sorry", "gonna", "going", "thinking", "wanting", "needing", "in", "on",
  "at", "a", "the", "from", "with", "about", "still", "really", "very", "so",
]);

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

// Lightweight, dependency-free extraction over the caller's own turns. Used to
// backfill fields the model-based extractor missed. It never decides what to
// keep — the call site applies it only to fields not already in the store.
function extractFieldsFromHistory(history: VoiceMessage[]): VehicleRequestDraft {
  const userText = history
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join(" ");
  const lower = userText.toLowerCase();
  const draft: VehicleRequestDraft = {};

  const email = userText.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  if (email) draft.email = email[0].toLowerCase();

  for (const cue of ["my name is", "this is", "i'm", "i am"]) {
    const idx = lower.indexOf(cue);
    if (idx === -1) continue;
    const words = userText
      .slice(idx + cue.length)
      .trim()
      .split(/[^A-Za-z'-]+/)
      .filter(Boolean)
      .slice(0, 2);
    if (!words[0] || NAME_STOPWORDS.has(words[0].toLowerCase())) continue;
    draft.firstName = titleCase(words[0]);
    if (words[1]) draft.lastName = titleCase(words[1]);
    break;
  }

  for (const make of CAR_MAKES) {
    const idx = lower.indexOf(make);
    if (idx === -1) continue;
    draft.make = titleCase(make);
    const rest = userText
      .slice(idx + make.length)
      .trim()
      .split(/[^A-Za-z0-9-]+/)
      .filter(Boolean);
    if (rest[0]) draft.model = titleCase(rest[0]);
    break;
  }

  const dollar = userText.match(/\$\s?[\d,]+(\.\d+)?/);
  const kAmount = lower.match(/\b\d{1,3}\s?k\b/);
  const thousand = lower.match(/\b[\d,]+\s?(thousand|grand)\b/);
  if (dollar) draft.budget = dollar[0].trim();
  else if (kAmount) draft.budget = kAmount[0].trim();
  else if (thousand) draft.budget = thousand[0].trim();

  for (const t of TIMELINE_PHRASES) {
    if (lower.includes(t)) {
      draft.timeline = t;
      break;
    }
  }

  if (/\bpre-?owned\b/.test(lower) || /\bused\b/.test(lower)) draft.newOrUsed = "used";
  else if (/\bbrand new\b/.test(lower) || /\bnew\b/.test(lower)) draft.newOrUsed = "new";

  return draft;
}

// Capture a minimum-viable lead — a name plus the caller's phone — and send an
// immediate confirmation SMS, even before the full vehicle request is complete.
// Fires at most once per call (guarded by partialLeadDispatched).
function maybeCapturePartialLead(
  callSid: string,
  req: VehicleRequestDraft | null,
  callerPhone: string,
  alreadyDispatched: boolean,
): void {
  if (alreadyDispatched) return;
  const hasName = !!(req?.firstName || req?.lastName);
  if (!hasName || !callerPhone) return;

  updateConversation(callSid, { partialLeadDispatched: true });

  const firstName = req?.firstName?.trim() || "there";
  if (isValidUsPhone(callerPhone)) {
    sendSms(
      callerPhone,
      `Hi ${firstName}! Thanks for calling AutoLenis. We received your information and a team member will follow up shortly. Ready to start your dealer auction? Visit autolenis.com Reply STOP to opt out.`,
    ).catch(() => {});
  }

  dispatch({
    path: "/api/jobs/form-submitted",
    body: {
      firstName: req?.firstName ?? "",
      lastName: req?.lastName ?? "",
      email: req?.email ?? "",
      phone: callerPhone,
      campaign: "phone-voice-partial",
    },
  }).catch(() => {});
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
    const result = await groqChat(messages, { maxTokens: 120, temperature: 0.85 });
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

  // Update the structured request draft. The model-based extractor runs first;
  // the lightweight string extractor then backfills any fields it missed
  // without overwriting values already confirmed in the store.
  const extracted = await extractVehicleRequest([...history, { role: "user", content: speech }]);
  if (extracted) updateConversation(callSid, { vehicleRequest: extracted });

  const afterModel = getConversation(callSid);
  const stringDraft = extractFieldsFromHistory(afterModel.history);
  const gapFill: VehicleRequestDraft = {};
  for (const key of FIELD_KEYS) {
    if (!afterModel.vehicleRequest?.[key] && stringDraft[key]) {
      gapFill[key] = stringDraft[key];
    }
  }
  const refreshed = Object.keys(gapFill).length
    ? updateConversation(callSid, { vehicleRequest: gapFill })
    : afterModel;

  // Full request collected → run the complete intake exactly once.
  if (isComplete(refreshed.vehicleRequest) && !refreshed.requestDispatched) {
    updateConversation(callSid, { requestDispatched: true });
    dispatchVehicleRequest(refreshed.vehicleRequest, refreshed.callerPhone).catch((err) =>
      console.error("[voice/process] dispatch failed:", err),
    );
  }

  // Partial lead — a name plus the caller's phone is enough to confirm receipt.
  maybeCapturePartialLead(
    callSid,
    refreshed.vehicleRequest,
    refreshed.callerPhone,
    refreshed.partialLeadDispatched,
  );

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say(aiText)}
  ${gatherBlock()}
  ${say("Is there anything else I can help you with today?")}
</Response>`;
  return twimlResponse(twiml);
}
