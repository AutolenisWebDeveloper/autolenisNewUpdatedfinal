// AutoLenis Social Engine — Visual Prompt Engine.
//
// Generates professional, platform-aware visual prompts for AI image + video
// generation. Mirrors the REST Groq call pattern used by the script engine:
// direct fetch to the OpenAI-compatible chat-completions endpoint, retry on
// 429/503, strict JSON output. Falls back to franchise-specific templates when
// Groq is unavailable so every post can still receive a high-quality visual.

import { logger } from "@/lib/logger";
import { GROQ_SUMMARY } from "@/lib/ai/acquisition";

export interface VisualPromptInput {
  franchise: string;
  contentType: string;
  platform: string;
  make?: string;
  model?: string;
  city?: string;
  hookType: string;
  script: string;
  year?: string;
}

export type VisualStyle = "cinematic" | "editorial" | "lifestyle";
export type VisualAspectRatio = "9:16" | "16:9" | "1:1";

export interface VisualPromptOutput {
  imagePrompt: string; // for text-to-image
  videoPrompt: string; // for image-to-video motion
  style: VisualStyle; // cinematic | editorial | lifestyle
  aspectRatio: VisualAspectRatio; // platform-appropriate aspect ratio
  motionStrength: number; // 0.6 - 0.9
  negativePrompt: string; // what to avoid
  onScreenText: string; // text overlay for video
}

// ─── Platform → aspect ratio defaults ────────────────────────────────────────
const VERTICAL_PLATFORMS = new Set(["tiktok", "instagram", "youtube"]);

function defaultAspectRatio(platform: string): VisualAspectRatio {
  const p = platform.toLowerCase();
  if (VERTICAL_PLATFORMS.has(p)) return "9:16";
  if (p === "linkedin") return "16:9";
  return "1:1"; // facebook + fallback
}

// ─── Franchise visual templates ──────────────────────────────────────────────
// Each template provides a base image prompt (with [token] substitutions), a
// default style, and a default motion strength. Used both as guidance to Groq
// and as the deterministic fallback when Groq is unavailable.
interface FranchiseTemplate {
  imagePrompt: string;
  style: VisualStyle;
  motionStrength: number;
}

const FRANCHISE_TEMPLATES: Record<string, FranchiseTemplate> = {
  dealer_secret_daily: {
    imagePrompt:
      "Close-up of a car contract on a dealer desk, dramatic lighting, one hand holding a pen hesitating, cinematic depth of field, [city] skyline visible through dealership window",
    style: "cinematic",
    motionStrength: 0.8,
  },
  city_market_alert: {
    imagePrompt:
      "Aerial cinematic view of [city] downtown at golden hour, luxury vehicles on the street, modern city energy, aspirational lifestyle",
    style: "editorial",
    motionStrength: 0.7,
  },
  vehicle_price_watch: {
    imagePrompt:
      "[year] [make] [model] parked on a clean suburban street at golden hour, professional automotive photography style, [city] neighborhood",
    style: "cinematic",
    motionStrength: 0.75,
  },
  how_autolenis_works: {
    imagePrompt:
      "Modern professional using phone in a comfortable home setting, multiple offer cards floating around them digitally, clean tech aesthetic, confident expression, natural lighting",
    style: "lifestyle",
    motionStrength: 0.65,
  },
  buyer_win_story: {
    imagePrompt:
      "Happy person receiving car keys at a modern dealership, genuine smile, clean bright environment, no visible prices or signs",
    style: "lifestyle",
    motionStrength: 0.6,
  },
  dealer_fee_breakdown: {
    imagePrompt:
      "Split screen: stressed person at traditional dealership vs confident person on phone comparing offers, modern clean aesthetic",
    style: "cinematic",
    motionStrength: 0.8,
  },
};

const DEFAULT_TEMPLATE: FranchiseTemplate = {
  imagePrompt:
    "Premium late-model vehicle on a clean city street at golden hour, professional automotive photography, aspirational modern lifestyle, [city]",
  style: "cinematic",
  motionStrength: 0.7,
};

const DEFAULT_NEGATIVE_PROMPT =
  "price tags, dealer signage, watermarks, logos, text artifacts, distorted faces, extra limbs, low quality, blurry, oversaturated, stressed or frustrated people, clutter";

