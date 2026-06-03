import { NextRequest } from "next/server";
import twilio from "twilio";
import { parseTwilioRequest, twimlResponse } from "@/lib/voice/twilio-verify";
import { updateConversation } from "@/lib/voice/conversation-store";
import { generateZuraSpeech } from "@/lib/voice/elevenlabs-tts.service";

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
    if (callSid) {
      updateConversation(callSid, { callerPhone: from, inboundNumber: calledNumber });
    }

    const twiml = new VoiceResponse();
    const gather = twiml.gather({
      input: ["speech"],
      action: PROCESS_PATH,
      method: "POST",
      speechTimeout: "auto",
      speechModel: "experimental_conversations",
      enhanced: true,
      timeout: 5,
    });

    const greeting =
      "Thank you for calling AutoLenis. This is Zura. How can I help you find your next vehicle today?";
    const greetingSpeech = await generateZuraSpeech(greeting);
    if (greetingSpeech) {
      gather.play(greetingSpeech.audioUrl);
    } else {
      gather.say({ voice: VOICE }, greeting);
    }

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
