// AutoLenis Social Engine — Image Generation Service.
//
// Orchestrates the full visual pipeline for a single social post:
//   1. Generate a professional visual prompt (visual-prompt.engine).
//   2. Generate a still image via Higgsfield text-to-image (polled to completion).
//   3. Store the image in Supabase storage ("social-media-assets").
//   4. Kick off image-to-video generation in the background (cron polls it).
//   5. Persist the chosen visual prompt/style back onto the SocialPost.
//
// Every stage is defensive: a failure is logged with its stage name and the
// pipeline returns nulls rather than throwing, so it can never block post
// creation or publishing.

import "server-only";
import type { SocialPost } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ENABLE_VIDEO } from "@/lib/social/config";
import { getServiceSupabase } from "@/lib/supabase-service";
import { HiggsfieldProvider } from "@/lib/social/providers/higgsfield.provider";
import {
  generateVisualPrompt,
  type VisualPromptOutput,
} from "@/lib/social/visual-prompt.engine";

const STORAGE_BUCKET = "social-media-assets";
const POLL_INTERVAL_MS = 10_000;
const POLL_MAX_MS = 60_000;

// Platforms that should also receive an image-to-video render.
const VIDEO_PLATFORMS = new Set(["tiktok", "instagram", "youtube", "facebook"]);

export interface PostVisuals {
  imageUrl: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  aiGenerationId: string | null;
}

const EMPTY: PostVisuals = {
  imageUrl: null,
  videoUrl: null,
  thumbnailUrl: null,
  aiGenerationId: null,
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Resolves the franchise slug for a post without assuming the relation is loaded.
async function resolveFranchiseSlug(post: SocialPost): Promise<string> {
  if (!post.franchiseId) return "";
  const franchise = await prisma.contentFranchise
    .findUnique({ where: { id: post.franchiseId }, select: { slug: true } })
    .catch(() => null);
  return franchise?.slug ?? "";
}

// Polls a Higgsfield text-to-image job until completion or timeout. Returns the
// resolved image URL or null.
async function pollImage(
  provider: HiggsfieldProvider,
  requestId: string,
): Promise<string | null> {
  const deadline = Date.now() + POLL_MAX_MS;
  // First check immediately, then on the interval until the deadline.
  for (;;) {
    const status = await provider.getJobStatus(requestId);
    if (status.status === "completed") {
      // For text-to-image the resolved still arrives as the thumbnail/image URL.
      return status.thumbnailUrl ?? status.videoUrl ?? null;
    }
    if (status.status === "failed") return null;
    if (Date.now() + POLL_INTERVAL_MS > deadline) return null;
    await sleep(POLL_INTERVAL_MS);
  }
}

// Downloads an image and uploads it to the Supabase storage bucket, returning a
// public URL. Throws on failure so the caller can log the stage. Exported so the
// video-queue cron can reuse it when a text-to-image job completes out-of-band.
export async function storeImageInSupabase(imageUrl: string, postId: string): Promise<string> {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  const buffer = Buffer.from(await res.arrayBuffer());

  const supabase = getServiceSupabase();
  const path = `social-posts/${postId}/image.jpg`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, buffer, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`supabase upload failed: ${error.message}`);

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error("supabase getPublicUrl returned no url");
  return data.publicUrl;
}

