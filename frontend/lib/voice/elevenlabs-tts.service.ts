// ElevenLabs Turbo v2.5 text-to-speech for Zura's voice receptionist.
//
// Synthesizes spoken audio with the cloned professional voice "Jessica Anne
// Bogart", uploads the MP3 to the public `zura-audio` Supabase storage bucket,
// and returns the public URL that the Twilio routes hand to <Play>. Every
// failure path returns null so callers can fall back to Polly <Say> and the
// call never breaks.

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1/text-to-speech";
const ELEVENLABS_MODEL = "eleven_turbo_v2_5";
const SUPABASE_BUCKET = "zura-audio";

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

export async function generateZuraSpeech(
  text: string,
): Promise<GenerateSpeechResult | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey || !voiceId) {
    console.error("[elevenlabs] Missing API key or voice ID");
    return null;
  }

  try {
    const response = await fetch(`${ELEVENLABS_API_URL}/${voiceId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.15,
          use_speaker_boost: true,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown");
      console.error(
        `[elevenlabs] API error ${response.status}: ${errorText.substring(0, 200)}`,
      );
      return null;
    }

    const audioBuffer = await response.arrayBuffer();
    const audioBytes = new Uint8Array(audioBuffer);

    const fileName = `zura-${Date.now()}-${randomUUID().slice(0, 8)}.mp3`;
    const supabase = getSupabase();

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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[elevenlabs] Unexpected error: ${msg}`);
    return null;
  }
}
