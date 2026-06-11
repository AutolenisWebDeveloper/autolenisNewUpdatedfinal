// POST /api/admin/social/compose/generate-preview-image
// Takes an imageBrief + platform and generates a DALL-E 3 image, returning the
// URL so the ComposeDrawer can preview it inline before the post is created.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";

interface PreviewImageBody {
  imageBrief?: string;
  platform?: string;
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { imageBrief, platform }: PreviewImageBody = await request
    .json()
    .catch(() => ({}));
  if (!imageBrief) return adminError("VALIDATION_ERROR", "imageBrief required", 400);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return adminError("CONFIG_ERROR", "OPENAI_API_KEY not configured", 500);

  // Platform determines image size
  const isVertical = ["tiktok", "instagram", "youtube"].includes(platform ?? "");
  const size = isVertical ? "1024x1792" : "1792x1024";

  try {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt: imageBrief.slice(0, 4000),
        n: 1,
        size,
        quality: "standard",
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return adminError(
        "DALLE_ERROR",
        `DALL-E failed: ${JSON.stringify(err).slice(0, 200)}`,
        500,
      );
    }

    const data = await res.json();
    const imageUrl = data?.data?.[0]?.url;

    if (!imageUrl) return adminError("DALLE_ERROR", "No image URL returned", 500);

    return adminSuccess({ imageUrl, platform, size });
  } catch (err) {
    return adminError(
      "IMAGE_GENERATION_FAILED",
      err instanceof Error ? err.message : "Image generation failed",
      500,
    );
  }
}
