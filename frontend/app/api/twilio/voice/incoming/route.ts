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
  <Say voice="Polly.Joanna" language="en-US">Thank you for calling AutoLenis, the buyer-first automotive concierge. This is Zura. How can I help you today?</Say>
  <Gather input="speech" action="${PATH.replace("/incoming", "/process")}" method="POST" speechTimeout="auto" speechModel="phone_call" enhanced="true" timeout="5"></Gather>
  <Say voice="Polly.Joanna">I did not catch that. Please try again or call back and we will be happy to help. Goodbye.</Say>
</Response>`;

  return twimlResponse(twiml);
}
