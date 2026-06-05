import { NextRequest } from "next/server";
import twilio from "twilio";
import { parseTwilioRequest, twimlResponse } from "@/lib/voice/twilio-verify";
import { handleVoiceTurn } from "@/lib/voice/handle-turn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATH = "/api/twilio/voice/process";
// Below this Twilio STT confidence the utterance is treated as not understood
// and Zura asks the caller to repeat.
const MIN_CONFIDENCE = 0.3;

const VoiceResponse = twilio.twiml.VoiceResponse;

// Legacy / rollback STT path: handles a turn whose audio was transcribed by
// Twilio's built-in <Gather input="speech"> (SpeechResult). Active when
// VOICE_USE_WHISPER === "false"; otherwise the receptionist records audio and
// transcribes it with Whisper via /voice/recording-complete. The actual turn
// logic (Groq reply, extraction, dispatch, transfer) lives in handleVoiceTurn,
// shared with the Whisper path.
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
    const lowConfidence = Number.isFinite(confidence) && confidence < MIN_CONFIDENCE;

    const xml = await handleVoiceTurn({ callSid, from, speech, lowConfidence });
    return twimlResponse(xml);
  } catch (err) {
    console.error("Voice process error:", err);
    const twiml = new VoiceResponse();
    twiml.say(
      { voice: "Polly.Joanna-Neural" },
      "We are experiencing a technical issue. Please try again shortly.",
    );
    return twimlResponse(twiml.toString());
  }
}
