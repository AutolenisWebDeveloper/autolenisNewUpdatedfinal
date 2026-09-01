// lib/ai/providers/openai.ts
//
// OpenAI transport. The ONLY module permitted to construct the OpenAI SDK.
//
// AutoLenis uses OpenAI for one thing: Whisper speech-to-text on the voice
// receptionist path. The chat models named `openai/gpt-oss-*` are GROQ model
// ids, not OpenAI ones — they are served by `providers/groq.ts`.
//
// `lib/voice/whisper-stt.service.ts` keeps everything that is actually its own:
// downloading the Twilio recording, the retry/backoff, the log-probability
// confidence score, and the twilio_fallback degradation. Only the SDK call moved
// here, so the kill switch reaches it.
//
// The kill switch is asserted upstream in `lib/ai/provider.ts`, never here.

import OpenAI, { toFile } from "openai";
import type { TranscriptionRequest, TranscriptionResult } from "@/lib/ai/provider";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
    client = new OpenAI({ apiKey });
  }
  return client;
}

/** Test seam — drops the memoised SDK client. Never called by app code. */
export function __resetOpenAiClientForTests(): void {
  client = null;
}

export async function transcribe(req: TranscriptionRequest): Promise<TranscriptionResult> {
  const file = await toFile(req.audio, req.filename, { type: req.mimeType });
  const raw = await getClient().audio.transcriptions.create({
    file,
    model: req.model,
    ...(req.language ? { language: req.language } : {}),
    ...(req.prompt ? { prompt: req.prompt } : {}),
    ...(req.responseFormat ? { response_format: req.responseFormat } : {}),
  });
  return { model: req.model, provider: "openai", raw };
}
