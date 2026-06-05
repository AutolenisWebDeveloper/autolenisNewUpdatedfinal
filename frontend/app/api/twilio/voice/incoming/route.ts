import { NextRequest } from "next/server";
import twilio from "twilio";
import { parseTwilioRequest, twimlResponse } from "@/lib/voice/twilio-verify";
import { updateConversation } from "@/lib/voice/conversation-store";
import { generateZuraSpeech } from "@/lib/voice/elevenlabs-tts.service";
import { lookupBuyerByPhone, buildGreeting } from "@/lib/services/voice/buyer-lookup.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VoiceResponse = twilio.twiml.VoiceResponse;
const PATH = "/api/twilio/voice/incoming";
const PROCESS_PATH = "/api/twilio/voice/process";
const VOICE = "Polly.Joanna-Neural";

const REQUIRED_ENV_VARS = ["TWILIO_AUTH_TOKEN", "TWILIO_ACCOUNT_SID", "GROQ_API_KEY"] as const;

export async function POST(request: NextRequest) {
  try {
    for (const envVar of REQUIRED_ENV_VARS) {
      if (!process.env[envVar]) {
        console.error(`[voice/incoming] Missing required env var: ${envVar}`);
        const twiml = new VoiceResponse();
        twiml.say(
          { voice: VOICE },
          "We are experiencing a configuration issue. Please try again later.",
        );
        return twimlResponse(twiml.toString());
      }
    }

    const { params, verified } = await parseTwilioRequest(request, PATH);
    if (!verified) {
      console.error("[voice/incoming] Twilio signature invalid — rejecting request");
      return new Response("Unauthorized", { status: 401 });
    }

    const callSid = params.CallSid ?? "";
    const from = params.From ?? "";
    // The Twilio number the caller dialed — used downstream to tag the lead
    // source as toll-free vs local (dual-number tracking).
    const calledNumber = params.To ?? "";

    // Phase 2: recognize returning buyers by phone before greeting. The lookup
    // is read-only and never throws — a miss or error yields the default
    // new-caller greeting. The result is cached on the conversation so the
    // /voice/process turns can reference it without re-querying.
    const buyerContext = await lookupBuyerByPhone(from);
    if (buyerContext.found) {
      console.log(
        `[zura-phase2] Returning caller: ${buyerContext.firstName ?? "unknown"}, ` +
          `${buyerContext.make ?? "—"} ${buyerContext.model ?? ""}`.trim(),
      );
    }

    if (callSid) {
      updateConversation(callSid, {
        callerPhone: from,
        inboundNumber: calledNumber,
        buyerContext,
      });
    }

    const twiml = new VoiceResponse();

    // STEP 1: Play the greeting OUTSIDE the gather so barge-in (caller
    // speech or background noise) cannot interrupt it before it finishes.
    // Personalized for recognized callers, standard new-caller line otherwise.
    const greeting = buildGreeting(buyerContext);
    const greetingSpeech = await generateZuraSpeech(greeting);
    if (greetingSpeech) {
      twiml.play(greetingSpeech.audioUrl);
    } else {
      twiml.say({ voice: VOICE }, greeting);
    }

    // STEP 2: Now start listening, with timeouts tuned for natural speech.
    twiml.gather({
      input: ["speech"],
      action: PROCESS_PATH,
      method: "POST",
      speechTimeout: "3", // wait 3s of silence (was "auto" ≈ 0.5s — too aggressive)
      speechModel: "experimental_conversations",
      enhanced: true,
      timeout: 10, // total wait for the caller to start speaking (was 5)
      actionOnEmptyResult: true, // continue even when STT returns empty
    });

    // STEP 3: Fallback if no input was captured.
    const noInput =
      "I did not catch that. Please try again or call back and we will be happy to help. Goodbye.";
    const noInputSpeech = await generateZuraSpeech(noInput);
    if (noInputSpeech) {
      twiml.play(noInputSpeech.audioUrl);
    } else {
      twiml.say({ voice: VOICE }, noInput);
    }

    return twimlResponse(twiml.toString());
  } catch (err) {
    console.error("Voice incoming error:", err);
    const twiml = new VoiceResponse();
    twiml.say(
      { voice: VOICE },
      "We are experiencing a technical issue. Please try again shortly.",
    );
    return twimlResponse(twiml.toString());
  }
}
