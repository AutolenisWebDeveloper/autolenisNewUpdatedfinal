// POST /api/admin/social/analytics/analyze
// Takes a postId and returns AI-driven analysis with actionable
// recommendations using Groq, comparing the post against platform benchmarks
// and learned winning patterns.

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { complete } from "@/lib/ai/provider";
import { ProviderHttpError } from "@/lib/ai/provider-errors";

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { postId } = await request.json().catch(() => ({}));
  if (!postId) return adminError("BAD_REQUEST", "postId required", 400);

  const post = await prisma.socialPost.findUnique({
    where: { id: postId },
    include: {
      franchise: true,
      performance: {
        orderBy: { recordedAt: "desc" },
        take: 5,
      },
      video: {
        select: {
          status: true,
          thumbnailUrl: true,
          videoUrl: true,
        },
      },
    },
  });

  if (!post) return adminError("NOT_FOUND", "Post not found", 404);

  // Platform benchmarks for comparison
  const benchmarks = {
    tiktok: { avgCTR: 0.038, avgCompletion: 0.45 },
    instagram: { avgCTR: 0.019, avgCompletion: 0.38 },
    facebook: { avgCTR: 0.009, avgCompletion: 0.25 },
    youtube: { avgCTR: 0.042, avgCompletion: 0.55 },
    linkedin: { avgCTR: 0.008, avgCompletion: 0.35 },
  };
  const benchmark = benchmarks[post.platform as keyof typeof benchmarks];

  const winningPattern = await prisma.winningPattern
    .findFirst({
      where: {
        platform: post.platform,
        franchiseSlug: post.franchise?.slug ?? undefined,
        sampleSize: { gte: 3 },
      },
      orderBy: { avgLeadScore: "desc" },
    })
    .catch(() => null);

  const latestPerf = post.performance[0];
  const perfImpressions = latestPerf?.impressions ?? 0;
  const ctr = perfImpressions > 0
    ? (latestPerf!.linkClicks ?? 0) / perfImpressions
    : 0;

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) {
    return adminSuccess({
      analysis: null,
      error: "GROQ_API_KEY not configured",
    });
  }

  const prompt = `You are an expert social media analyst specializing in automotive content.
Analyze this ${post.platform} post and provide specific, actionable recommendations.

POST DATA:
Platform: ${post.platform}
Hook: "${post.hook}"
Caption: "${post.caption.slice(0, 300)}"
Franchise: ${post.franchise?.name ?? "Unknown"}
Hook Type: ${post.hookType ?? "Unknown"}
Status: ${post.status}
Lead Score: ${post.leadScore}
Published: ${post.publishedAt ? new Date(post.publishedAt).toLocaleDateString() : "Not published"}

PERFORMANCE METRICS:
${latestPerf ? `
- Impressions: ${(latestPerf.impressions ?? 0).toLocaleString()}
- Reach: ${(latestPerf.reach ?? 0).toLocaleString()}
- Likes: ${latestPerf.likes ?? 0}
- Comments: ${latestPerf.comments ?? 0}
- Shares: ${latestPerf.shares ?? 0}
- Link Clicks: ${latestPerf.linkClicks ?? 0}
- CTR: ${(ctr * 100).toFixed(2)}%
` : "No performance data yet"}

PLATFORM BENCHMARKS:
${benchmark ? `
- Industry avg CTR: ${(benchmark.avgCTR * 100).toFixed(1)}%
- Industry avg completion: ${(benchmark.avgCompletion * 100).toFixed(0)}%
- This post CTR vs benchmark: ${((ctr / benchmark.avgCTR) * 100).toFixed(0)}%
` : "No benchmark data"}

WINNING PATTERNS (from our data):
${winningPattern ? `
- Best hook type for ${post.platform}: ${winningPattern.hookType}
- Avg lead score: ${winningPattern.avgLeadScore?.toFixed(1)}
- Sample size: ${winningPattern.sampleSize} posts
` : "No winning pattern data yet"}

Provide your analysis in this exact JSON format:
{
  "overallScore": 0-100,
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "weaknesses": ["weakness 1", "weakness 2"],
  "recommendations": [
    {
      "priority": "high|medium|low",
      "action": "specific action to take",
      "expectedImpact": "what improvement to expect",
      "howTo": "exact steps to implement"
    }
  ],
  "hookAnalysis": {
    "score": 0-100,
    "feedback": "specific feedback on the hook",
    "improvedHook": "a better version of the hook"
  },
  "bestTimeToPost": "day and time recommendation for ${post.platform}",
  "viralPotential": "low|medium|high",
  "viralPotentialReason": "why this content has or lacks viral potential",
  "optimizedVersion": {
    "hook": "improved hook",
    "caption": "improved caption (under 200 words)",
    "hashtags": ["tag1", "tag2", "tag3"],
    "callToAction": "specific CTA"
  }
}`;

  try {
    // Transport only — model, prompt and token cap unchanged.
    let groqResult;
    try {
      groqResult = await complete({
        purpose: "social.analytics.analyze",
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        maxTokens: 1500,
      });
    } catch (err) {
      // Surface upstream failures (auth/quota/5xx) as an error rather than
      // parsing the error body into an empty "{}" analysis returned as success.
      if (err instanceof ProviderHttpError) {
        logger.error(`[ai-analyze] Groq ${err.status}: ${err.detail.slice(0, 300)}`);
        return adminError("AI_ANALYSIS_FAILED", "AI analysis upstream failed", 502);
      }
      throw err;
    }

    const raw = groqResult.content || "{}";
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const analysis = JSON.parse(cleaned);

    return adminSuccess({
      postId,
      platform: post.platform,
      hook: post.hook,
      leadScore: post.leadScore,
      performance: latestPerf,
      analysis,
    });
  } catch (err) {
    logger.error("[ai-analyze] failed:", err);
    return adminError("AI_ANALYSIS_FAILED", "AI analysis failed", 500);
  }
}
