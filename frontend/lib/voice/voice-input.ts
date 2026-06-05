// Zura Phase 4 — caller-input verb selector.
//
// Centralizes how the voice receptionist collects the next caller utterance so
// the entry point (/voice/incoming) and every follow-up turn use the same
// mechanism. Two providers:
//
//   • Whisper  → <Record> posts the clip to /voice/recording-complete, which
//                transcribes it with OpenAI Whisper (default).
//   • Twilio   → <Gather input="speech"> uses Twilio's built-in STT and posts
//                the SpeechResult to /voice/process (legacy / rollback path).
//
// Rollback is a config change, not a deploy: set VOICE_USE_WHISPER=false in the
// environment and every turn reverts to <Gather>.

import type twilio from "twilio";

type VoiceResponse = InstanceType<typeof twilio.twiml.VoiceResponse>;

export const RECORDING_PATH = "/api/twilio/voice/recording-complete";
export const PROCESS_PATH = "/api/twilio/voice/process";

// Whisper is the default. Only the explicit string "false" disables it, so a
// missing env var keeps the improved STT on.
export function useWhisperStt(): boolean {
  return process.env.VOICE_USE_WHISPER !== "false";
}

// Append the next caller-input verb to a TwiML <Response>. Zura's spoken prompt
// must already have been played on `twiml` before calling this so barge-in
// can't cut the prompt off.
//
// `forceTwilio` pins this one turn to <Gather> regardless of the flag — used
// when Whisper hard-fails so the re-ask goes through Twilio STT instead of
// recording another clip Whisper would likely fail on again.
export function addCallerInput(
  twiml: VoiceResponse,
  opts: { forceTwilio?: boolean } = {},
): void {
  if (useWhisperStt() && !opts.forceTwilio) {
    // <Record> captures a short clip; its `action` fires when the caller stops
    // (3s silence) or maxLength is hit, posting RecordingUrl to the handler.
    twiml.record({
      action: RECORDING_PATH,
      method: "POST",
      maxLength: 15,
      timeout: 3,
      playBeep: false,
      trim: "trim-silence",
    });
    return;
  }

  // Legacy Twilio STT path (rollback). Timeouts match the original tuning:
  // 3s of silence ends the turn, up to 10s to start speaking, and
  // actionOnEmptyResult keeps the call alive when STT returns nothing.
  addTwilioGather(twiml);
}

// Exposed separately so callers that must always use Twilio STT can do so
// explicitly (the rollback / legacy path).
export function addTwilioGather(target: VoiceResponse): void {
  target.gather({
    input: ["speech"],
    action: PROCESS_PATH,
    method: "POST",
    speechTimeout: "3",
    speechModel: "experimental_conversations",
    enhanced: true,
    timeout: 10,
    actionOnEmptyResult: true,
  });
}
