// AutoLenis Social Engine — Groq Script Engine.
//
// Generates platform-optimized social content (hook, script, caption, hashtags,
// CTA, video prompt, voiceover) from a franchise + signal. Mirrors the REST
// Groq call pattern used by the dealer-outreach email template service: direct
// fetch to the OpenAI-compatible chat-completions endpoint, retry on 429/503,
// strict JSON output. Model is llama-3.3-70b-versatile (GROQ_SUMMARY).

import { GROQ_SUMMARY } from "@/lib/ai/acquisition";
import type { ContentFranchise, TopicSignal } from "@prisma/client";
import { getFunnelDestination, type PlatformConfig } from "@/lib/social/config";
import type { TrendingData } from "./trending-intelligence.engine";
import type { ViralFormat } from "./viral-formats";
import type { AutoLenisPersonality } from "./personalities";
import type { VideoLearnings } from "./video-learning.engine";

export interface SocialScriptInput {
  franchise: ContentFranchise;
  signal: TopicSignal;
  platform: string;
  hookType: string;
  platformConfig: PlatformConfig;
  signalContext?: Record<string, unknown>;
  // Optional steer for a regeneration pass when a first attempt scored too low
  // on the content quality gate. Appended to the user prompt verbatim.
  qualityFeedback?: string;
  // ─── Session C viral intelligence (all optional, injected when available) ──
  // Live trending hashtags/topics, the viral structure template to follow, the
  // synthetic personality to speak as, and learned best/worst hook types.
  trendingData?: TrendingData | null;
  viralFormat?: ViralFormat | null;
  personality?: AutoLenisPersonality | null;
  videoLearnings?: VideoLearnings | null;
}

export interface SocialScriptOutput {
  hook: string;
  hookType: string;
  script: string;
  caption: string;
  hashtags: string[];
  ctaText: string;
  ctaPlacement: string;
  visualPrompt: string;
  visualStyle: string;
  voiceoverText: string;
  onScreenText: string;
  durationSeconds: number;
  complianceNotes: string | null;
  funnelDestination: string;
}

// ─── Groq helper (mirrors email-template.service.ts REST pattern) ────────────
async function callGroq(options: {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey.startsWith("gsk_placeholder")) {
    throw new Error("GROQ_API_KEY is not configured");
  }

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_SUMMARY, // llama-3.3-70b-versatile
      messages: [
        { role: "system", content: options.systemPrompt },
        { role: "user", content: options.userPrompt },
      ],
      max_tokens: options.maxTokens ?? 1400,
      temperature: options.temperature ?? 0.7,
      top_p: 1.0,
    }),
  });

  console.log("[groq-script] response status:", res.status);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Groq HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawText = data.choices?.[0]?.message?.content ?? "";
  console.log("[groq-script] raw response:", rawText?.slice(0, 200));
  return rawText;
}

async function callGroqWithRetry(
  params: Parameters<typeof callGroq>[0],
): Promise<string> {
  const maxAttempts = 3;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await callGroq(params);
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("429") && !message.includes("503")) throw err;
      if (attempt === maxAttempts - 1) throw err;
      const backoffMs = Math.min(8000 * Math.pow(2, attempt), 32000);
      console.warn(
        `[social-groq] retry ${attempt + 1}/${maxAttempts} after ${backoffMs}ms: ${message.slice(0, 120)}`,
      );
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastError;
}

