// AutoLenis Social Engine — Trending Intelligence Engine (Session C, Option A).
//
// Pulls live trend signals (TikTok hashtags, Reddit car-buyer questions, Google
// Trends) via RapidAPI, filters them for automotive relevance, and caches the
// result for ~23h in SocialIntelligenceCache. Every fetch degrades gracefully:
// a missing key, a failed endpoint, or a malformed response falls back to a
// sensible default set so generation is never blocked.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

export interface TrendingData {
  tiktokHashtags: string[];
  tiktokTrends: string[];
  redditTopics: string[];
  googleTrends: string[];
  scannedAt: Date;
}

const DEFAULT_HASHTAGS = [
  "#carbuying",
  "#dealersecret",
  "#autolenis",
  "#cartips",
  "#savemoney",
  "#cardeals",
  "#otdprice",
  "#dealerfees",
  "#newcar",
  "#cardealership",
];

const AUTOMOTIVE_KEYWORDS = [
  "car",
  "auto",
  "vehicle",
  "dealer",
  "truck",
  "suv",
  "toyota",
  "ford",
  "chevy",
  "honda",
  "lease",
  "finance",
  "carbuying",
  "dealership",
  "carbuyingtips",
];

async function fetchTikTokHashtags(apiKey: string): Promise<string[]> {
  try {
    const res = await fetch(
      "https://tiktok-scraper7.p.rapidapi.com/trending/hashtags",
      {
        headers: {
          "X-RapidAPI-Key": apiKey,
          "X-RapidAPI-Host": "tiktok-scraper7.p.rapidapi.com",
        },
      },
    );
    if (!res.ok) throw new Error(`TikTok API: ${res.status}`);
    const data = await res.json();
    // Extract hashtag names from response.
    // Common response shapes: data.hashtags[].name or data[].name
    const items: string[] = [];
    const raw = data?.hashtags ?? data?.data ?? data ?? [];
    for (const item of Array.isArray(raw) ? raw : []) {
      const tag = item?.name ?? item?.hashtag ?? item;
      if (typeof tag === "string") items.push(tag);
    }
    // Filter for automotive relevance.
    const automotive = items.filter((tag) =>
      AUTOMOTIVE_KEYWORDS.some((kw) => tag.toLowerCase().includes(kw)),
    );
    return automotive.slice(0, 10).map((t) => (t.startsWith("#") ? t : `#${t}`));
  } catch {
    return [];
  }
}

async function fetchRedditTopics(
  apiKey: string,
  groqKey: string,
): Promise<string[]> {
  try {
    const res = await fetch(
      "https://reddit3.p.rapidapi.com/r/askcarsales/hot?limit=10",
      {
        headers: {
          "X-RapidAPI-Key": apiKey,
          "X-RapidAPI-Host": "reddit3.p.rapidapi.com",
        },
      },
    );
    if (!res.ok) return [];
    const data = await res.json();
    const posts: string[] = [];
    const children = data?.data?.children ?? [];
    for (const child of children) {
      const title = child?.data?.title ?? "";
      if (title) posts.push(title);
    }
    if (posts.length === 0) return [];

    // Use Groq to extract content opportunities.
    const groqRes = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${groqKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            {
              role: "user",
              content: `Given these Reddit car buying questions, identify the top 3 content opportunities for AutoLenis social media today. Return ONLY a JSON array of 3 short strings (under 15 words each), no other text:\n${posts.join("\n")}`,
            },
          ],
          max_tokens: 200,
        }),
      },
    );
    const groqData = await groqRes.json();
    const raw = groqData?.choices?.[0]?.message?.content ?? "[]";
    const cleaned = raw.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned) as string[];
  } catch {
    return [];
  }
}

async function fetchGoogleTrends(apiKey: string): Promise<string[]> {
  try {
    const res = await fetch(
      "https://google-trends8.p.rapidapi.com/trends/hottrends?geo=US",
      {
        headers: {
          "X-RapidAPI-Key": apiKey,
          "X-RapidAPI-Host": "google-trends8.p.rapidapi.com",
        },
      },
    );
    if (!res.ok) return [];
    const data = await res.json();
    const trends: unknown[] = data?.trendingSearches ?? data?.data ?? data ?? [];
    // The RapidAPI hottrends payload may return plain strings OR objects (e.g.
    // { title }, { query }, { name }). Coerce each item to its title string so
    // downstream consumers never receive "[object Object]" (which would silently
    // fail the automotive filter and empty this feed).
    const toTitle = (t: unknown): string => {
      if (typeof t === "string") return t;
      if (t && typeof t === "object") {
        const o = t as Record<string, unknown>;
        const v = o.title ?? o.query ?? o.name ?? o.keyword ?? o.term;
        if (typeof v === "string") return v;
      }
      return "";
    };
    // Filter for automotive.
    return (Array.isArray(trends) ? trends : [])
      .map(toTitle)
      .filter((t) => t.length > 0)
      .filter((t) =>
        AUTOMOTIVE_KEYWORDS.some((kw) => t.toLowerCase().includes(kw)),
      )
      .slice(0, 5);
  } catch {
    return [];
  }
}

export async function fetchTrendingIntelligence(): Promise<TrendingData> {
  const apiKey = process.env.RAPIDAPI_KEY ?? "";
  const groqKey = process.env.GROQ_API_KEY ?? "";

  if (!apiKey) {
    logger.info("[trending] RAPIDAPI_KEY not set — using defaults");
    return {
      tiktokHashtags: DEFAULT_HASHTAGS,
      tiktokTrends: [],
      redditTopics: [],
      googleTrends: [],
      scannedAt: new Date(),
    };
  }

  const [tiktokHashtags, redditTopics, googleTrends] = await Promise.all([
    fetchTikTokHashtags(apiKey),
    fetchRedditTopics(apiKey, groqKey),
    fetchGoogleTrends(apiKey),
  ]);

  const result: TrendingData = {
    tiktokHashtags:
      tiktokHashtags.length > 0 ? tiktokHashtags : DEFAULT_HASHTAGS,
    tiktokTrends: tiktokHashtags.slice(0, 5),
    redditTopics,
    googleTrends,
    scannedAt: new Date(),
  };

  logger.info(
    "[trending] fetched:",
    result.tiktokHashtags.length,
    "hashtags,",
    result.redditTopics.length,
    "topics,",
    result.googleTrends.length,
    "trends",
  );

  return result;
}

export async function getCachedTrendingData(): Promise<TrendingData | null> {
  try {
    const cached = await prisma.socialIntelligenceCache.findUnique({
      where: { cacheKey: "trending_data" },
    });
    if (!cached || cached.expiresAt < new Date()) return null;
    return cached.data as unknown as TrendingData;
  } catch {
    return null;
  }
}

export async function cacheTrendingData(data: TrendingData): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + 23 * 60 * 60 * 1000);
    await prisma.socialIntelligenceCache.upsert({
      where: { cacheKey: "trending_data" },
      update: {
        data: data as unknown as object,
        expiresAt,
        updatedAt: new Date(),
      },
      create: {
        cacheKey: "trending_data",
        data: data as unknown as object,
        expiresAt,
      },
    });
  } catch (err) {
    logger.error("[trending] cache write failed:", err);
  }
}

export async function getOrFetchTrendingData(): Promise<TrendingData> {
  const cached = await getCachedTrendingData();
  if (cached) return cached;
  const fresh = await fetchTrendingIntelligence();
  await cacheTrendingData(fresh);
  return fresh;
}
