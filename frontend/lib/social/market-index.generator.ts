// AutoLenis Social Engine — Market Index generator.
//
// Builds the weekly "AutoLenis Market Index" — a professional automotive market
// intelligence report published as a LinkedIn article/newsletter issue. Pulls
// real data from the AMIPS intelligence tables (market_intelligence,
// vehicle_intelligence, amips_market_scores) and asks Groq to write the report.
//
// The report is real-data-backed: the analyst prompt states figures as fact,
// never as estimates, and never uses guarantee language.

import { prisma } from "@/lib/prisma";
import { GROQ_SUMMARY } from "@/lib/ai/acquisition";
import { LinkedInProvider } from "@/lib/social/providers/linkedin.provider";
import { sendMarketIndexPublishedEmail } from "@/lib/services/email/resend.service";

export interface MarketIndexReport {
  title: string;
  body: string; // full article text
  summary: string; // 2-3 sentence LinkedIn post caption
  topMarkets: { metro: string; score: number; trend: string }[];
  priceMovements: { make: string; model: string; change: string }[];
  weekOf: string;
}

// ─── Groq helper (mirrors groq-script.engine REST pattern) ───────────────────
async function callGroq(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey.startsWith("gsk_placeholder")) {
    throw new Error("GROQ_API_KEY is not configured");
  }

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_SUMMARY, // llama-3.3-70b-versatile
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 3000,
      temperature: 0.6,
      top_p: 1.0,
    }),
  });

  console.log("[market-index] groq response status:", res.status);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Groq HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

function stripFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  return s;
}

function weekOfLabel(): string {
  return new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Chicago",
  });
}

const SYSTEM_PROMPT = `You are the AutoLenis Market Intelligence analyst.
Write professional weekly automotive market reports.
Data is real — state it as fact, not estimate.
Never use guarantee language (guarantee, guaranteed, promise, assured).`;

// Generates the weekly AutoLenis Market Index from live AMIPS intelligence data.
export async function generateMarketIndex(): Promise<MarketIndexReport> {
  const weekOf = weekOfLabel();

  // 1. Top buyer-leverage markets.
  const markets = await prisma.marketIntelligence.findMany({
    where: { buyerLeverageScore: { not: null } },
    orderBy: { buyerLeverageScore: "desc" },
    take: 10,
    select: { metroName: true, buyerLeverageScore: true, state: true },
  });

  // 2. Vehicle pricing reference.
  const vehicles = await prisma.vehicleIntelligence.findMany({
    orderBy: [{ make: "asc" }, { model: "asc" }],
    take: 40,
    select: { make: true, model: true, msrpCents: true, fairMarketLowCents: true },
  });

  // 3. Per-metro vehicle buyer-advantage scores.
  const scores = await prisma.amipsMarketScore.findMany({
    orderBy: { overallBuyerAdvantage: "desc" },
    take: 20,
    select: { metro: true, make: true, model: true, overallBuyerAdvantage: true },
  });

  const topMarketsData = markets.map((m) => ({
    metro: m.metroName,
    score: Math.round((m.buyerLeverageScore ?? 0) * 10) / 10,
    state: m.state,
  }));

  const vehiclePricesData = vehicles.map((v) => ({
    make: v.make,
    model: v.model,
    msrp: Math.round(v.msrpCents / 100),
    fairMarketLow: Math.round(v.fairMarketLowCents / 100),
    discountPct:
      v.msrpCents > 0
        ? Math.round(((v.msrpCents - v.fairMarketLowCents) / v.msrpCents) * 1000) / 10
        : 0,
  }));

  const marketScoresData = scores.map((s) => ({
    metro: s.metro,
    make: s.make,
    model: s.model,
    buyerAdvantage: Math.round(s.overallBuyerAdvantage * 10) / 10,
  }));

  const userPrompt = `Write the AutoLenis Market Index for week of ${weekOf}.
Data:
Top markets: ${JSON.stringify(topMarketsData)}
Vehicle prices: ${JSON.stringify(vehiclePricesData)}
Market scores: ${JSON.stringify(marketScoresData)}

Write a 600-800 word professional market intelligence report covering:
1. Top 5 buyer leverage markets this week
2. Notable vehicle price movements
3. Dealer competition analysis
4. One actionable buyer tip
5. Brief outlook for next week

Return ONLY valid JSON. No markdown. No explanation.
{
  "title": string,
  "body": string,
  "summary": string (2-3 sentences for a LinkedIn caption),
  "topMarkets": [{ "metro": string, "score": number, "trend": string }],
  "priceMovements": [{ "make": string, "model": string, "change": string }]
}
Begin your response with { and end with }.`;

  const raw = await callGroq(SYSTEM_PROMPT, userPrompt);
  const parsed = JSON.parse(stripFences(raw)) as Partial<MarketIndexReport>;

  // Fallbacks derived from real data so the report is always well-formed even
  // if the model omits a structured field.
  const topMarkets =
    Array.isArray(parsed.topMarkets) && parsed.topMarkets.length > 0
      ? parsed.topMarkets
      : topMarketsData.slice(0, 5).map((m) => ({
          metro: `${m.metro}, ${m.state}`,
          score: m.score,
          trend: "stable",
        }));

  const priceMovements =
    Array.isArray(parsed.priceMovements) && parsed.priceMovements.length > 0
      ? parsed.priceMovements
      : vehiclePricesData
          .slice()
          .sort((a, b) => b.discountPct - a.discountPct)
          .slice(0, 5)
          .map((v) => ({
            make: v.make,
            model: v.model,
            change: `${v.discountPct}% below MSRP`,
          }));

  const title = parsed.title?.trim() || `AutoLenis Market Index — Week of ${weekOf}`;
  const body = parsed.body?.trim() || "";
  const summary =
    parsed.summary?.trim() ||
    `The AutoLenis Market Index for the week of ${weekOf}: live buyer-leverage rankings across top metros and notable vehicle price movements.`;

  if (!body) {
    throw new Error("Market index generation returned an empty body");
  }

  return { title, body, summary, topMarkets, priceMovements, weekOf };
}

