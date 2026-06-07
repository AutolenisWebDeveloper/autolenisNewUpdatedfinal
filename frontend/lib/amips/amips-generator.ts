// AMIPS Phase 2 — generator orchestrator.
//
// One queue item in → one AMIPS page out (or a flagged queue item). The
// orchestrator is the only place the pieces meet: assemble the data, ask Groq
// to narrate it, run the five quality gates, and persist the result. It never
// invents data and never publishes a page that fails the gates.

import { prisma } from "@/lib/prisma";
import type { ContentQueue } from "@prisma/client";
import { groqChat } from "@/lib/ai/groq-client";
import { assembleAmipsPageData } from "@/lib/amips/assembler";
import {
  buildAmipsMessages,
  type GeneratedAmipsArticle,
} from "@/lib/amips/prompts/amips-generator.prompts";
import { runQualityGates } from "@/lib/amips/quality-gate";
import { markdownToHtml } from "@/lib/amips/markdown";

export type AmipsGenerateStatus =
  | "published"
  | "review_needed"
  | "failed"
  | "pending_enrichment";

export interface AmipsGenerateResult {
  status: AmipsGenerateStatus;
  amipsPageId?: string;
  qualityScore?: number;
  reason?: string;
}

// Slugify a keyword target into a stable, URL-safe slug.
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

