// POST /api/admin/social/compose/generate-preview-image
// Generates an image from an imageBrief via Higgsfield (the exclusive image
// provider) and returns a stable hosted URL so the ComposeDrawer can preview it
// inline before the post is created.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { generateHiggsfieldImage } from "@/lib/social/providers/higgsfield-image.provider";
import { hasHiggsfieldCredentials } from "@/lib/social/providers/higgsfield.provider";
import { storeImageInSupabase } from "@/lib/social/image-generation.service";

interface PreviewImageBody {
  imageBrief?: string;
  platform?: string;
  franchiseSlug?: string;
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { imageBrief, platform, franchiseSlug }: PreviewImageBody = await request
    .json()
    .catch(() => ({}));
  if (!imageBrief) return adminError("VALIDATION_ERROR", "imageBrief required", 400);

  if (!hasHiggsfieldCredentials()) {
    return adminError("CONFIG_ERROR", "Higgsfield credentials not configured", 500);
  }

  const result = await generateHiggsfieldImage({
    visualPrompt: imageBrief,
    franchise: franchiseSlug ?? "",
    platform: platform ?? "instagram",
  });

  if (!result.success || !result.imageUrl) {
    return adminError(
      "IMAGE_GENERATION_FAILED",
      result.error ?? "Image generation failed",
      502,
    );
  }

  // Re-host to Supabase so the preview URL is stable (Higgsfield delivery URLs
  // are temporary). Keyed by a transient compose id since no post exists yet.
  const previewId = `compose-preview/${admin.adminId}-${Date.now()}`;
  try {
    const imageUrl = await storeImageInSupabase(result.imageUrl, previewId);
    return adminSuccess({ imageUrl, platform, model: result.model });
  } catch (err) {
    // If storage is unavailable but the model returned a URL, fall back to it.
    if (result.imageUrl) {
      return adminSuccess({ imageUrl: result.imageUrl, platform, model: result.model });
    }
    return adminError(
      "IMAGE_STORE_FAILED",
      err instanceof Error ? err.message : "Failed to store preview image",
      500,
    );
  }
}
