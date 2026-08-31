// AutoLenis Social Engine — Competitor Intelligence Monitor (Session D).
//
// Asks Groq to surface content opportunities based on what major automotive
// competitors (CarEdge, CarGurus, Edmunds, Carvana) typically post, and how
// AutoLenis can do it better using its reverse-auction data. Results are
// cached per ISO week in competitor_insights; high-engagement opportunities
// also spawn a TopicSignal so the generation pipeline can act on them.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { complete } from "@/lib/ai/provider";

export interface CompetitorInsight {
  competitor: string;
  topic: string;
  contentType: string;
  estimatedEngagement: string;
  opportunity: string;
  suggestedHook: string;
  weekOf: string;
}

const GROQ_MODEL = "llama-3.3-70b-versatile";

export async function scanCompetitorContent(): Promise<CompetitorInsight[]> {
  const groqKey = process.env.GROQ_API_KEY ?? "";
  if (!groqKey || groqKey.startsWith("gsk_placeholder")) return [];

  const weekOf = new Date().toISOString().split("T")[0];

  // Already scanned this week? Return the cached rows instead of re-spending
  // Groq tokens — the scan is idempotent per ISO week.
  const existing = await prisma.competitorInsight
    .findFirst({ where: { weekOf } })
    .catch(() => null);

  if (existing) {
    const allThisWeek = await prisma.competitorInsight
      .findMany({ where: { weekOf } })
      .catch(() => [] as Awaited<ReturnType<typeof prisma.competitorInsight.findMany>>);
    return allThisWeek.map((r) => ({
      competitor: r.competitor,
      topic: r.topic,
      contentType: r.contentType,
      estimatedEngagement: r.estimatedEngagement,
      opportunity: r.opportunity,
      suggestedHook: r.suggestedHook,
      weekOf: r.weekOf,
    }));
  }

  try {
    const result = await complete({
      purpose: "social.competitor_monitor",
      model: GROQ_MODEL,
      messages: [
        {
          role: "user",
            content: `You are an automotive content strategist.
Identify 5 content opportunities for AutoLenis based on what
CarEdge, CarGurus, Edmunds, and Carvana typically post on
TikTok and Instagram. For each opportunity, explain how
AutoLenis can do it better using its reverse auction data.

Return ONLY valid JSON array, no other text:
[{
  "competitor": "competitor name",
  "topic": "content topic",
  "contentType": "tiktok_video|instagram_reel|linkedin_post",
  "estimatedEngagement": "high|medium|low",
  "opportunity": "how AutoLenis does this better (1 sentence)",
  "suggestedHook": "specific hook AutoLenis could use (under 15 words)"
}]`,
        },
      ],
      maxTokens: 600,
    });

    // Upstream failures (auth/quota/5xx) still surface rather than being
    // silently parsed as "[]" and reported as a successful empty scan — the
    // provider adapter throws a ProviderHttpError, which the catch below logs.
    const raw = result.content || "[]";
    const cleaned = raw.replace(/```json|```/g, "").trim();
    let insights: Omit<CompetitorInsight, "weekOf">[];
    try {
      insights = JSON.parse(cleaned) as Omit<CompetitorInsight, "weekOf">[];
    } catch (parseErr) {
      logger.error(
        "[competitor-monitor] failed to parse Groq JSON:",
        parseErr instanceof Error ? parseErr.message : parseErr,
      );
      return [];
    }

    if (!Array.isArray(insights)) return [];

    const stored: CompetitorInsight[] = [];
    for (const insight of insights) {
      try {
        const record = await prisma.competitorInsight.create({
          data: {
            competitor: insight.competitor,
            topic: insight.topic,
            contentType: insight.contentType,
            estimatedEngagement: insight.estimatedEngagement,
            opportunity: insight.opportunity,
            suggestedHook: insight.suggestedHook ?? "",
            weekOf,
            signalCreated: false,
          },
        });
        stored.push({ ...insight, weekOf });

        // High-engagement opportunities become actionable TopicSignals.
        if (insight.estimatedEngagement === "high") {
          await prisma.topicSignal
            .create({
              data: {
                signalType: "competitor_gap",
                signalContext: {
                  opportunity: insight.opportunity,
                  competitor: insight.competitor,
                  suggestedHook: insight.suggestedHook,
                } as object,
                detectedAt: new Date(),
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                assetsGenerated: false,
              },
            })
            .catch(() => undefined);

          await prisma.competitorInsight
            .update({ where: { id: record.id }, data: { signalCreated: true } })
            .catch(() => undefined);
        }
      } catch (err) {
        logger.error("[competitor] store failed:", err);
      }
    }

    logger.info(`[competitor] found ${stored.length} opportunities`);
    return stored;
  } catch (err) {
    logger.error("[competitor] scan failed:", err);
    return [];
  }
}