// Generates the full visual asset set for a post. Returns the stored image URL
// immediately so the post can publish with an image while the video renders in
// the background; the video URL is resolved later by the video-queue cron.
export async function generatePostVisuals(post: SocialPost): Promise<PostVisuals> {
  // Idempotency guard — if this post already has a stored image (thumbnail),
  // don't regenerate (saves Higgsfield cost on re-invocation, e.g. at approval).
  const existing = await prisma.socialVideo
    .findUnique({
      where: { postId: post.id },
      select: { thumbnailUrl: true, videoUrl: true, storagePath: true },
    })
    .catch(() => null);
  if (existing?.thumbnailUrl && existing.storagePath) {
    console.log("[image-gen] visuals already exist for post:", post.id, "— skipping");
    return {
      imageUrl: existing.thumbnailUrl,
      videoUrl: existing.videoUrl ?? null,
      thumbnailUrl: existing.thumbnailUrl,
      aiGenerationId: null,
    };
  }

  // STAGE 1 — Generate the visual prompt.
  let visual: VisualPromptOutput;
  try {
    const franchiseSlug = await resolveFranchiseSlug(post);
    visual = await generateVisualPrompt({
      franchise: franchiseSlug,
      contentType: post.contentType,
      platform: post.platform,
      make: post.make ?? undefined,
      model: post.model ?? undefined,
      city: post.geoTarget ?? post.metro ?? undefined,
      hookType: post.hookType ?? "curiosity",
      script: post.script,
    });
  } catch (err) {
    console.error("[image-gen] STAGE 1 (visual prompt) failed:", err);
    return EMPTY;
  }

  // STAGE 2 — Generate the image (text-to-image). Gated by the video feature
  // flag, which also governs all Higgsfield generation.
  if (!ENABLE_VIDEO) {
    console.log("[image-gen] ENABLE_HIGGSFIELD_VIDEO disabled — skipping generation");
    return EMPTY;
  }

  const provider = new HiggsfieldProvider();
  let imageRequestId: string;
  try {
    const result = await provider.generateTextToImage({
      prompt: visual.imagePrompt,
      aspectRatio: visual.aspectRatio,
      socialPostId: post.id,
      campaignId: post.franchiseId ?? undefined,
      negativePrompt: visual.negativePrompt,
    });
    if (!result.success || !result.requestId) {
      console.error("[image-gen] STAGE 2 (text-to-image submit) failed:", result.error);
      return EMPTY;
    }
    imageRequestId = result.requestId;
  } catch (err) {
    console.error("[image-gen] STAGE 2 (text-to-image submit) threw:", err);
    return EMPTY;
  }

  let sourceImageUrl: string | null;
  try {
    sourceImageUrl = await pollImage(provider, imageRequestId);
    if (!sourceImageUrl) {
      console.error("[image-gen] STAGE 2 (polling) did not complete within timeout");
      return EMPTY;
    }
  } catch (err) {
    console.error("[image-gen] STAGE 2 (polling) threw:", err);
    return EMPTY;
  }

  // Resolve the tracking record id for the image generation.
  const aiGen = await prisma.aiMediaGeneration
    .findUnique({ where: { higgsfieldRequestId: imageRequestId }, select: { id: true } })
    .catch(() => null);

  // STAGE 3 — Store the image in Supabase.
  let storedImageUrl: string;
  try {
    storedImageUrl = await storeImageInSupabase(sourceImageUrl, post.id);
  } catch (err) {
    console.error("[image-gen] STAGE 3 (supabase store) failed:", err);
    // Fall back to the provider URL so the post still has a usable image.
    storedImageUrl = sourceImageUrl;
  }

  // Surface the image on the SocialVideo record so the dashboard + publishing
  // path can use it as a thumbnail immediately. Upsert keeps this idempotent
  // whether or not a video job already exists for the post.
  try {
    await prisma.socialVideo.upsert({
      where: { postId: post.id },
      create: {
        postId: post.id,
        status: "SCRIPT_READY",
        visualPrompt: visual.videoPrompt,
        durationSeconds: post.durationSeconds ?? 15,
        style: visual.style,
        thumbnailUrl: storedImageUrl,
        storageBucket: STORAGE_BUCKET,
        storagePath: `social-posts/${post.id}/image.jpg`,
      },
      update: {
        thumbnailUrl: storedImageUrl,
        storageBucket: STORAGE_BUCKET,
        storagePath: `social-posts/${post.id}/image.jpg`,
      },
    });
  } catch (err) {
    console.error("[image-gen] STAGE 3 (socialVideo thumbnail) failed (non-fatal):", err);
  }

  // STAGE 4 — Generate the video (image-to-video) for video platforms. Fire and
  // forget: the video-queue cron polls for completion. submitJob requires a
  // SocialVideo row (upserted above) which it transitions to VIDEO_GENERATING.
  if (VIDEO_PLATFORMS.has(post.platform.toLowerCase())) {
    try {
      await provider.submitJob({
        postId: post.id,
        visualPrompt: visual.videoPrompt,
        durationSeconds: post.durationSeconds ?? 15,
        style: visual.style,
      });
    } catch (err) {
      console.error("[image-gen] STAGE 4 (image-to-video submit) failed (non-fatal):", err);
    }
  }

  // STAGE 5 — Persist the chosen visual prompt/style on the post.
  try {
    await prisma.socialPost.update({
      where: { id: post.id },
      data: { visualPrompt: visual.imagePrompt, visualStyle: visual.style },
    });
  } catch (err) {
    console.error("[image-gen] STAGE 5 (post update) failed (non-fatal):", err);
  }

  // STAGE 6 — Return results (video is async, image doubles as the thumbnail).
  return {
    imageUrl: storedImageUrl,
    videoUrl: null,
    thumbnailUrl: storedImageUrl,
    aiGenerationId: aiGen?.id ?? null,
  };
}
