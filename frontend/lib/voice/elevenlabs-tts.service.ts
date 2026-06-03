// ElevenLabs text-to-speech for Zura's voice receptionist.
//
// Synthesizes spoken audio with the cloned professional voice "Jessica Anne
// Bogart", uploads the MP3 to the public `zura-audio` Supabase storage bucket,
// and returns the public URL that the Twilio routes hand to <Play>. Every
// failure path returns null so callers can fall back to Polly <Say> and the
// call never breaks.

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1/text-to-speech";

// Eleven V3 model — highest quality, ~600-800ms latency.
// Falls back to Turbo v2.5 if V3 is unavailable on this
// ElevenLabs tier.
const ELEVENLABS_PRIMARY_MODEL = "eleven_v3";
const ELEVENLABS_FALLBACK_MODEL = "eleven_turbo_v2_5";
const SUPABASE_BUCKET = "zura-audio";

// V3-optimized settings for phone receptionist quality
const V3_VOICE_SETTINGS = {
  stability: 0.65,
  similarity_boost: 0.8,
  style: 0.2,
  use_speaker_boost: true,
};

// Turbo v2.5 fallback settings (original tuning)
const TURBO_VOICE_SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0.15,
  use_speaker_boost: true,
};

interface GenerateSpeechResult {
  audioUrl: string;
  fileName: string;
}

let supabaseClient: ReturnType<typeof createClient> | null = null;

function getSupabase() {
  if (!supabaseClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    supabaseClient = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return supabaseClient;
}

async function uploadAudioAndGetUrl(
  audioBytes: Uint8Array,
  supabase: ReturnType<typeof getSupabase>,
): Promise<GenerateSpeechResult | null> {
  const fileName = `zura-${Date.now()}-${randomUUID().slice(0, 8)}.mp3`;

  const { error: uploadError } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .upload(fileName, audioBytes, {
      contentType: "audio/mpeg",
      cacheControl: "3600",
      upsert: false,
    });

  if (uploadError) {
    console.error(`[elevenlabs] Supabase upload failed: ${uploadError.message}`);
    return null;
  }

  const { data: urlData } = supabase.storage
    .from(SUPABASE_BUCKET)
    .getPublicUrl(fileName);

  if (!urlData?.publicUrl) {
    console.error("[elevenlabs] Failed to get public URL");
    return null;
  }

  return { audioUrl: urlData.publicUrl, fileName };
}

export async function generateZuraSpeech(
  text: string,
): Promise<GenerateSpeechResult | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey || !voiceId) {
    console.error("[elevenlabs] Missing API key or voice ID");
    return null;
  }

  const supabase = getSupabase();

  // Helper: call ElevenLabs API with given model + settings
  async function callElevenLabs(
    modelId: string,
    voiceSettings: typeof V3_VOICE_SETTINGS,
  ): Promise<{
    ok: boolean;
    status?: number;
    errorText?: string;
    audioBytes?: Uint8Array;
  }> {
    try {
      const response = await fetch(`${ELEVENLABS_API_URL}/${voiceId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": apiKey!,
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: voiceSettings,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "unknown");
        return { ok: false, status: response.status, errorText };
      }

      const audioBuffer = await response.arrayBuffer();
      return { ok: true, audioBytes: new Uint8Array(audioBuffer) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, errorText: msg };
    }
  }

  // ATTEMPT 1: Eleven V3 (primary, premium quality)
  console.log(`[elevenlabs] Attempting V3 model`);
  const v3Result = await callElevenLabs(
    ELEVENLABS_PRIMARY_MODEL,
    V3_VOICE_SETTINGS,
  );

  if (v3Result.ok && v3Result.audioBytes) {
    console.log(`[elevenlabs] V3 succeeded`);
    return await uploadAudioAndGetUrl(v3Result.audioBytes, supabase);
  }

  // V3 failed — log and try fallback
  console.warn(
    `[elevenlabs] V3 failed (status ${v3Result.status}): ${v3Result.errorText?.substring(0, 200)}. Falling back to Turbo v2.5`,
  );

  // ATTEMPT 2: Eleven Turbo v2.5 (fallback)
  const turboResult = await callElevenLabs(
    ELEVENLABS_FALLBACK_MODEL,
    TURBO_VOICE_SETTINGS,
  );

  if (turboResult.ok && turboResult.audioBytes) {
    console.log(`[elevenlabs] Turbo v2.5 fallback succeeded`);
    return await uploadAudioAndGetUrl(turboResult.audioBytes, supabase);
  }

  // Both failed
  console.error(
    `[elevenlabs] BOTH models failed. Turbo error (status ${turboResult.status}): ${turboResult.errorText?.substring(0, 200)}`,
  );
  return null;
}
