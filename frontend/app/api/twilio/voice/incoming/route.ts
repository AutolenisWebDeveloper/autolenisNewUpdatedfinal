import { NextRequest } from "next/server";
import twilio from "twilio";
import { parseTwilioRequest, twimlResponse } from "@/lib/voice/twilio-verify";
import { updateConversation } from "@/lib/voice/conversation-store";

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
    if (callSid) {
      updateConversation(callSid, { callerPhone: from });
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
    gather.say(
      { voice: VOICE },
      "Thank you for calling AutoLenis. This is Zura. How can I help you today?",
    );
    twiml.say(
      { voice: VOICE },
      "I did not catch that. Please try again or call back and we will be happy to help. Goodbye.",
    );

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
