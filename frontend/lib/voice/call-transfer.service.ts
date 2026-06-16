// Zura Intelligence Phase 3 — live call transfer to the founder.
//
// When a caller triggers a transfer condition (explicit "talk to a human",
// urgent buying intent, a dealer wanting to discuss partnership now, or a
// complaint needing a human), Zura plays a warm handoff phrase and bridges the
// call to FOUNDER_PHONE_NUMBER via Twilio <Dial>. Every path fails safe: if
// transfers are disabled or no founder number is configured, callers fall
// through to the existing Phase 1 message-taking flow and the call never breaks.

import { logger } from "@/lib/logger";
import twilio from "twilio";
import { generateZuraSpeech } from "@/lib/voice/elevenlabs-tts.service";

const VoiceResponse = twilio.twiml.VoiceResponse;

// Polly fallback voice — used only when ElevenLabs synthesis fails, mirroring
// the rest of the voice routes so the caller always hears a spoken line.
const VOICE = "Polly.Joanna-Neural";

const TRANSFER_STATUS_PATH = "/api/twilio/voice/transfer-status";
const PROCESS_PATH = "/api/twilio/voice/process";

// How long the founder's phone rings before Twilio gives up and POSTs the
// outcome to the transfer-status handler.
const TRANSFER_TIMEOUT_SECONDS = 20;

export interface TransferConfig {
  founderPhone: string; // from FOUNDER_PHONE_NUMBER (TWILIO_TRANSFER_NUMBER fallback)
  timeoutSeconds: number; // how long to ring before the fallback handler runs
  statusCallbackUrl: string; // POST url Twilio calls with the <Dial> outcome
  warmHandoffPhrase: string; // what Zura says right before connecting
}

// Master kill-switch so the founder can pause live transfers (meetings, travel)
// without a code deploy. Transfers are OFF unless ENABLE_LIVE_CALL_TRANSFER is
// explicitly "true"; any other value (including unset) falls through to
// message-taking. Mirrors the documented Vercel verification behavior.
export function isTransferEnabled(): boolean {
  return process.env.ENABLE_LIVE_CALL_TRANSFER === "true";
}

// Resolve the transfer configuration from the environment. Returns null — never
// throws — when no founder number is configured so the caller can fall through
// to message-taking instead of crashing the call. Phone numbers are never
// hardcoded: they come from FOUNDER_PHONE_NUMBER, with the legacy
// TWILIO_TRANSFER_NUMBER kept as a backward-compatible fallback.
export function getTransferConfig(): TransferConfig | null {
  const founderPhone =
    process.env.FOUNDER_PHONE_NUMBER || process.env.TWILIO_TRANSFER_NUMBER;
  if (!founderPhone) {
    logger.warn(
      "[zura-p3] FOUNDER_PHONE_NUMBER not set — cannot transfer, falling back to message-taking",
    );
    return null;
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

  return {
    founderPhone,
    timeoutSeconds: TRANSFER_TIMEOUT_SECONDS,
    statusCallbackUrl: `${appUrl}${TRANSFER_STATUS_PATH}`,
    warmHandoffPhrase:
      "One moment — I'm connecting you with Marc from AutoLenis right now.",
  };
}

// Build the TwiML that speaks the warm handoff phrase, then bridges the caller
// to the founder via <Dial>. The <Dial action=...> callback fires the
// transfer-status handler with DialCallStatus once the dialed leg ends (or
// never connects), where the no-answer / busy / failed fallback lives.
//
// answerOnBridge keeps the caller hearing ringback (not silence) until the
// founder actually answers. ElevenLabs synthesis is used for the handoff line
// when available, with a Polly <Say> fallback so the phrase is never silent.
export async function buildTransferTwiML(config: TransferConfig): Promise<string> {
  const twiml = new VoiceResponse();

  const speech = await generateZuraSpeech(config.warmHandoffPhrase);
  if (speech) {
    twiml.play(speech.audioUrl);
  } else {
    twiml.say({ voice: VOICE }, config.warmHandoffPhrase);
  }

  const dial = twiml.dial({
    action: config.statusCallbackUrl,
    method: "POST",
    timeout: config.timeoutSeconds,
    answerOnBridge: true,
  });
  dial.number(config.founderPhone);

  return twiml.toString();
}

// Build the fallback TwiML for when the transfer fails or times out: Zura
// apologizes and re-enters the message-taking gather loop (the existing Phase 1
// flow at /api/twilio/voice/process), so the caller can leave a message that
// the end-of-call status handler turns into a founder SMS alert. Gather
// timeouts match the rest of the voice routes (3s silence, 10s to start).
export async function buildTransferFailedTwiML(): Promise<string> {
  const twiml = new VoiceResponse();

  const message =
    "I'm sorry, Marc isn't available to take the call right now. " +
    "I'd be glad to take a message and have him call you back. " +
    "What would you like me to pass along?";

  const speech = await generateZuraSpeech(message);
  if (speech) {
    twiml.play(speech.audioUrl);
  } else {
    twiml.say({ voice: VOICE }, message);
  }

  twiml.gather({
    input: ["speech"],
    action: PROCESS_PATH,
    method: "POST",
    speechTimeout: "3",
    speechModel: "experimental_conversations",
    enhanced: true,
    timeout: 10,
    actionOnEmptyResult: true,
  });

  return twiml.toString();
}