// Extract the first balanced top-level JSON object from a model response,
// tolerating ```json fences and stray prose. Mirrors the Phase C2 parser.
function extractJsonObject(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = fenced ? fenced[1] : raw;
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseArticle(raw: string): GeneratedAmipsArticle {
  const jsonStr = extractJsonObject(raw);
  if (!jsonStr) throw new Error("model returned no parseable JSON object");

  const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

  const str = (v: unknown, field: string): string => {
    if (typeof v !== "string" || !v.trim()) {
      throw new Error(`model JSON missing non-empty '${field}'`);
    }
    return v.trim();
  };

  const faqs = Array.isArray(parsed.faqs)
    ? parsed.faqs
        .filter(
          (f): f is { question: string; answer: string } =>
            !!f &&
            typeof (f as { question?: unknown }).question === "string" &&
            typeof (f as { answer?: unknown }).answer === "string",
        )
        .map((f) => ({ question: f.question.trim(), answer: f.answer.trim() }))
    : [];

  const dataTokensUsed = Array.isArray(parsed.dataTokensUsed)
    ? parsed.dataTokensUsed.map((t) => String(t))
    : [];

  const body = str(parsed.body, "body");

  return {
    title: str(parsed.title, "title"),
    metaDescription: str(parsed.metaDescription, "metaDescription"),
    h1: str(parsed.h1, "h1"),
    body,
    faqs,
    dataTokensUsed,
    wordCount:
      typeof parsed.wordCount === "number"
        ? parsed.wordCount
        : body.split(/\s+/).filter(Boolean).length,
  };
}

/**
 * Generate one AMIPS page from a content-queue item. Persists an AmipsPage on
 * PUBLISHED/REVIEW_NEEDED and updates the queue item's status throughout.
 */
export async function generateAmipsPage(
  queueItem: ContentQueue,
): Promise<AmipsGenerateResult> {
  // 1 — Assemble. No data => skip and flag for enrichment.
  const data = await assembleAmipsPageData(queueItem);
  if (!data) {
    await prisma.contentQueue.update({
      where: { id: queueItem.id },
      data: {
        status: "pending_enrichment",
        attempts: { increment: 1 },
        failureReason: "Required intelligence data missing or stale",
      },
    });
    console.log(
      `[amips-generator] tier=${queueItem.contentTier} status=pending_enrichment keyword="${queueItem.keywordTarget}"`,
    );
    return { status: "pending_enrichment" };
  }

  // 2 — Narrate the data object.
  const completion = await groqChat(buildAmipsMessages(data), {
    maxTokens: 3500,
    temperature: 0.6,
  });

  // 3 — Parse the JSON response.
  let article: GeneratedAmipsArticle;
  try {
    article = parseArticle(completion.content);
  } catch (err) {
    await prisma.contentQueue.update({
      where: { id: queueItem.id },
      data: {
        status: "failed",
        attempts: { increment: 1 },
        failureReason: `Unparseable model output: ${String(err)}`,
      },
    });
    console.log(
      `[amips-generator] tier=${data.tier} status=failed reason=parse keyword="${data.keywordTarget}"`,
    );
    return { status: "failed", reason: "parse_error" };
  }

  // 4 — Quality gates. Uniqueness compares against existing pages for the same
  // make + model + metro.
  const existing = await prisma.amipsPage.findMany({
    where: {
      make: data.vehicle.make,
      model: data.vehicle.model,
      metro: data.market?.metro ?? null,
    },
    select: { body: true },
    take: 25,
  });
  const gate = runQualityGates(
    article,
    data,
    existing.map((e) => e.body),
  );

  // 5 — Hard fail returns the item to the queue.
  if (gate.status === "FAILED") {
    await prisma.contentQueue.update({
      where: { id: queueItem.id },
      data: {
        status: "failed",
        attempts: { increment: 1 },
        failureReason: gate.failedGates.join("; "),
      },
    });
    console.log(
      `[amips-generator] tier=${data.tier} status=failed score=${gate.score} gates="${gate.failedGates.join("; ")}"`,
    );
    return { status: "failed", qualityScore: gate.score, reason: "quality_gate" };
  }

  // 6 — Persist the page. PUBLISHED → ACTIVE & live; REVIEW_NEEDED → held for
  // human review (the public route only serves ACTIVE pages).
  const published = gate.status === "PUBLISHED";
  const slug = slugify(data.keywordTarget);
  const now = new Date();
  const bodyHtml = markdownToHtml(gate.cleanedBody);

  const page = await prisma.amipsPage.upsert({
    where: { slug },
    create: {
      slug,
      contentTier: data.tier,
      make: data.vehicle.make,
      model: data.vehicle.model,
      metro: data.market?.metro ?? null,
      state: data.market?.state ?? null,
      title: article.title.slice(0, 70),
      metaDescription: article.metaDescription.slice(0, 160),
      h1: article.h1,
      body: bodyHtml,
      faqJson: JSON.stringify(article.faqs),
      marketScoreJson: data.marketScore ? JSON.stringify(data.marketScore) : null,
      dataTokenCount: article.dataTokensUsed.length,
      ctaType: data.ctaType,
      lifecycleStatus: published ? "ACTIVE" : "UNDER_REVIEW",
      qualityGateStatus: gate.status,
      qualityGateFlags: JSON.stringify({
        failedGates: gate.failedGates,
        warnings: gate.warnings,
        score: gate.score,
      }),
      vehicleDataAsOf: data.vehicleDataAsOf,
      dealerDataAsOf: data.dealerDataAsOf ?? null,
      marketDataAsOf: data.marketDataAsOf ?? null,
      publishedAt: published ? now : null,
      lastRefreshedAt: now,
    },
    update: {
      contentTier: data.tier,
      title: article.title.slice(0, 70),
      metaDescription: article.metaDescription.slice(0, 160),
      h1: article.h1,
      body: bodyHtml,
      faqJson: JSON.stringify(article.faqs),
      marketScoreJson: data.marketScore ? JSON.stringify(data.marketScore) : null,
      dataTokenCount: article.dataTokensUsed.length,
      ctaType: data.ctaType,
      lifecycleStatus: published ? "ACTIVE" : "UNDER_REVIEW",
      qualityGateStatus: gate.status,
      qualityGateFlags: JSON.stringify({
        failedGates: gate.failedGates,
        warnings: gate.warnings,
        score: gate.score,
      }),
      vehicleDataAsOf: data.vehicleDataAsOf,
      dealerDataAsOf: data.dealerDataAsOf ?? null,
      marketDataAsOf: data.marketDataAsOf ?? null,
      publishedAt: published ? now : undefined,
      lastRefreshedAt: now,
    },
  });

  // 7 — Mark the queue item complete and link the page.
  await prisma.contentQueue.update({
    where: { id: queueItem.id },
    data: {
      status: "complete",
      attempts: { increment: 1 },
      contentPageId: page.id,
      failureReason: null,
    },
  });

  console.log(
    `[amips-generator] tier=${data.tier} status=${gate.status} score=${gate.score} slug="${slug}" model=${completion.model}`,
  );

  return {
    status: published ? "published" : "review_needed",
    amipsPageId: page.id,
    qualityScore: gate.score,
  };
}