function fillTokens(template: string, input: VisualPromptInput): string {
  return template
    .replace(/\[city\]/gi, input.city?.trim() || "a modern American city")
    .replace(/\[make\]/gi, input.make?.trim() || "")
    .replace(/\[model\]/gi, input.model?.trim() || "")
    .replace(/\[year\]/gi, input.year?.trim() || "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function templateFor(franchise: string): FranchiseTemplate {
  return FRANCHISE_TEMPLATES[franchise] ?? DEFAULT_TEMPLATE;
}

// Deterministic fallback that never throws — guarantees a usable visual prompt.
function buildFallback(input: VisualPromptInput): VisualPromptOutput {
  const tpl = templateFor(input.franchise);
  const imagePrompt = fillTokens(tpl.imagePrompt, input);
  const aspectRatio = defaultAspectRatio(input.platform);
  return {
    imagePrompt,
    videoPrompt: `Slow cinematic camera push-in on the scene, subtle parallax, smooth motion, ${tpl.style} grade`,
    style: tpl.style,
    aspectRatio,
    motionStrength: tpl.motionStrength,
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
    onScreenText: "",
  };
}

// ─── Groq helper (mirrors groq-script.engine.ts REST pattern) ────────────────
async function callGroq(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey.startsWith("gsk_placeholder")) {
    throw new Error("GROQ_API_KEY is not configured");
  }
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: GROQ_SUMMARY, // llama-3.3-70b-versatile
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 900,
      temperature: 0.7,
      top_p: 1.0,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Groq HTTP ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

async function callGroqWithRetry(systemPrompt: string, userPrompt: string): Promise<string> {
  const maxAttempts = 3;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await callGroq(systemPrompt, userPrompt);
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("429") && !message.includes("503")) throw err;
      if (attempt === maxAttempts - 1) throw err;
      const backoffMs = Math.min(8000 * Math.pow(2, attempt), 32000);
      logger.warn(`[visual-prompt] retry ${attempt + 1}/${maxAttempts} after ${backoffMs}ms`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastError;
}

const SYSTEM_PROMPT = `You are a professional automotive content director.
You create visual prompts for AI-generated social media content for AutoLenis,
a premium car-buying platform.

AutoLenis brand: Premium, trustworthy, modern, buyer-first.
Primary color: #0B5FD1 (deep blue)
Style: Clean, cinematic, aspirational but accessible.

PLATFORM REQUIREMENTS:
- TikTok/Instagram Reels/YouTube Shorts: 9:16 vertical, cinematic, high motion,
  eye-catching first frame
- Facebook: 1:1 or 16:9, lifestyle, warm lighting
- LinkedIn: 16:9, professional, clean, editorial
- Instagram feed: 1:1, high quality, aspirational

AUTOMOTIVE VISUAL STANDARDS:
- Vehicles must look premium and aspirational
- Never show price tags or dealer signs
- Use real-world environments (cities, roads, suburbs)
- Lighting: golden hour or clean studio-style
- No people showing stress or frustration
- Show confidence, ease, and modern lifestyle

Return ONLY valid JSON. No markdown.`;

function buildUserPrompt(input: VisualPromptInput, tpl: FranchiseTemplate): string {
  const baseImage = fillTokens(tpl.imagePrompt, input);
  const vehicle = [input.year, input.make, input.model].filter(Boolean).join(" ").trim();
  return `Create a visual prompt for this social post:
Franchise: ${input.franchise}
Content type: ${input.contentType}
Platform: ${input.platform}
Vehicle: ${vehicle || "n/a"}
City: ${input.city ?? "n/a"}
Hook emotion: ${input.hookType}
Script summary: ${(input.script ?? "").slice(0, 100)}

Use this base direction as inspiration: "${baseImage}"
Suggested style: ${tpl.style}. Suggested motion strength: ${tpl.motionStrength}.

Return:
{
  "imagePrompt": "detailed cinematic image description",
  "videoPrompt": "camera motion description for video",
  "style": "cinematic or editorial or lifestyle",
  "aspectRatio": "9:16 or 16:9 or 1:1",
  "motionStrength": 0.7,
  "negativePrompt": "what to avoid",
  "onScreenText": "bold text to show on screen"
}`;
}

function stripFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  return s;
}

function coerceStyle(v: unknown): VisualStyle {
  const s = typeof v === "string" ? v.toLowerCase() : "";
  if (s === "editorial" || s === "lifestyle") return s;
  return "cinematic";
}

function coerceAspect(v: unknown, fallback: VisualAspectRatio): VisualAspectRatio {
  const s = typeof v === "string" ? v.trim() : "";
  if (s === "9:16" || s === "16:9" || s === "1:1") return s;
  return fallback;
}

function clampMotion(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(0.9, Math.max(0.6, n));
}

// Generates a professional visual prompt for a social post. Always resolves to a
// usable VisualPromptOutput — on any Groq/parse failure it returns the
// deterministic franchise template fallback so visual generation never blocks.
export async function generateVisualPrompt(
  input: VisualPromptInput,
): Promise<VisualPromptOutput> {
  const tpl = templateFor(input.franchise);
  const fallback = buildFallback(input);
  try {
    const raw = await callGroqWithRetry(SYSTEM_PROMPT, buildUserPrompt(input, tpl));
    const parsed = JSON.parse(stripFences(raw)) as Record<string, unknown>;
    const imagePrompt =
      typeof parsed.imagePrompt === "string" && parsed.imagePrompt.trim()
        ? parsed.imagePrompt.trim()
        : fallback.imagePrompt;
    const videoPrompt =
      typeof parsed.videoPrompt === "string" && parsed.videoPrompt.trim()
        ? parsed.videoPrompt.trim()
        : fallback.videoPrompt;
    return {
      imagePrompt,
      videoPrompt,
      style: coerceStyle(parsed.style),
      aspectRatio: coerceAspect(parsed.aspectRatio, defaultAspectRatio(input.platform)),
      motionStrength: clampMotion(parsed.motionStrength, tpl.motionStrength),
      negativePrompt:
        typeof parsed.negativePrompt === "string" && parsed.negativePrompt.trim()
          ? parsed.negativePrompt.trim()
          : DEFAULT_NEGATIVE_PROMPT,
      onScreenText: typeof parsed.onScreenText === "string" ? parsed.onScreenText.trim() : "",
    };
  } catch (err) {
    logger.warn(
      "[visual-prompt] Groq generation failed, using franchise template fallback:",
      err instanceof Error ? err.message : err,
    );
    return fallback;
  }
}
