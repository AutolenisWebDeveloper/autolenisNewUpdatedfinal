import { NextRequest } from "next/server";
import twilio from "twilio";
import { twimlResponse } from "@/lib/voice/twilio-verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VoiceResponse = twilio.twiml.VoiceResponse;

// Twilio hits this URL when the primary voice webhook errors or times out.
// Kept dependency-free and synchronous so it can NEVER throw — it always
// returns valid TwiML built by the SDK.
export async function POST(_request: NextRequest) {
  const twiml = new VoiceResponse();
  twiml.say(
    { voice: "Polly.Joanna-Neural" },
    "We are sorry, we are experiencing technical difficulties. Please call back shortly or email us at support at autolenis dot com. Thank you for your patience.",
  );
  return twimlResponse(twiml.toString());
}
