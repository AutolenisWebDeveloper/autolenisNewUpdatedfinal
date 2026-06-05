// Zura Phase 4 — OpenAI Whisper speech-to-text for the voice receptionist.
//
// Replaces Twilio's built-in `experimental_conversations` STT, which mangles
// vehicle names, zip codes, dollar amounts, and trim levels — exactly the data
// AutoLenis needs to extract. Twilio records a short audio clip via <Record>
// and calls /api/twilio/voice/recording-complete with a RecordingUrl; this
// service downloads that clip and transcribes it with Whisper (whisper-1).
//
// Every failure path returns provider: "twilio_fallback" so the caller can be
// re-asked with the standard <Gather> STT — Whisper never breaks the call.

import OpenAI, { toFile } from "openai";

const WHISPER_MODEL = "whisper-1";

// Domain hint fed to Whisper so it biases toward the vocabulary AutoLenis
// callers actually use. Improves recognition of makes/models and numbers.
const WHISPER_PROMPT_HINT =
  "AutoLenis car buying service. Caller may mention vehicle makes, models, " +
  "zip codes, dollar amounts, and trim levels.";

// Twilio needs a beat to finalize a recording after the <Record> action
// callback fires, so the first fetch can 404. Retry a few times, briefly.
const FETCH_ATTEMPTS = 4;
const FETCH_BACKOFF_MS = [400, 800, 1600];

// Below this average segment log-probability Whisper's output is treated as
// "low" confidence, prompting Zura to ask the caller to repeat.
const LOW_CONFIDENCE_LOGPROB = -0.85;

export interface WhisperTranscriptResult {
  text: string;
  confidence: "high" | "low";
  durationSeconds: number;
  provider: "whisper" | "twilio_fallback";
}

let _client: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("[zura-p4] OPENAI_API_KEY not configured");
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Download the recorded audio from Twilio. The action callback gives us a
// RecordingUrl without an extension; appending .mp3 yields a compressed clip
// Whisper accepts directly. Authenticated with the Twilio account creds.
async function fetchRecording(recordingUrl: string): Promise<ArrayBuffer | null> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    console.error("[zura-p4] Missing Twilio credentials — cannot fetch recording");
    return null;
  }

  const url = recordingUrl.endsWith(".mp3") ? recordingUrl : `${recordingUrl}.mp3`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
      if (res.ok) return await res.arrayBuffer();
      // 404 means the recording isn't finalized yet — wait and retry.
      if (res.status === 404 && attempt < FETCH_ATTEMPTS - 1) {
        await sleep(FETCH_BACKOFF_MS[attempt] ?? 1600);
        continue;
      }
      console.error(`[zura-p4] Recording fetch failed: HTTP ${res.status}`);
      return null;
    } catch (err) {
      console.error("[zura-p4] Recording fetch error:", err);
      if (attempt < FETCH_ATTEMPTS - 1) {
        await sleep(FETCH_BACKOFF_MS[attempt] ?? 1600);
        continue;
      }
      return null;
    }
  }
  return null;
}

// Whisper verbose_json returns per-segment avg_logprob; average it into a
// coarse high/low confidence signal so the route can re-ask on poor audio.
function scoreConfidence(
  segments: Array<{ avg_logprob?: number }> | undefined,
): "high" | "low" {
  if (!segments || segments.length === 0) return "low";
  const logprobs = segments
    .map((s) => s.avg_logprob)
    .filter((v): v is number => typeof v === "number");
  if (logprobs.length === 0) return "high";
  const avg = logprobs.reduce((a, b) => a + b, 0) / logprobs.length;
  return avg >= LOW_CONFIDENCE_LOGPROB ? "high" : "low";
}

export async function transcribeAudio(
  recordingUrl: string,
  recordingSid: string,
): Promise<WhisperTranscriptResult> {
  const fallback: WhisperTranscriptResult = {
    text: "",
    confidence: "low",
    durationSeconds: 0,
    provider: "twilio_fallback",
  };

  if (!process.env.OPENAI_API_KEY) {
    console.warn("[zura-p4] OPENAI_API_KEY unset — falling back to Twilio STT");
    return fallback;
  }

  try {
    const audio = await fetchRecording(recordingUrl);
    if (!audio || audio.byteLength === 0) {
      console.warn(`[zura-p4] No audio for recording ${recordingSid} — Twilio fallback`);
      return fallback;
    }

    const file = await toFile(Buffer.from(audio), `${recordingSid}.mp3`, {
      type: "audio/mpeg",
    });

    const result = await getOpenAI().audio.transcriptions.create({
      file,
      model: WHISPER_MODEL,
      language: "en",
      prompt: WHISPER_PROMPT_HINT,
      response_format: "verbose_json",
    });

    // verbose_json widens the return type; read the fields defensively.
    const raw = result as unknown as {
      text?: string;
      duration?: number;
      segments?: Array<{ avg_logprob?: number }>;
    };
    const text = (raw.text ?? "").trim();
    const durationSeconds = typeof raw.duration === "number" ? raw.duration : 0;
    const confidence = text ? scoreConfidence(raw.segments) : "low";

    console.log(
      `[zura-p4] Whisper transcribed: "${text.slice(0, 120)}"` +
        ` | confidence: ${confidence}, duration: ${durationSeconds.toFixed(1)}s`,
    );

    return { text, confidence, durationSeconds, provider: "whisper" };
  } catch (err) {
    console.error("[zura-p4] Whisper transcription failed:", err);
    return fallback;
  }
}
