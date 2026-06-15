// POST /api/admin/social/compose/ai-generate
// Takes platform + franchise + optional topic and returns AI-generated hook,
// caption, video script, hashtags, image brief, and an immediate quality score.
// Powers the AI-first ComposeDrawer in the social dashboard.

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

interface AIGenerateBody {
  platform?: string;
  franchiseSlug?: string;
  topic?: string;
  personality?: string;
  includeVideoScript?: boolean;
}

const PERSONALITIES: Record<string, string> = {
  buyer_advocate:
    "A consumer protection journalist who is outraged on behalf of car buyers. Says 'your dealer' and 'they do this'. Urgent and protective.",
  dealer_insider:
    "A former dealership finance manager exposing industry secrets. Says 'I worked at dealerships for 8 years' and 'we were trained'. Confessional.",
  market_analyst:
    "A Bloomberg-level automotive market analyst. Data-driven, cites specific numbers, professional authority.",
  negotiator:
    "A negotiation coach giving exact scripts. Says 'here is the exact script' and 'say these exact words'. Tactical.",
};

const PLATFORM_CAPTION_LENGTH: Record<string, number> = {
  tiktok: 150,
  instagram: 300,
  facebook: 400,
  youtube: 200,
  linkedin: 500,
};

const PLATFORM_CTAS: Record<string, string> = {
  tiktok: "Save this video 🔖 or Share with someone buying a car this month",
  instagram: "Save this post 🔖",
  facebook: "End with a question asking for personal experience",
  youtube: "Subscribe for weekly dealer secrets",
  linkedin: "End with a professional discussion question",
};

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const body: AIGenerateBody = await request.json().catch(() => ({}));
  const {
    platform = "tiktok",
    franchiseSlug = "dealer_secret_daily",
    topic,
    personality = "buyer_advocate",
    includeVideoScript = true,
  } = body;

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) {
    return adminError("CONFIG_ERROR", "GROQ_API_KEY not configured", 500);
  }

  // Get franchise details
  const franchise = await prisma.contentFranchise
    .findUnique({ where: { slug: franchiseSlug } })
    .catch(() => null);

  // Get trending hashtags from cache
  const { getOrFetchTrendingData } = await import(
    "@/lib/social/trending-intelligence.engine"
  );
  const trending = await getOrFetchTrendingData().catch(() => null);
  const trendingTags = (trending?.tiktokHashtags ?? []).slice(0, 5).join(", ");

  // Get viral format for this platform
  const { VIRAL_FORMATS } = await import("@/lib/social/viral-formats");
  const formats = VIRAL_FORMATS[platform as keyof typeof VIRAL_FORMATS] ?? [];
  const topFormat = formats[0];

  const voice = PERSONALITIES[personality] ?? PERSONALITIES.buyer_advocate;
  const captionLen = PLATFORM_CAPTION_LENGTH[platform] ?? 300;
  const isVertical =
    platform === "tiktok" || platform === "instagram" || platform === "youtube";

  const prompt = `You are an expert automotive social media content creator.
Generate a high-performing ${platform} post about: ${topic ?? franchise?.name ?? franchiseSlug}

VOICE TO USE: ${voice}

${topFormat ? `VIRAL FORMAT STRUCTURE:\n${topFormat.structure}\n` : ""}

PLATFORM: ${platform}
CAPTION LENGTH: Under ${captionLen} words
CTA STYLE: ${PLATFORM_CTAS[platform] ?? "Clear call to action"}
TRENDING HASHTAGS TO USE: ${trendingTags}

${topic ? `SPECIFIC TOPIC: ${topic}` : ""}

Return ONLY valid JSON, no markdown, no other text:
{
  "hook": "scroll-stopping opening line under 15 words using ${voice} voice",
  "caption": "complete caption under ${captionLen} words with CTA at end",
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],
  "hookType": "fear|curiosity|savings|comparison|social_proof|controversy",
  ${
    includeVideoScript
      ? `"videoScript": {
    "hook_0_3s": "exact words for first 3 seconds",
    "beat1_3_10s": "content for 3-10 seconds",
    "beat2_10_20s": "content for 10-20 seconds",
    "beat3_20_25s": "content for 20-25 seconds",
    "cta_25_30s": "call to action",
    "onScreenText": "text to show on screen",
    "voiceover": "complete voiceover script"
  },`
      : ""
  }
  "imageBrief": "detailed DALL-E image generation prompt: describe the perfect ${platform}-optimized visual for this content. Include: main subject, lighting, mood, color palette (AutoLenis blue #0B5FD1 accents), composition, ${
    isVertical ? "VERTICAL 9:16 format" : "HORIZONTAL 16:9 format"
  }. No text overlays. Photorealistic. High quality.",
  "scheduleSuggestion": "best day and time to post this on ${platform} for maximum reach"
}`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1200,
      }),
    });

    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content ?? "{}";
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const generated = JSON.parse(cleaned);

    // Score the quality immediately
    const { scorePostQuality } = await import("@/lib/social/content-quality.gate");
    const quality = scorePostQuality({
      hook: generated.hook ?? "",
      script: generated.caption ?? "",
      caption: generated.caption ?? "",
      ctaText: generated.caption ?? "",
      platform,
      franchise: franchiseSlug,
      complianceNotes: null,
    });

    return adminSuccess({
      ...generated,
      qualityScore: quality,
      platform,
      franchiseSlug,
    });
  } catch (err) {
    logger.error("[ai-generate] failed:", err);
    return adminError(
      "AI_GENERATION_FAILED",
      "AI generation failed — check GROQ_API_KEY",
      500,
    );
  }
}
