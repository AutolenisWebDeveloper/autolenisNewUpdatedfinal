import { logger } from "@/lib/logger";
import { providerFetch } from "@/lib/social/providers/http";
// AutoLenis Social Engine — OpenAI image provider (Images API).
//
// Primary still-image provider for social posts. Given a post's visual prompt
// plus franchise/platform/vehicle/geo context, it builds a platform-optimized,
// brand-styled prompt and asks the configured OpenAI image model for a single
// photorealistic image. The model is configurable via OPENAI_IMAGE_MODEL
// (default "gpt-image-1") so an account without dall-e-3 access can switch
// without a code change. Returns either a hosted URL (dall-e-*) or base64
// (gpt-image-1), normalized into the result. Defensive throughout: a missing key
// or an API error yields a typed failure result rather than throwing.

// Default model. gpt-image-1 is OpenAI's current image model and the most widely
// available; override with OPENAI_IMAGE_MODEL (e.g. "dall-e-3", "dall-e-2").
const DEFAULT_IMAGE_MODEL = "gpt-image-1";

export function getImageModel(): string {
  return process.env.OPENAI_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL;
}

export interface DalleImageResult {
  success: boolean;
  imageUrl?: string;
  imageB64?: string;
  revisedPrompt?: string;
  model?: string;
  error?: string;
}

// Per-platform framing guidance fed into the prompt.
const PLATFORM_SPECS: Record<string, string> = {
  tiktok: "vertical 9:16 aspect ratio, mobile-optimized",
  instagram: "square or vertical format, high contrast, eye-catching",
  facebook: "horizontal 16:9 or square, clean professional look",
  youtube: "vertical 9:16 for Shorts, bold text-friendly background",
  linkedin: "professional horizontal format, clean corporate aesthetic",
};

// Per-franchise art direction so each content franchise has a recognizable look.
const FRANCHISE_STYLES: Record<string, string> = {
  dealer_secret_daily:
    "dramatic lighting, dark background, spotlight effect, documentary style, serious mood",
  dealer_fee_breakdown:
    "clean infographic style, white background, blue accent colors, professional",
  city_market_alert:
    "aerial city view, modern urban feel, data visualization overlay aesthetic",
  vehicle_price_watch:
    "sleek automotive photography style, showroom lighting, premium feel",
  buyer_win_story:
    "warm celebratory feel, bright colors, success and achievement aesthetic",
  how_autolenis_works:
    "clean modern tech aesthetic, blue gradients, trust and security feel",
  financing_friday:
    "professional financial aesthetic, clean numbers and charts style",
  trade_in_tuesday:
    "car dealership lot aesthetic, multiple vehicles, comparison feel",
  autolenis_market_index:
    "data dashboard aesthetic, charts and graphs, professional blue theme",
  auction_countdown:
    "urgent countdown aesthetic, timer elements, competitive energy",
  offer_received:
    "celebration aesthetic, envelope opening, positive outcome",
  dealer_growth:
    "professional business growth aesthetic, upward trend charts, corporate clean",
  market_stats_dealer:
    "automotive market data aesthetic, clean charts, professional blue",
};

// Platforms that read best as a landscape image; everything else gets portrait.
const LANDSCAPE_PLATFORMS = new Set(["linkedin", "facebook"]);

interface DalleApiSuccess {
  data?: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>;
}

interface DalleApiError {
  error?: { message?: string };
}

// Builds the model-appropriate request body. The OpenAI image models differ in
// their accepted size/quality values and response shape, so each is mapped here
// rather than assuming dall-e-3 semantics.
function buildImageRequest(
  model: string,
  prompt: string,
  landscape: boolean,
): Record<string, unknown> {
  const base: Record<string, unknown> = { model, prompt: prompt.slice(0, 4000), n: 1 };
  if (model === "gpt-image-1") {
    // gpt-image-1 returns base64 (no url option) and uses *_1536/auto sizes.
    base.size = landscape ? "1536x1024" : "1024x1536";
    base.quality = "medium"; // low | medium | high | auto
  } else if (model === "dall-e-2") {
    base.size = "1024x1024"; // dall-e-2 supports squares only
  } else {
    // dall-e-3 (and unknown models default to dall-e-3 semantics).
    base.size = landscape ? "1792x1024" : "1024x1792";
    base.quality = "standard"; // standard | hd
  }
  return base;
}

export async function generateDalleImage(input: {
  visualPrompt: string;
  franchise: string;
  platform: string;
  make?: string | null;
  metro?: string | null;
  hookType?: string | null;
}): Promise<DalleImageResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { success: false, error: "OPENAI_API_KEY not configured" };
  }

  const platform = input.platform.toLowerCase();
  const platformSpec = PLATFORM_SPECS[platform] ?? "square format, high contrast";
  const franchiseStyle =
    FRANCHISE_STYLES[input.franchise] ?? "modern automotive aesthetic, professional";

  const vehiclePart = input.make
    ? `featuring a ${input.make} vehicle`
    : "featuring a modern automotive scene";
  const locationPart = input.metro ? `in ${input.metro}` : "in a modern American city";

  // Final prompt — optimized for DALL-E 3.
  const fullPrompt =
    `Professional automotive social media image. ` +
    `${input.visualPrompt ?? ""} ` +
    `${vehiclePart} ${locationPart}. ` +
    `Style: ${franchiseStyle}. ` +
    `Format: ${platformSpec}. ` +
    `Brand colors: deep blue #0B5FD1 accents. ` +
    `No text overlays. No watermarks. ` +
    `Photorealistic, high quality, social media ready.`;

  // landscape for LinkedIn/Facebook, portrait/vertical for TikTok/IG/YouTube.
  const model = getImageModel();
  const landscape = LANDSCAPE_PLATFORMS.has(platform);

  try {
    const response = await providerFetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildImageRequest(model, fullPrompt, landscape)),
    });

    if (!response.ok) {
      const errBody = (await response.json().catch(() => null)) as DalleApiError | null;
      logger.error(`[image:${model}] API error:`, errBody);
      return {
        success: false,
        model,
        error: `OpenAI image API ${response.status}: ${
          errBody?.error?.message ?? "unknown error"
        }`,
      };
    }

    const data = (await response.json()) as DalleApiSuccess;
    const first = data?.data?.[0];
    const imageUrl = first?.url;
    const imageB64 = first?.b64_json;
    const revisedPrompt = first?.revised_prompt;

    if (!imageUrl && !imageB64) {
      return { success: false, model, error: "No image URL or base64 in OpenAI response" };
    }

    logger.info(`[image:${model}] generated image for:`, input.franchise, input.platform);
    return { success: true, imageUrl, imageB64, revisedPrompt, model };
  } catch (err) {
    logger.error("[image] generation failed:", err);
    return {
      success: false,
      model,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