const SYSTEM_PROMPT = `You are the AutoLenis social media content engine.
AutoLenis is a buyer-first automotive reverse-auction platform.
Qualified buyers submit vehicle requests. Up to 8 local dealers
compete in a private 48-hour auction. Buyers compare offers
and select the best price — all without walking into a dealership.

You generate platform-optimized social media content that drives
qualified buyers to submit vehicle requests at autolenis.com.

CONTENT RULES — NEVER VIOLATE:
1. Never claim specific dollar savings unless backed by data provided.
2. Never guarantee approval, savings, or dealer participation.
3. Never use the words: guarantee, guaranteed, guarantees, promise, promised, assured.
4. Buyer-win stories must be generic ("buyers often find", "many buyers report")
   unless specific verified data is provided.
5. Finance-related content must never imply guaranteed approval or specific rates.
6. All claims must be supportable by AutoLenis platform data or general market facts.
7. Include compliance notes if any claim needs review.

PLATFORM RULES:
- Facebook: up to 63,206 chars, put link in caption, 30s-60s video
- Instagram: max 2,200 chars, NO link in caption (say "link in bio"),
  use 20-30 hashtags, 15-30s video
- TikTok: max 2,200 chars, hook must land in first 3 seconds,
  use 5-10 relevant hashtags, 15-60s video
- YouTube: description up to 5,000 chars, 15 hashtags, 15-60s short
- LinkedIn: professional tone, max 3,000 chars, 3-5 hashtags,
  data-driven insights preferred

VIRAL CONTENT RULES — FOLLOW THESE IN ADDITION TO EXISTING RULES:

1. HOOK MUST STOP THE SCROLL IN 3 SECONDS
   Choose one of these hook mechanics:
   - Pattern interrupt: say something unexpected
   - Curiosity gap: force them to watch to find out
   - Fear trigger: they might be making a mistake right now
   - Social proof: others are already doing this

2. PLATFORM-SPECIFIC PACING:
   TikTok: deliver new information every 3-5 seconds.
           Never front-load context — the payoff first.
           Create a "watch to the end" moment at midpoint.
   Instagram: every frame must be worth screenshotting.
              Include a checklist, warning, or number to save.
   Facebook: end with a polarizing question that divides opinion.
             This drives the comments that drive reach.
   LinkedIn: write 150+ words minimum. Dwell time is the signal.
   YouTube: first frame IS the thumbnail.
            Make the text overlay impossible to ignore.

3. VIRAL CTA ROTATION — USE PLATFORM-SPECIFIC CTAs:
   TikTok: "Save this video 🔖" OR "Share with someone buying
            a car this month" OR "Comment [WORD] if this happened"
   Instagram: "Save this post 🔖" OR "Tag someone who needs this"
   Facebook: End with a specific question asking for personal experience
   LinkedIn: End with a professional question for discussion
   YouTube: "Subscribe for weekly dealer secrets"

4. INSTAGRAM SAVE TRIGGER:
   Every Instagram post MUST contain one save-worthy element:
   a checklist, a specific warning, a number to remember,
   or a step they will want to come back to.
   End every Instagram caption with "Save this 🔖"

5. FACEBOOK LINK RULE:
   Never put the autolenis.com link in the Facebook caption.
   Facebook suppresses reach for posts with external links.
   The link goes in the first comment after publishing.

OUTPUT FORMAT:
Return ONLY valid JSON. No markdown. No explanation.
{
  "hook": "First line — must stop the scroll in under 3 seconds",
  "hookType": "fear|curiosity|warning|savings|surprise|comparison|social_proof|controversy",
  "script": "Full video script with [PAUSE] markers for pacing",
  "caption": "Platform-specific post caption",
  "hashtags": ["hashtag1", "hashtag2"],
  "ctaText": "Call to action text",
  "ctaPlacement": "caption|first_comment|bio",
  "visualPrompt": "Cinematic description for video generation",
  "visualStyle": "Style descriptor for Higgsfield",
  "voiceoverText": "Text for text-to-speech voiceover",
  "onScreenText": "Text that appears on screen during video",
  "durationSeconds": 30,
  "complianceNotes": "null or specific review note",
  "funnelDestination": "which AutoLenis page this should link to"
}
Begin your response with { and end with }.`;

// Builds the viral-intelligence section appended to the base user prompt. Each
// block is only added when its data is present, so the prompt stays lean when a
// signal/personality/format/learning source is unavailable.
function buildViralContext(input: SocialScriptInput): string {
  const { platform, viralFormat, personality, videoLearnings, trendingData } =
    input;
  let userPromptAddition = "";

  if (viralFormat) {
    userPromptAddition +=
      `\nVIRAL FORMAT TO USE: ${viralFormat.name}\n` +
      `Follow this structure:\n${viralFormat.structure}\n`;
  }

  if (personality) {
    userPromptAddition +=
      `\nSPEAK AS: ${personality.name}\n` +
      `Voice: ${personality.voice}\n` +
      `Speak like: ${personality.speaksLike}\n` +
      `Natural catchphrases (do not force them):\n` +
      personality.catchphrases.map((c) => `- ${c}`).join("\n") +
      "\n" +
      `Example hook in this voice: "${personality.exampleHook}"\n`;
  }

  if (videoLearnings?.bestHookTypes.length) {
    userPromptAddition +=
      `\nVIDEO LEARNING DATA FOR ${platform.toUpperCase()}:\n` +
      `Best performing hooks: ` +
      videoLearnings.bestHookTypes
        .map((h) => `${h.hookType} (${h.avgCompletion}% completion)`)
        .join(", ") +
      "\n" +
      (videoLearnings.worstHookTypes.length
        ? `Avoid these (low completion): ${videoLearnings.worstHookTypes.join(", ")}\n`
        : "") +
      (videoLearnings.insights[0]
        ? `Key insight: ${videoLearnings.insights[0]}\n`
        : "");
  }

  if (trendingData) {
    if (trendingData.tiktokHashtags.length > 0) {
      userPromptAddition +=
        `\nTRENDING TODAY:\n` +
        `TikTok hashtags: ${trendingData.tiktokHashtags.slice(0, 5).join(", ")}\n`;
    }
    if (trendingData.redditTopics.length > 0) {
      userPromptAddition +=
        `Reddit buyers are asking: ` +
        trendingData.redditTopics.join("; ") +
        "\n" +
        `If relevant to this content, weave in one of these topics naturally.\n`;
    }
  }

  return userPromptAddition;
}

