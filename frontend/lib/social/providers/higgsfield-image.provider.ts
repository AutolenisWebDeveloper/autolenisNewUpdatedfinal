// AutoLenis Social Engine — Higgsfield image provider (exclusive image source).
//
// Higgsfield is the single, exclusive still-image generation provider for the
// social engine (replacing the retired OpenAI/DALL-E path). Given a post's
// visual prompt plus franchise/platform/vehicle/geo context, it builds a
// platform-optimized, brand-styled prompt and asks the Higgsfield text-to-image
// model for a single photorealistic image, returning a hosted URL. Defensive
// throughout: missing credentials or an API error yields a typed failure result
// rather than throwing.

import { logger } from "@/lib/logger";
import {
  baseUrl,
  getAuthHeader,
  hasHiggsfieldCredentials,
  higgsfieldRequest,
  webhookConfig,
} from "@/lib/social/providers/higgsfield.provider";
import type { HiggsfieldResponse } from "@/lib/social/providers/higgsfield.types";

// Higgsfield text-to-image endpoint. Configurable so the model can be swapped
// without a code change.
const IMAGE_ENDPOINT =
  process.env.HIGGSFIELD_IMAGE_ENDPOINT?.trim() ||
  "flux-pro/kontext/max/text-to-image";

const IMAGE_MODEL = "higgsfield-flux-pro";

// Synchronous-poll budget for an image job (Higgsfield text-to-image typically
// resolves in well under a minute). Jobs that exceed this are reconciled later
// by the video-queue cron's AiMediaGeneration poller.
const POLL_INTERVAL_MS = 4_000;
const POLL_MAX_MS = 55_000;

export interface HiggsfieldImageResult {
  success: boolean;
  imageUrl?: string;
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Extracts the first resolved image URL from a Higgsfield response.
function imageUrlFrom(response: HiggsfieldResponse): string | undefined {
  return response.images?.[0]?.url;
}

// Polls a submitted Higgsfield image job until it completes (or fails/times out),
// returning the resolved image URL. Used when withPolling did not already return
// the image inline.
async function pollForImage(
  statusUrl: string,
): Promise<{ imageUrl?: string; error?: string }> {
  const deadline = Date.now() + POLL_MAX_MS;
  for (;;) {
    const res = await fetch(statusUrl, {
      method: "GET",
      headers: { Authorization: getAuthHeader() },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { error: `Higgsfield status HTTP ${res.status}: ${detail.slice(0, 200)}` };
    }
    const response = (await res.json()) as HiggsfieldResponse;
    if (response.status === "completed") {
      return { imageUrl: imageUrlFrom(response) };
    }
    if (response.status === "failed" || response.status === "nsfw") {
      return { error: `Higgsfield image status: ${response.status}` };
    }
    if (Date.now() + POLL_INTERVAL_MS > deadline) {
      return { error: "Higgsfield image generation timed out" };
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

// Generates a single branded still image via Higgsfield and returns a hosted
// provider URL. The caller is responsible for re-hosting the URL into stable
// storage (Supabase). Mirrors the previous DALL-E provider's contract so callers
// can swap with no behavioral change beyond the provider.
export async function generateHiggsfieldImage(input: {
  visualPrompt: string;
  franchise: string;
  platform: string;
  make?: string | null;
  metro?: string | null;
  hookType?: string | null;
}): Promise<HiggsfieldImageResult> {
  if (!hasHiggsfieldCredentials()) {
    return { success: false, error: "Higgsfield credentials not configured" };
  }

  const platform = input.platform.toLowerCase();
  const platformSpec = PLATFORM_SPECS[platform] ?? "square format, high contrast";
  const franchiseStyle =
    FRANCHISE_STYLES[input.franchise] ?? "modern automotive aesthetic, professional";

  const vehiclePart = input.make
    ? `featuring a ${input.make} vehicle`
    : "featuring a modern automotive scene";
  const locationPart = input.metro ? `in ${input.metro}` : "in a modern American city";

  const fullPrompt =
    `Professional automotive social media image. ` +
    `${input.visualPrompt ?? ""} ` +
    `${vehiclePart} ${locationPart}. ` +
    `Style: ${franchiseStyle}. ` +
    `Format: ${platformSpec}. ` +
    `Brand colors: deep blue #0B5FD1 accents. ` +
    `No text overlays. No watermarks. ` +
    `Photorealistic, high quality, social media ready.`;

  const aspectRatio: "9:16" | "16:9" = LANDSCAPE_PLATFORMS.has(platform)
    ? "16:9"
    : "9:16";

  const payload: Record<string, unknown> = {
    prompt: fullPrompt.slice(0, 4000),
    aspect_ratio: aspectRatio,
    safety_tolerance: 2,
    seed: Math.floor(Date.now() % 99999),
  };

  try {
    // Request inline polling so the image resolves in a single round-trip when
    // the platform supports it; fall back to status polling otherwise.
    const response = await higgsfieldRequest({
      endpoint: IMAGE_ENDPOINT,
      input: payload,
      withPolling: true,
      webhook: webhookConfig(),
    });

    let imageUrl = imageUrlFrom(response);

    if (!imageUrl && response.status !== "failed" && response.status !== "nsfw") {
      const statusUrl =
        response.status_url ??
        (response.request_id ? `${baseUrl()}/v1/status/${response.request_id}` : undefined);
      if (statusUrl) {
        const polled = await pollForImage(statusUrl);
        if (polled.error) return { success: false, model: IMAGE_MODEL, error: polled.error };
        imageUrl = polled.imageUrl;
      }
    }

    if (!imageUrl) {
      return {
        success: false,
        model: IMAGE_MODEL,
        error: `Higgsfield returned no image (status: ${response.status})`,
      };
    }

    logger.info("[image:higgsfield] generated image for:", input.franchise, input.platform);
    return { success: true, imageUrl, model: IMAGE_MODEL };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error("[image:higgsfield] generation failed:", error);
    return { success: false, model: IMAGE_MODEL, error };
  }
}