const MARKET_INDEX_FRANCHISE_SLUG = "autolenis_market_index";

export interface PublishMarketIndexResult {
  weekOf: string;
  published: boolean;
  platformPostId: string | null;
  socialPostId: string | null;
  linkedInUrl: string | null;
  summary: string;
  title: string;
  topMarkets: number;
  priceMovements: number;
}

// Full pipeline: generate the report, publish it to the LinkedIn company page,
// record it as a SocialPost, and email the admin. Shared by the weekly cron and
// the admin "Generate Now" action. Each side-effect is best-effort so a single
// failure never discards the report.
export async function publishMarketIndex(): Promise<PublishMarketIndexResult> {
  const report = await generateMarketIndex();

  // Publish to LinkedIn (best-effort).
  const linkedIn = new LinkedInProvider();
  const publishResult = await linkedIn.publishNow({
    postId: `market-index-${report.weekOf}`,
    platform: "linkedin",
    caption: `${report.title}\n\n${report.body}`,
    hashtags: [],
  });
  if (!publishResult.success) {
    console.error("[market-index] LinkedIn publish failed:", publishResult.error);
  }

  // Record as a SocialPost (best-effort).
  const franchise = await prisma.contentFranchise
    .findUnique({ where: { slug: MARKET_INDEX_FRANCHISE_SLUG }, select: { id: true } })
    .catch(() => null);

  let socialPostId: string | null = null;
  try {
    const post = await prisma.socialPost.create({
      data: {
        franchiseId: franchise?.id ?? null,
        platform: "linkedin",
        contentType: "linkedin_article",
        hook: report.title,
        script: report.body,
        caption: report.summary,
        hashtags: [],
        funnelDestination: "/buying-guide",
        utmSource: "linkedin",
        utmMedium: "social",
        utmContent: MARKET_INDEX_FRANCHISE_SLUG,
        utmPlatform: "linkedin",
        automationMode: "FULL_AUTO",
        status: publishResult.success ? "PUBLISHED" : "FAILED",
        publishingProvider: "linkedin",
        platformPostId: publishResult.platformPostId ?? null,
        publishError: publishResult.success ? null : publishResult.error ?? "publish failed",
        publishedAt: publishResult.success ? new Date() : null,
      },
    });
    socialPostId = post.id;
  } catch (err) {
    console.error(
      "[market-index] socialPost.create failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }

  const linkedInUrl = publishResult.platformPostId
    ? `https://www.linkedin.com/feed/update/${publishResult.platformPostId}`
    : null;

  await sendMarketIndexPublishedEmail({
    weekOf: report.weekOf,
    summary: report.summary,
    linkedInUrl: linkedInUrl ?? undefined,
  }).catch((err) =>
    console.error("[market-index] admin email failed:", err instanceof Error ? err.message : err),
  );

  console.log(`[market-index] published week of ${report.weekOf}`);
  return {
    weekOf: report.weekOf,
    published: publishResult.success,
    platformPostId: publishResult.platformPostId ?? null,
    socialPostId,
    linkedInUrl,
    summary: report.summary,
    title: report.title,
    topMarkets: report.topMarkets.length,
    priceMovements: report.priceMovements.length,
  };
}