function buildUserPrompt(input: SocialScriptInput): string {
  const { franchise, signal, platform, hookType, platformConfig } = input;
  const context = input.signalContext ?? (signal.signalContext as Record<string, unknown>) ?? {};
  return `Generate ${platform} content for the ${franchise.name} franchise.

Signal: ${signal.signalType}
Make: ${signal.make ?? "General automotive"}
Model: ${signal.model ?? ""}
City/Metro: ${signal.city ?? signal.metro ?? "National"}
Signal Value: ${signal.signalValue ?? ""}
Signal Context: ${JSON.stringify(context)}

Hook Type to use: ${hookType}
Max caption characters: ${platformConfig.maxCaptionChars}
Max hashtags: ${platformConfig.maxHashtags}
Link in caption: ${platformConfig.linkInCaption}
Optimal video duration: ${platformConfig.optimalDurationSecs} seconds

Franchise description: ${franchise.description ?? ""}
Funnel goal: Drive the viewer to submit a vehicle request at autolenis.com${buildViralContext(
    input,
  )}${
    input.qualityFeedback ? `\n\nREGENERATION FEEDBACK: ${input.qualityFeedback}` : ""
  }`;
}

function stripFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  // Grab the outermost JSON object if extra prose slipped in.
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  return s;
}

function coerceOutput(
  parsed: Record<string, unknown>,
  input: SocialScriptInput,
): SocialScriptOutput {
  const str = (v: unknown, fallback = ""): string =>
    typeof v === "string" ? v : v == null ? fallback : String(v);
  const hashtags = Array.isArray(parsed.hashtags)
    ? parsed.hashtags.map((h) => str(h).replace(/^#/, "")).filter(Boolean)
    : [];
  const duration =
    typeof parsed.durationSeconds === "number"
      ? parsed.durationSeconds
      : input.platformConfig.optimalDurationSecs;
  const compliance = str(parsed.complianceNotes, "").trim();

  return {
    hook: str(parsed.hook),
    hookType: str(parsed.hookType, input.hookType),
    script: str(parsed.script),
    caption: str(parsed.caption),
    hashtags: hashtags.slice(0, input.platformConfig.maxHashtags),
    ctaText: str(parsed.ctaText, "Submit your vehicle request at autolenis.com"),
    ctaPlacement: str(parsed.ctaPlacement, input.platformConfig.linkInCaption ? "caption" : "bio"),
    visualPrompt: str(parsed.visualPrompt),
    visualStyle: str(parsed.visualStyle, "cinematic"),
    voiceoverText: str(parsed.voiceoverText),
    onScreenText: str(parsed.onScreenText),
    durationSeconds: duration,
    complianceNotes: compliance && compliance.toLowerCase() !== "null" ? compliance : null,
    funnelDestination: str(parsed.funnelDestination, getFunnelDestination(input.franchise.slug)),
  };
}

function parse(raw: string, input: SocialScriptInput): SocialScriptOutput {
  const json = stripFences(raw);
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const out = coerceOutput(parsed, input);
  if (!out.hook || !out.script || !out.caption) {
    throw new Error("Groq output missing required fields (hook/script/caption)");
  }
  return out;
}

// Generates one platform-specific social script. Retries once with a simpler
// prompt if the first attempt fails to produce valid JSON; throws with context
// if both attempts fail so the caller can mark the post FAILED.
export async function generateSocialScript(
  input: SocialScriptInput,
): Promise<SocialScriptOutput> {
  const userPrompt = buildUserPrompt(input);
  console.log("[groq-script] calling Groq for platform:", input.platform);
  try {
    const raw = await callGroqWithRetry({ systemPrompt: SYSTEM_PROMPT, userPrompt });
    return parse(raw, input);
  } catch (firstErr) {
    console.warn(
      `[social-groq] first attempt failed for ${input.franchise.slug}/${input.platform}: ${
        firstErr instanceof Error ? firstErr.message : String(firstErr)
      }`,
    );
    try {
      const simplePrompt = `${userPrompt}\n\nReturn ONLY the JSON object. Keep it concise.`;
      const raw = await callGroqWithRetry({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: simplePrompt,
        temperature: 0.4,
      });
      return parse(raw, input);
    } catch (secondErr) {
      throw new Error(
        `Social script generation failed for ${input.franchise.slug}/${input.platform}: ${
          secondErr instanceof Error ? secondErr.message : String(secondErr)
        }`,
      );
    }
  }
}
