// POST /api/admin/social/compose
// Manually compose a social post for any platform. Creates an APPROVED,
// MANUAL post (no review required) with a UTM-tracked funnel URL, then
// optionally kicks off AI image generation for the new post.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { buildUtmUrl } from "@/lib/social/config";

interface ComposeBody {
  platform?: string;
  franchiseSlug?: string;
  hook?: string;
  caption?: string;
  hashtags?: string[] | string;
  scheduledAt?: string;
  generateImage?: boolean;
  // AI-generated per-beat video script (hook_0_3s, beats, cta, onScreenText,
  // voiceover) from the compose drawer — persisted so it isn't lost on save.
  videoScript?: Record<string, string> | null;
}

function contentTypeFor(platform: string): string {
  if (platform === "tiktok") return "tiktok_video";
  if (platform === "instagram") return "instagram_reel";
  if (platform === "youtube") return "youtube_short";
  return `${platform}_post`;
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  let body: ComposeBody;
  try {
    body = await request.json();
  } catch {
    return adminError("VALIDATION_ERROR", "Request body must be valid JSON", 400);
  }

  const { platform, hook, caption, hashtags, scheduledAt, generateImage, videoScript } = body;
  const franchiseSlug = body.franchiseSlug ?? "dealer_secret_daily";

  if (!platform || !hook || !caption) {
    return adminError("VALIDATION_ERROR", "platform, hook, and caption are required", 400);
  }

  // Validate scheduledAt up front so an unparseable value is a clean 400 rather
  // than an Invalid Date that Prisma rejects with a 500.
  let scheduledAtDate: Date | null = null;
  if (scheduledAt) {
    const parsed = new Date(scheduledAt);
    if (Number.isNaN(parsed.getTime())) {
      return adminError("VALIDATION_ERROR", "scheduledAt is not a valid date", 400);
    }
    scheduledAtDate = parsed;
  }

  // Flatten the AI video script beats into the post's script/voiceover/on-screen
  // columns so the reviewed script is persisted (was previously dropped).
  const vs = videoScript ?? null;
  const scriptText =
    vs && Object.keys(vs).length > 0
      ? [vs.hook_0_3s, vs.beat1_3_10s, vs.beat2_10_20s, vs.beat3_20_25s, vs.cta_25_30s]
          .filter(Boolean)
          .join("\n")
      : caption;

  const franchise = await prisma.contentFranchise.findUnique({
    where: { slug: franchiseSlug },
  });

  const trackedUrl = buildUtmUrl({
    path: "/request-a-car",
    platform,
    franchise: franchiseSlug,
    hookType: "manual",
    contentType: `${platform}_post`,
  });

  const hashtagList = Array.isArray(hashtags)
    ? hashtags
    : (hashtags ?? "")
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean);

  const post = await prisma.socialPost.create({
    data: {
      platform,
      franchiseId: franchise?.id ?? null,
      contentType: contentTypeFor(platform),
      hookType: "manual",
      hook,
      script: scriptText,
      caption,
      voiceoverText: vs?.voiceover ?? null,
      onScreenText: vs?.onScreenText ?? null,
      hashtags: hashtagList,
      status: "APPROVED",
      automationMode: "MANUAL_REVIEW",
      requiresReview: false,
      scheduledAt: scheduledAtDate,
      utmSource: platform,
      utmMedium: "social_manual",
      utmCampaign: `${franchiseSlug}_manual`,
      utmPlatform: platform,
      utmHook: "manual",
      trackedUrl,
      funnelDestination: "/request-a-car",
    },
  });

  await createAuditLog(admin, request, {
    action: "SOCIAL_POST_COMPOSE",
    entityType: "SocialPost",
    entityId: post.id,
    metadata: { platform, franchiseSlug, generateImage: Boolean(generateImage) },
  });

  // Fire-and-forget image generation for the new post.
  if (generateImage && process.env.OPENAI_API_KEY) {
    const base = process.env.NEXT_PUBLIC_APP_URL;
    if (base) {
      void fetch(`${base}/api/admin/social/generate-images`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: request.headers.get("cookie") ?? "",
        },
      }).catch(() => {});
    }
  }

  return adminSuccess({ post, message: "Post created and scheduled" });
}
