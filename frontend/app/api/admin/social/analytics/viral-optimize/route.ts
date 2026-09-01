// POST /api/admin/social/analytics/viral-optimize
// Takes a postId and generates platform-optimized versions for all target
// platforms using the viral format library, trending intelligence, and Groq.

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { complete } from "@/lib/ai/provider";

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { postId, targetPlatforms } = await request.json().catch(() => ({}));
  if (!postId) return adminError("BAD_REQUEST", "postId required", 400);

  const platforms: string[] = targetPlatforms ?? [
    "tiktok", "instagram", "facebook", "youtube", "linkedin",
  ];

  const post = await prisma.socialPost.findUnique({
    where: { id: postId },
    include: { franchise: true },
  });

  if (!post) return adminError("NOT_FOUND", "Post not found", 404);

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) return adminError("CONFIG", "GROQ_API_KEY not configured", 500);

  const { VIRAL_FORMATS } = await import("@/lib/social/viral-formats");
  const { buildViralHashtags } = await import("@/lib/social/hashtag-builder");
  const { getOrFetchTrendingData } = await import(
    "@/lib/social/trending-intelligence.engine"
  );

  const trending = await getOrFetchTrendingData().catch(() => null);

  const optimized: Record<string, {
    hook: string;
    caption: string;
    hashtags: string[];
    viralFormat: string;
    scheduledTime: string;
    estimatedReach: string;
  }> = {};

  for (const platform of platforms) {
    const formats = VIRAL_FORMATS[platform as keyof typeof VIRAL_FORMATS] ?? [];
    const topFormat = formats[0];

    const hashtags = buildViralHashtags({
      platform,
      franchise: post.franchise?.slug ?? "dealer_secret_daily",
      make: post.make,
      metro: post.metro,
      trendingHashtags: trending?.tiktokHashtags ?? [],
    });

    const platformPrompt = `Rewrite this automotive social media post optimized for ${platform}.
Original hook: "${post.hook}"
Original caption: "${post.caption.slice(0, 300)}"
Platform: ${platform}
${topFormat ? `Use this viral format structure:\n${topFormat.structure}` : ""}
Trending hashtags to weave in naturally: ${(trending?.tiktokHashtags ?? []).slice(0, 3).join(", ")}

Return ONLY valid JSON, no other text:
{
  "hook": "optimized hook for ${platform} (under 15 words, stops scroll)",
  "caption": "optimized caption for ${platform} (platform-appropriate length)",
  "scheduledTime": "best day and time to post on ${platform}"
}`;

    try {
      // Transport only — model, prompt and token cap unchanged.
      //
      // A non-2xx Groq response must not be parsed as an empty object and
      // returned as a successful "optimization" that silently echoes the
      // original content. The provider adapter throws on non-2xx, so it reaches
      // the catch fallback below exactly as the explicit throw did.
      const completion = await complete({
        purpose: "social.analytics.viral_optimize",
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: platformPrompt }],
        maxTokens: 600,
      });
      const raw = completion.content || "{}";
      const result = JSON.parse(raw.replace(/```json|```/g, "").trim());

      optimized[platform] = {
        hook: result.hook ?? post.hook,
        caption: result.caption ?? post.caption,
        hashtags,
        viralFormat: topFormat?.name ?? "Standard",
        scheduledTime: result.scheduledTime ?? "Best time varies",
        // Typical organic reach band for the platform — an illustrative range,
        // not a per-post prediction (labeled as such so it isn't presented as a
        // computed forecast).
        estimatedReach: platform === "tiktok" ? "1K–100K+ (typical)"
          : platform === "instagram" ? "500–50K+ (typical)"
          : platform === "facebook" ? "200–20K+ (typical)"
          : platform === "youtube" ? "300–30K+ (typical)"
          : "100–10K+ (typical)",
      };
    } catch (err) {
      logger.error("[viral-optimize] failed for platform:", platform, err);
      optimized[platform] = {
        hook: post.hook,
        caption: post.caption,
        hashtags,
        viralFormat: topFormat?.name ?? "Standard",
        scheduledTime: "9AM local time",
        estimatedReach: "Varies",
      };
    }
  }

  return adminSuccess({
    originalPost: {
      id: post.id,
      platform: post.platform,
      hook: post.hook,
      leadScore: post.leadScore,
    },
    optimizedVersions: optimized,
    message: `Generated optimized versions for ${platforms.length} platforms`,
  });
}
