// POST /api/admin/social/analytics/viral-optimize
// Takes a postId and generates platform-optimized versions for all target
// platforms using the viral format library, trending intelligence, and Groq.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

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
      const res = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${GROQ_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: platformPrompt }],
            max_tokens: 600,
          }),
        },
      );
      const data = await res.json();
      const raw = data?.choices?.[0]?.message?.content ?? "{}";
      const result = JSON.parse(raw.replace(/```json|```/g, "").trim());

      optimized[platform] = {
        hook: result.hook ?? post.hook,
        caption: result.caption ?? post.caption,
        hashtags,
        viralFormat: topFormat?.name ?? "Standard",
        scheduledTime: result.scheduledTime ?? "Best time varies",
        estimatedReach: platform === "tiktok" ? "1K-100K+"
          : platform === "instagram" ? "500-50K+"
          : platform === "facebook" ? "200-20K+"
          : platform === "youtube" ? "300-30K+"
          : "100-10K+",
      };
    } catch (err) {
      console.error("[viral-optimize] failed for platform:", platform, err);
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
