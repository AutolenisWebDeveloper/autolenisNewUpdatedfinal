import { NextRequest } from "next/server";
import twilio from "twilio";
import { parseTwilioRequest, twimlResponse, sanitizeForSpeech } from "@/lib/voice/twilio-verify";
import {
  getConversation,
  updateConversation,
  type VehicleRequestDraft,
  type VoiceMessage,
  type CallReason,
  type MessageDetails,
} from "@/lib/voice/conversation-store";
import {
  dispatchVehicleRequest,
  sendFounderMessageAlert,
} from "@/lib/voice/dispatch-request";
import { generateZuraSpeech } from "@/lib/voice/elevenlabs-tts.service";
import { ZURA_VOICE_PROMPT } from "@/lib/ai/zura-voice";
import type { BuyerLookupResult } from "@/lib/services/voice/buyer-lookup.service";
import { groqChat, type ChatMessage } from "@/lib/ai/groq-client";
import { dispatch } from "@/lib/qstash/dispatch";
import { sendSms, isValidUsPhone } from "@/lib/services/sms/twilio.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATH = "/api/twilio/voice/process";
const HISTORY_LIMIT = 10;
const MIN_CONFIDENCE = 0.3;
const TRANSFER_KEYWORDS = ["human", "person", "agent", "someone", "transfer", "real person"];

const VoiceResponse = twilio.twiml.VoiceResponse;
type Twiml = InstanceType<typeof VoiceResponse>;
type Gather = ReturnType<Twiml["gather"]>;
const VOICE = "Polly.Joanna-Neural";

// Speak with ElevenLabs (cloned Zura voice) when synthesis succeeds, otherwise
// fall back to Polly <Say> so the call never breaks. Works on either a
// <Response> or a <Gather> target.
async function speakWithFallback(
  target: Twiml | Gather,
  text: string,
): Promise<void> {
  const speech = await generateZuraSpeech(text);
  if (speech) {
    target.play(speech.audioUrl);
  } else {
    target.say({ voice: VOICE }, text);
  }
}

// A spoken <Gather> block reused after every Zura reply so the conversation
// continues until the caller hangs up or asks for a transfer. Zura's reply is
// always played on the <Response> BEFORE this gather (see call sites), never
// inside it, so barge-in can't cut the reply off. Timeouts are tuned for
// natural speech: wait 3s of silence before ending, and up to 10s for the
// caller to start; actionOnEmptyResult keeps the call alive on empty STT.
function addGather(twiml: Twiml): void {
  twiml.gather({
    input: ["speech"],
    action: PATH,
    method: "POST",
    speechTimeout: "3", // was "auto" (≈0.5s — cut callers off mid-sentence)
    speechModel: "experimental_conversations",
    enhanced: true,
    timeout: 10, // was 5
    actionOnEmptyResult: true,
  });
}

// Phase 2: when the caller is a recognized returning buyer, prepend a context
// block to Zura's system prompt so she addresses them by name and references
// their existing request instead of re-collecting vehicle details.
function buyerContextBlock(ctx: BuyerLookupResult | undefined): string {
  if (!ctx || !ctx.found) return "[NEW CALLER — no prior record found]";

  const vehicle = [ctx.yearMin, ctx.make, ctx.model].filter(Boolean).join(" ").trim();
  const budget =
    typeof ctx.budgetCents === "number"
      ? `$${Math.round(ctx.budgetCents / 100).toLocaleString("en-US")}`
      : "not specified";
  const submitted = ctx.createdAt
    ? new Date(ctx.createdAt).toLocaleDateString("en-US")
    : "unknown";
  const requestState = ctx.completed ? "completed" : "in progress";

  return [
    "[BUYER CONTEXT]",
    "This is a RETURNING CALLER. Their existing AutoLenis record:",
    `- Name: ${ctx.firstName ?? "unknown"}`,
    `- Looking for: ${vehicle || "no vehicle on file"}${ctx.trim ? ` (${ctx.trim})` : ""}`,
    `- Budget: ${budget}`,
    `- Timeline: ${ctx.timeline ?? "not specified"}`,
    `- Request status: ${requestState}`,
    `- Submitted: ${submitted}`,
    "",
    "DO address them by first name.",
    "DO reference their existing request naturally.",
    "DO NOT re-extract vehicle info they have already provided unless they want to change it.",
  ].join("\n");
}

function wantsTransfer(speech: string): boolean {
  const lower = speech.toLowerCase();
  return TRANSFER_KEYWORDS.some((k) => lower.includes(k));
}

function isComplete(req: VehicleRequestDraft | null): req is VehicleRequestDraft {
  return !!(req && req.firstName && req.lastName && req.email && req.make && req.model);
}

