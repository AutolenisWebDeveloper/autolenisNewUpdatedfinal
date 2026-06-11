// Phase C2 — Article generation engine (orchestrator).
//
// Takes one ContentKeyword, asks Groq for a GEO-optimized compliant draft,
// parses + sanitizes it, scores it against the quality rubric and compliance
// validator, and decides a publish status. Pure of any database concern — the
// batch script (scripts/generate-articles.ts) persists the result.
//
// Status decision (matches the 90-day plan: "only publish 6/6"):
//   compliance fail            → REVIEW_NEEDED (human must check)
//   quality 6/6 + compliant    → PUBLISHED (or REVIEW_NEEDED in --review-only)
//   quality 4-5                → REVIEW_NEEDED
//   quality 0-3                → DRAFT

import type { ArticleStatus } from "@prisma/client";

import { groqChat } from "@/lib/ai/groq-client";
import type { ContentKeyword } from "@/lib/seo/content-keywords";
import { buildMessages, buildRetryMessage } from "@/lib/content/prompts";
import { validateCompliance, type ComplianceResult } from "@/lib/content/compliance";
import { scoreArticle, type QualityResult } from "@/lib/content/quality";
import { sanitizeBody } from "@/lib/content/sanitize";

// Re-exported for backward compatibility — the sanitizer now lives in its own
// dependency-free module so it can also run at render time and in the
// validation service. See lib/content/sanitize.ts.
export { sanitizeBody };

export interface ArticleFaq {
  question: string;
  answer: string;
}

export interface GeneratedArticle {
  keyword: ContentKeyword;
  body: string;
  faqs: ArticleFaq[];
  faqJson: string;
  wordCount: number;
  model: string;
  attempts: number;
  compliance: ComplianceResult;
  quality: QualityResult;
  status: ArticleStatus;
  qualityFlags: string; // JSON blob stored on ContentArticle.qualityFlags
}

export interface GenerateOptions {
  maxAttempts?: number; // default 2 (one retry with feedback)
  reviewOnly?: boolean; // never auto-publish; cap at REVIEW_NEEDED
  temperature?: number;
  maxTokens?: number;
}

// Extract the first balanced top-level JSON object from a model response,
// tolerating ```json fences and any stray prose around it.
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

interface ParsedDraft {
  body: string;
  faqs: ArticleFaq[];
}

function parseDraft(raw: string): ParsedDraft {
  const jsonStr = extractJsonObject(raw);
  if (!jsonStr) throw new Error("model returned no parseable JSON object");

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`model JSON did not parse: ${String(err)}`);
  }

  const obj = parsed as { body?: unknown; faqs?: unknown };
  if (typeof obj.body !== "string" || !obj.body.trim()) {
    throw new Error("model JSON missing a non-empty 'body' string");
  }

  const faqs: ArticleFaq[] = Array.isArray(obj.faqs)
    ? obj.faqs
        .filter(
          (f): f is ArticleFaq =>
            !!f &&
            typeof (f as ArticleFaq).question === "string" &&
            typeof (f as ArticleFaq).answer === "string",
        )
        .map((f) => ({ question: f.question.trim(), answer: f.answer.trim() }))
    : [];

  return { body: sanitizeBody(obj.body), faqs };
}

function decideStatus(
  compliance: ComplianceResult,
  quality: QualityResult,
  reviewOnly: boolean,
): ArticleStatus {
  if (!compliance.passed) return "REVIEW_NEEDED";
  if (quality.passedAll) return reviewOnly ? "REVIEW_NEEDED" : "PUBLISHED";
  // Recover borderline drafts: if the ONLY rubric miss is the word-count
  // minimum and the body still cleared 600 words, auto-publish. Compliance has
  // already passed above, so these are fully compliant, rubric-clean articles
  // that fell just short of the length target.
  if (
    quality.flags.length === 1 &&
    quality.flags[0] === "Minimum 700 words" &&
    quality.wordCount >= 600
  ) {
    return reviewOnly ? "REVIEW_NEEDED" : "PUBLISHED";
  }
  if (quality.score >= 4) return "REVIEW_NEEDED";
  return "DRAFT";
}

function evaluate(keyword: ContentKeyword, draft: ParsedDraft) {
  const compliance = validateCompliance(
    `${draft.body} ${draft.faqs.map((f) => `${f.question} ${f.answer}`).join(" ")}`,
  );
  const quality = scoreArticle({
    body: draft.body,
    faqs: draft.faqs,
    city: keyword.city,
    state: keyword.state,
    metro: keyword.metro,
    pillarSlugs: keyword.pillarSlugs,
    toolUrl: keyword.toolUrl,
  });
  return { compliance, quality };
}

// Build the list of human-readable issues fed back to the model on a retry.
function issuesFor(compliance: ComplianceResult, quality: QualityResult): string[] {
  const issues: string[] = [];
  for (const v of compliance.violations) {
    issues.push(`COMPLIANCE (${v.rule}): ${v.detail} — found near "${v.match}"`);
  }
  for (const c of quality.checks) {
    if (c.passed) continue;
    if (c.id === "named_author" || c.id === "conversion_element") continue; // route-provided
    issues.push(`QUALITY (${c.label}): ${c.detail}`);
  }
  return issues;
}

export async function generateArticle(
  keyword: ContentKeyword,
  options: GenerateOptions = {},
): Promise<GeneratedArticle> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 2);
  const reviewOnly = options.reviewOnly ?? false;

  const messages = buildMessages(keyword);
  let model = "";
  let attempts = 0;
  let best: { draft: ParsedDraft; compliance: ComplianceResult; quality: QualityResult } | null =
    null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts = attempt;
    const completion = await groqChat(messages, {
      temperature: options.temperature ?? 0.55,
      maxTokens: options.maxTokens ?? 4096,
    });
    model = completion.model;

    let draft: ParsedDraft;
    try {
      draft = parseDraft(completion.content);
    } catch (err) {
      // Unparseable — ask the model to return strict JSON and try again.
      if (attempt < maxAttempts) {
        messages.push({ role: "assistant", content: completion.content });
        messages.push(
          buildRetryMessage([`OUTPUT: ${String(err)} — return STRICT minified JSON only.`]),
        );
        continue;
      }
      throw err;
    }

    const { compliance, quality } = evaluate(keyword, draft);

    // Keep the highest-scoring compliant-leaning draft across attempts.
    const better =
      !best ||
      (compliance.passed ? 1 : 0) - (best.compliance.passed ? 1 : 0) > 0 ||
      (compliance.passed === best.compliance.passed &&
        quality.score > best.quality.score);
    if (better) best = { draft, compliance, quality };

    const clean = compliance.passed && quality.passedAll;
    if (clean || attempt === maxAttempts) break;

    const issues = issuesFor(compliance, quality);
    messages.push({ role: "assistant", content: completion.content });
    messages.push(buildRetryMessage(issues));
  }

  if (!best) throw new Error(`generation produced no usable draft for ${keyword.slug}`);

  const { draft, compliance, quality } = best;
  const status = decideStatus(compliance, quality, reviewOnly);

  return {
    keyword,
    body: draft.body,
    faqs: draft.faqs,
    faqJson: JSON.stringify(draft.faqs),
    wordCount: quality.wordCount,
    model,
    attempts,
    compliance,
    quality,
    status,
    qualityFlags: JSON.stringify({
      score: quality.score,
      maxScore: quality.maxScore,
      qualityFlags: quality.flags,
      compliancePassed: compliance.passed,
      complianceViolations: compliance.violations,
    }),
  };
}
