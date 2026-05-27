import { NextRequest } from "next/server";
import { parseTwilioRequest, twimlResponse } from "@/lib/voice/twilio-verify";
import { updateConversation } from "@/lib/voice/conversation-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATH = "/api/twilio/voice/incoming";

export async function POST(request: NextRequest) {
  const { params, verified } = await parseTwilioRequest(request, PATH);
  if (!verified) {
    return new Response("Unauthorized", { status: 401 });
  }

  const callSid = params.CallSid ?? "";
  const from = params.From ?? "";

  if (callSid) {
    updateConversation(callSid, { callerPhone: from });
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural"><prosody rate="92%" pitch="+3%">Thank you for calling AutoLenis. This is Zura. How can I help you today?</prosody></Say>
  <Gather input="speech" action="${PATH.replace("/incoming", "/process")}" method="POST" speechTimeout="auto" speechModel="experimental_conversations" enhanced="true" timeout="5"></Gather>
  <Say voice="Polly.Joanna-Neural"><prosody rate="95%" pitch="+2%">I did not catch that. Please try again or call back and we will be happy to help. Goodbye.</prosody></Say>
</Response>`;

  return twimlResponse(twiml);
}