// Multi-intent extractor. Runs a second, cheap Groq call that first classifies
// WHY the caller phoned in, then returns either vehicle-request fields or a
// short structured message, as JSON. Failures are swallowed — extraction never
// blocks the spoken reply.
const EXTRACTOR_PROMPT = `
You extract structured data from voice receptionist conversations.

Return ONLY a JSON object with these keys:

{
  "callReason": "vehicle_request" | "question" | "status_check"
                | "message" | "dealer_inquiry" | "transfer_request"
                | "other",

  "vehicleRequest": {
    "firstName": string | null,
    "lastName": string | null,
    "email": string | null,
    "zip": string | null,
    "make": string | null,
    "model": string | null,
    "vehicleType": "SUV" | "Sedan" | "Truck" | "Van" | "Coupe" | null,
    "yearMin": number | null,
    "yearMax": number | null,
    "condition": "New" | "Used" | "Either" | null,
    "budget": number | null,
    "purchaseTimeframe": "ASAP" | "WITHIN_7_DAYS" | "WITHIN_30_DAYS" | "WITHIN_60_DAYS_PLUS" | null,
    "hasTradeIn": boolean | null,
    "financing": "Cash" | "Need financing" | null
  },

  "messageDetails": {
    "callerName": string | null,
    "callerEmail": string | null,
    "reason": string | null,
    "bestCallbackTime": string | null
  },

  "complete": boolean
}

Rules:
- callReason is REQUIRED — always classify
- If callReason = "vehicle_request", populate vehicleRequest fields
- If callReason is anything else, populate messageDetails
- complete = true if you have enough to fulfill the request
- For vehicle_request: complete requires firstName, email, make, model, zip, budget at minimum
- For others: complete requires callerName, callerEmail, reason
- Return ONLY valid JSON, no markdown, no commentary
`;

const CALL_REASONS = new Set<CallReason>([
  "vehicle_request",
  "question",
  "status_check",
  "message",
  "dealer_inquiry",
  "transfer_request",
  "other",
]);

interface ExtractedCall {
  callReason?: CallReason;
  vehicleRequest: VehicleRequestDraft;
  messageDetails: MessageDetails;
  complete: boolean;
}

