// AutoLenis Social Engine — DALL-E 3 image provider (OpenAI Images API).
//
// Primary still-image provider for social posts. Given a post's visual prompt
// plus franchise/platform/vehicle/geo context, it builds a platform-optimized,
// brand-styled prompt and asks DALL-E 3 for a single photorealistic image,
// returning the hosted image URL. Defensive throughout: a missing key or an API
// error yields a typed failure result rather than throwing, so a caller can log
// the reason and move on without blocking post creation or publishing.

export interface DalleImageResult {
  success: boolean;
  imageUrl?: string;
  revisedPrompt?: string;
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
  data?: Array<{ url?: string; revised_prompt?: string }>;
}

interface DalleApiError {
  error?: { message?: string };
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
  const size = LANDSCAPE_PLATFORMS.has(platform) ? "1792x1024" : "1024x1792";

  try {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt: fullPrompt.slice(0, 4000), // DALL-E 3 prompt limit
        n: 1,
        size,
        quality: "standard", // "hd" costs 2x — use standard for volume
        // response_format removed — OpenAI no longer accepts it; URLs are returned by default
      }),
    });

    if (!response.ok) {
      const errBody = (await response.json().catch(() => null)) as DalleApiError | null;
      console.error("[dalle] API error:", errBody);
      return {
        success: false,
        error: `DALL-E API ${response.status}: ${
          errBody?.error?.message ?? "unknown error"
        }`,
      };
    }

    const data = (await response.json()) as DalleApiSuccess;
    const imageUrl = data?.data?.[0]?.url;
    const revisedPrompt = data?.data?.[0]?.revised_prompt;

    if (!imageUrl) {
      return { success: false, error: "No image URL in DALL-E response" };
    }

    console.log("[dalle] generated image for:", input.franchise, input.platform);
    return { success: true, imageUrl, revisedPrompt };
  } catch (err) {
    console.error("[dalle] generation failed:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
