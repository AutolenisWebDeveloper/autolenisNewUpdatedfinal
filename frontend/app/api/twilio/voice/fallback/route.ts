import { NextRequest } from "next/server";
import { twimlResponse } from "@/lib/voice/twilio-verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Twilio hits this URL when the primary voice webhook errors or times out.
// Keep it dependency-free so it can always return a clean spoken message.
export async function POST(_request: NextRequest) {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">We are sorry, we are experiencing technical difficulties. Please call back shortly or email us at support at autolenis dot com. Thank you for your patience.</Say>
</Response>`;
  return twimlResponse(twiml);
}