function str(v: unknown): string | undefined {
  if (typeof v === "string") {
    const t = v.trim();
    if (t && t.toLowerCase() !== "null") return t;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

// Convert the extractor's richly-typed vehicleRequest object into the
// string-based VehicleRequestDraft the dispatch pipeline expects.
function toVehicleDraft(raw: Record<string, unknown> | undefined): VehicleRequestDraft {
  const draft: VehicleRequestDraft = {};
  if (!raw) return draft;
  const assign = (key: keyof VehicleRequestDraft, v: unknown) => {
    const s = str(v);
    if (s) draft[key] = s;
  };
  assign("firstName", raw.firstName);
  assign("lastName", raw.lastName);
  assign("email", raw.email);
  assign("zip", raw.zip);
  assign("make", raw.make);
  assign("model", raw.model);
  assign("vehicleType", raw.vehicleType);
  assign("yearMin", raw.yearMin);
  assign("yearMax", raw.yearMax);
  assign("budget", raw.budget);
  // Map the extractor's enum field names onto the draft's legacy field names.
  assign("newOrUsed", raw.condition);
  assign("timeline", raw.purchaseTimeframe);
  assign("financing", raw.financing);
  if (typeof raw.hasTradeIn === "boolean") draft.hasTradeIn = raw.hasTradeIn ? "yes" : "no";
  return draft;
}

function toMessageDetails(raw: Record<string, unknown> | undefined): MessageDetails {
  const details: MessageDetails = {};
  if (!raw) return details;
  const name = str(raw.callerName);
  const email = str(raw.callerEmail);
  const reason = str(raw.reason);
  const time = str(raw.bestCallbackTime);
  if (name) details.callerName = name;
  if (email) details.callerEmail = email;
  if (reason) details.reason = reason;
  if (time) details.bestCallbackTime = time;
  return details;
}

async function extractCallData(history: ChatMessage[]): Promise<ExtractedCall | null> {
  try {
    const result = await groqChat(
      [{ role: "system", content: EXTRACTOR_PROMPT }, ...history],
      { maxTokens: 400, temperature: 0 },
    );
    const match = result.content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const reason = typeof parsed.callReason === "string" ? parsed.callReason : undefined;
    return {
      callReason: reason && CALL_REASONS.has(reason as CallReason)
        ? (reason as CallReason)
        : undefined,
      vehicleRequest: toVehicleDraft(parsed.vehicleRequest as Record<string, unknown> | undefined),
      messageDetails: toMessageDetails(
        parsed.messageDetails as Record<string, unknown> | undefined,
      ),
      complete: parsed.complete === true,
    };
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
  try {
    const { params, verified } = await parseTwilioRequest(request, PATH);
    if (!verified) {
      console.error("[voice/process] Twilio signature invalid — rejecting request");
      return new Response("Unauthorized", { status: 401 });
    }

    const speech = (params.SpeechResult ?? "").trim();
    const callSid = params.CallSid ?? "";
    const from = params.From ?? "";
    const confidence = parseFloat(params.Confidence ?? "1");

    // Couldn't make out the caller — ask them to repeat without losing the call.
    if (!speech || (Number.isFinite(confidence) && confidence < MIN_CONFIDENCE)) {
      const twiml = new VoiceResponse();
      await speakWithFallback(twiml, "Sorry, I did not catch that. Could you please repeat that?");
      addGather(twiml);
      return twimlResponse(twiml.toString());
    }

    const conv = getConversation(callSid);
    if (from && !conv.callerPhone) conv.callerPhone = from;

    const history: ChatMessage[] = conv.history
      .slice(-HISTORY_LIMIT)
      .map((m) => ({ role: m.role, content: m.content }));

    const systemPrompt = `${ZURA_VOICE_PROMPT}\n\n${buyerContextBlock(conv.buyerContext)}`;
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
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
      const twiml = new VoiceResponse();
      await speakWithFallback(
        twiml,
        "I am having trouble hearing you right now. Please call back shortly or email us at support at autolenis dot com.",
      );
      return twimlResponse(twiml.toString());
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
        const twiml = new VoiceResponse();
        await speakWithFallback(twiml, aiText);
        twiml.dial(transferNumber);
        return twimlResponse(twiml.toString());
      }
      // No transfer line configured — stay on the line gracefully.
      const twiml = new VoiceResponse();
      await speakWithFallback(
        twiml,
        "I am not able to connect a live agent right now, but I can help you here, or you can email support at autolenis dot com.",
      );
      addGather(twiml);
      return twimlResponse(twiml.toString());
    }

    // Classify intent and update the structured draft. The model-based extractor
    // runs first; for vehicle requests the lightweight string extractor then
    // backfills any fields it missed without overwriting confirmed values.
    const extracted = await extractCallData([...history, { role: "user", content: speech }]);
    if (extracted) {
      updateConversation(callSid, {
        callReason: extracted.callReason,
        messageDetails: extracted.messageDetails,
        vehicleRequest: Object.keys(extracted.vehicleRequest).length
          ? extracted.vehicleRequest
          : undefined,
      });
    }

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

    const callReason = refreshed.callReason;
    const isVehicleIntent = !callReason || callReason === "vehicle_request";

    if (isVehicleIntent) {
      // Vehicle path — full request collected → run the complete intake once.
      if (isComplete(refreshed.vehicleRequest) && !refreshed.requestDispatched) {
        updateConversation(callSid, { requestDispatched: true });
        dispatchVehicleRequest(
          refreshed.vehicleRequest,
          refreshed.callerPhone,
          refreshed.inboundNumber,
        ).catch((err) => console.error("[voice/process] dispatch failed:", err));
      }

      // Partial lead — a name plus the caller's phone confirms receipt.
      maybeCapturePartialLead(
        callSid,
        refreshed.vehicleRequest,
        refreshed.callerPhone,
        refreshed.partialLeadDispatched,
      );
    } else if (extracted?.complete && !refreshed.founderAlertSent) {
      // Non-vehicle path — once we have a complete message, SMS-alert the founder
      // exactly once. End-of-call dispatch in voice/status covers early hang-ups.
      updateConversation(callSid, { founderAlertSent: true });
      sendFounderMessageAlert({
        callReason,
        callerPhone: refreshed.callerPhone,
        inboundNumber: refreshed.inboundNumber,
        messageDetails: refreshed.messageDetails ?? {},
      }).catch((err) => console.error("[voice/process] founder alert failed:", err));
    }

    const twiml = new VoiceResponse();
    await speakWithFallback(twiml, aiText);
    addGather(twiml);
    await speakWithFallback(twiml, "Is there anything else I can help you with today?");
    return twimlResponse(twiml.toString());
  } catch (err) {
    console.error("Voice process error:", err);
    const twiml = new VoiceResponse();
    await speakWithFallback(twiml, "We are experiencing a technical issue. Please try again shortly.");
    return twimlResponse(twiml.toString());
  }
}
