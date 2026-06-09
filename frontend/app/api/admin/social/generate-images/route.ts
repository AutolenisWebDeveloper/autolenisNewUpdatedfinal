// POST /api/admin/social/generate-images
// One-shot admin endpoint to batch-generate DALL-E 3 images for APPROVED posts
// that still have no SocialVideo record (no media). Each post gets a branded
// still image attached and its SocialVideo marked VIDEO_READY so the publishing
// queue can pick it up. Processes a bounded batch per call to stay within the
// serverless time budget; call repeatedly to drain a larger backlog.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { generateDallePostImage } from "@/lib/social/image-generation.service";

export const maxDuration = 300;

// DALL-E 3 standard tier allows ~5 images/min. Generation latency (~10-15s)
// already spaces requests; a small extra delay keeps us safely under the cap.
const BATCH_SIZE = 10;
const DELAY_MS = 2_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  if (!process.env.OPENAI_API_KEY) {
    return adminError("PROVIDER_UNCONFIGURED", "OPENAI_API_KEY not configured", 400);
  }

  // Find approved posts with no SocialVideo record (relation name is `video`).
  const postsNeedingImages = await prisma.socialPost.findMany({
    where: { status: "APPROVED", video: { is: null } },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });

  console.log(
    `[generate-images] found ${postsNeedingImages.length} posts needing images`,
  );

  let generated = 0;
  let failed = 0;

  for (const post of postsNeedingImages) {
    try {
      const visuals = await generateDallePostImage(post);
      if (visuals.imageUrl) {
        generated += 1;
      } else {
        console.error("[generate-images] failed for post:", post.id);
        failed += 1;
      }
    } catch (err) {
      console.error(
        "[generate-images] error for post:",
        post.id,
        err instanceof Error ? err.message : err,
      );
      failed += 1;
    }

    // Rate limit between requests.
    await sleep(DELAY_MS);
  }

  return adminSuccess({
    processed: postsNeedingImages.length,
    generated,
    failed,
    remaining: postsNeedingImages.length === BATCH_SIZE ? "more may remain — call again" : 0,
    message: `Generated ${generated} images. ${failed} failed.`,
  });
}
