// Zura Intelligence Phase 3 — transfer outcome handler.
//
// Twilio POSTs here after the <Dial> in the live-transfer TwiML completes (see
// call-transfer.service.ts). We read DialCallStatus and decide what the caller
// hears next:
//   - answered/completed → the call already happened; hang up.
//   - busy/no-answer/failed/canceled → founder unavailable; apologize and take
//     a message (the existing Phase 1 message-taking gather loop).
//
// The transfer attempt is recorded as a transfer_request opportunity at
// end-of-call by /api/twilio/voice/status (the conversation's callReason was
// set to transfer_request when the transfer was triggered), so no new DB model
// is needed — keep it simple.

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import twilio from "twilio";
import { parseTwilioRequest, twimlResponse } from "@/lib/voice/twilio-verify";
import { buildTransferFailedTwiML } from "@/lib/voice/call-transfer.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATH = "/api/twilio/voice/transfer-status";
const VoiceResponse = twilio.twiml.VoiceResponse;
const VOICE = "Polly.Joanna-Neural";

// DialCallStatus values that mean the founder picked up. "completed" arrives
// once the connected leg ends; in both cases the conversation is over.
const ANSWERED = new Set(["answered", "completed"]);

export async function POST(request: NextRequest) {
  try {
    const { params, verified } = await parseTwilioRequest(request, PATH);
    if (!verified) {
      logger.error("[zura-p3] transfer-status: Twilio signature invalid — rejecting");
      return new Response("Unauthorized", { status: 401 });
    }

    const dialStatus = (params.DialCallStatus ?? "").trim();
    const callSid = params.CallSid ?? "";

    if (ANSWERED.has(dialStatus)) {
      // Founder answered and the bridged call has ended — wrap up cleanly.
      logger.info(`[zura-p3] Dial outcome: ${dialStatus} → live transfer connected (callSid ${callSid})`);
      const twiml = new VoiceResponse();
      twiml.hangup();
      return twimlResponse(twiml.toString());
    }

    // busy / no-answer / failed / canceled → founder unavailable. Fall back to
    // message-taking so the hot lead is never dropped.
    logger.info(
      `[zura-p3] Dial outcome: ${dialStatus || "unknown"} → falling back to message-taking (callSid ${callSid})`,
    );
    return twimlResponse(await buildTransferFailedTwiML());
  } catch (err) {
    logger.error("[zura-p3] transfer-status error:", err);
    // Always hand Twilio valid TwiML so the caller is never dropped abruptly.
    const twiml = new VoiceResponse();
    twiml.say(
      { voice: VOICE },
      "We are experiencing a technical issue. Please try again shortly.",
    );
    return twimlResponse(twiml.toString());
  }
}
