import { NextRequest } from "next/server";
import twilio from "twilio";
import { parseTwilioRequest, twimlResponse } from "@/lib/voice/twilio-verify";
import { transcribeAudio } from "@/lib/voice/whisper-stt.service";
import { handleVoiceTurn } from "@/lib/voice/handle-turn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATH = "/api/twilio/voice/recording-complete";

const VoiceResponse = twilio.twiml.VoiceResponse;

// Zura Phase 4 — Whisper STT turn handler.
//
// Twilio's <Record> verb posts here when the caller's clip is ready. We
// download the recording, transcribe it with OpenAI Whisper, then hand the
// transcript to the shared turn handler (the same Groq reply / extraction /
// dispatch pipeline the legacy <Gather> path uses). When Whisper falls back,
// the caller is re-asked through Twilio STT so the call never stalls.
export async function POST(request: NextRequest) {
  try {
    const { params, verified } = await parseTwilioRequest(request, PATH);
    if (!verified) {
      console.error("[zura-p4] Twilio signature invalid — rejecting request");
      return new Response("Unauthorized", { status: 401 });
    }

    const callSid = params.CallSid ?? "";
    const from = params.From ?? "";
    const recordingUrl = params.RecordingUrl ?? "";
    const recordingSid = params.RecordingSid ?? "";
    const recordingDuration = parseInt(params.RecordingDuration ?? "0", 10);

    // No audio captured (caller stayed silent) — re-ask without transcribing.
    if (!recordingUrl || recordingDuration === 0) {
      console.log("[zura-p4] Empty recording — re-asking caller");
      const xml = await handleVoiceTurn({ callSid, from, speech: "", lowConfidence: true });
      return twimlResponse(xml);
    }

    const result = await transcribeAudio(recordingUrl, recordingSid);
    const sttFailed = result.provider === "twilio_fallback";
    const lowConfidence = sttFailed || !result.text || result.confidence === "low";

    if (sttFailed) {
      console.warn("[zura-p4] Whisper unavailable — re-asking via Twilio STT");
    }

    const xml = await handleVoiceTurn({
      callSid,
      from,
      speech: result.text,
      lowConfidence,
      sttFailed,
    });
    return twimlResponse(xml);
  } catch (err) {
    console.error("[zura-p4] recording-complete error:", err);
    const twiml = new VoiceResponse();
    twiml.say(
      { voice: "Polly.Joanna-Neural" },
      "We are experiencing a technical issue. Please try again shortly.",
    );
    return twimlResponse(twiml.toString());
  }
}
