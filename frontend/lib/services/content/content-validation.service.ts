// WO-6 — Layered content validation service.
//
// Runs an ordered set of validation layers over an article and produces a single
// ContentValidationResult per run. The CORE (`runContentValidation`) is pure —
// no DB, no I/O — so every layer is unit-testable. The DB wrapper
// (`validateArticle`) loads the article, builds the duplicate corpus, runs the
// core, persists the sanitized body + a ContentValidationResult, and stamps
// lastValidatedAt.
//
// Reuses existing primitives rather than reinventing them:
//   - compliance.ts (validateCompliance / stripHtml)
//   - sanitize.ts   (sanitizeBody / bodyNeededSanitizing)
//   - pillar-links  (CLUSTER_PILLAR_MAP) for internal-link expectations
//
// A failed REQUIRED layer blocks publish unless an admin override+reason is
// recorded (handled by the publishing service). fact-risk flags for human
// review (requiresHumanReview) — generation must not auto-publish a flagged
// article.

import { prisma } from "@/lib/prisma";
import { validateCompliance, stripHtml } from "@/lib/content/compliance";
import { sanitizeBody, bodyNeededSanitizing } from "@/lib/content/sanitize";
import { CLUSTER_PILLAR_MAP } from "@/lib/seo/pillar-links";

export const MIN_WORDS = 700;
export const RECOVERY_WORDS = 600;
export const DUPLICATE_JACCARD_THRESHOLD = 0.8; // mirrors AMIPS quality-gate uniqueness

export interface ValidationLayerResult {
  id: string;
  label: string;
  required: boolean;
  passed: boolean;
  detail: string;
  data?: Record<string, unknown>;
}

export interface ValidationRunResult {
  passed: boolean; // every REQUIRED layer passed
  requiresHumanReview: boolean; // fact-risk flagged → never auto-publish
  layers: ValidationLayerResult[];
  sanitizedBody: string;
}

export interface DuplicateCorpusEntry {
  slug: string;
  fingerprint: string[];
}

export interface ValidationInput {
  slug: string;
  title: string;
  metaDescription: string;
  h1: string;
  body: string;
  faqJson: string | null;
  targetKeyword: string;
  cluster: string;
  city: string;
  state: string;
  featuredImageUrl?: string | null;
  // Pre-computed fingerprints of OTHER articles in the same cluster/city, for
  // near-duplicate detection. The DB wrapper supplies this.
  duplicateCorpus?: DuplicateCorpusEntry[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function extractHrefs(html: string): string[] {
  const out: string[] = [];
  const re = /href\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push((m[2] ?? m[3] ?? "").trim());
  return out;
}

// Normalized 5-gram shingle set used for near-duplicate (Jaccard) detection.
export function bodyFingerprint(body: string): string[] {
  const norm = stripHtml(body)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = norm.split(" ").filter(Boolean);
  const shingles = new Set<string>();
  for (let i = 0; i + 5 <= tokens.length; i++) {
    shingles.add(tokens.slice(i, i + 5).join(" "));
  }
  return [...shingles];
}

export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let inter = 0;
  for (const s of a) if (setB.has(s)) inter += 1;
  const union = a.length + b.length - inter;
  return union === 0 ? 0 : inter / union;
}

// ── Pure validation core ─────────────────────────────────────────────────────

export function runContentValidation(input: ValidationInput): ValidationRunResult {
  const layers: ValidationLayerResult[] = [];
  const faqText = (() => {
    if (!input.faqJson) return "";
    try {
      const parsed = JSON.parse(input.faqJson) as Array<{ question?: string; answer?: string }>;
      if (!Array.isArray(parsed)) return "";
      return parsed.map((f) => `${f.question ?? ""} ${f.answer ?? ""}`).join(" ");
    } catch {
      return "";
    }
  })();
  const sanitizedBody = sanitizeBody(input.body);
  const plain = stripHtml(sanitizedBody);
  const wordCount = words(plain).length;

  // 1. Compliance (required)
  const compliance = validateCompliance(`${input.body} ${faqText}`);
  layers.push({
    id: "compliance",
    label: "Compliance",
    required: true,
    passed: compliance.passed,
    detail: compliance.passed
      ? "No banned-phrase / misrepresentation / pricing violations."
      : `${compliance.violations.length} violation(s): ${compliance.violations.map((v) => v.rule).join(", ")}`,
    data: { violations: compliance.violations },
  });

  // 2. HTML sanitization (required) — fails if the stored body was not already
  // sanitized; the run returns the sanitized body so the caller persists it.
  const neededSanitizing = bodyNeededSanitizing(input.body);
  layers.push({
    id: "html_sanitization",
    label: "HTML sanitization",
    required: true,
    passed: !neededSanitizing,
    detail: neededSanitizing
      ? "Body contained disallowed tags/attributes; sanitized copy was produced and must be stored."
      : "Body is already within the allowlist.",
  });

  // 3. SEO structure (required)
  const titleLen = input.title.trim().length;
  const metaLen = input.metaDescription.trim().length;
  const hasInlineH1 = /<h1[\s>]/i.test(input.body);
  const kw = input.targetKeyword.toLowerCase();
  const keywordPresent =
    plain.toLowerCase().includes(kw) || input.title.toLowerCase().includes(kw);
  const seoIssues: string[] = [];
  if (titleLen < 15 || titleLen > 70) seoIssues.push(`title length ${titleLen} (want 15–70)`);
  if (metaLen < 50 || metaLen > 165) seoIssues.push(`meta length ${metaLen} (want 50–165)`);
  if (hasInlineH1) seoIssues.push("body contains an inline <h1> (route already renders the H1)");
  if (!keywordPresent) seoIssues.push("target keyword absent from body and title");
  layers.push({
    id: "seo_structure",
    label: "SEO structure",
    required: true,
    passed: seoIssues.length === 0,
    detail: seoIssues.length === 0 ? "Title/meta/H1/keyword all valid." : seoIssues.join("; "),
  });

  // 4. Word count (required) — recovery band passes with a warning.
  const wcPass = wordCount >= RECOVERY_WORDS;
  layers.push({
    id: "word_count",
    label: "Word count",
    required: true,
    passed: wcPass,
    detail:
      wordCount >= MIN_WORDS
        ? `${wordCount} words (≥ ${MIN_WORDS}).`
        : wcPass
          ? `${wordCount} words — recovery band (≥ ${RECOVERY_WORDS}, < ${MIN_WORDS}).`
          : `${wordCount} words — below minimum ${RECOVERY_WORDS}.`,
    data: { wordCount },
  });

  // 5. FAQ-schema validity (required) — absent FAQ is allowed; malformed is not.
  let faqPassed = true;
  let faqDetail = "No FAQ block (allowed).";
  if (input.faqJson) {
    try {
      const parsed = JSON.parse(input.faqJson);
      if (!Array.isArray(parsed)) {
        faqPassed = false;
        faqDetail = "faqJson is not an array.";
      } else {
        const bad = parsed.some(
          (f: unknown) =>
            !f ||
            typeof (f as { question?: unknown }).question !== "string" ||
            typeof (f as { answer?: unknown }).answer !== "string" ||
            !(f as { question: string }).question.trim() ||
            !(f as { answer: string }).answer.trim(),
        );
        faqPassed = !bad;
        faqDetail = bad ? "One or more FAQ entries missing question/answer." : `${parsed.length} valid FAQ(s).`;
      }
    } catch {
      faqPassed = false;
      faqDetail = "faqJson does not parse.";
    }
  }
  layers.push({ id: "faq_validity", label: "FAQ schema", required: true, passed: faqPassed, detail: faqDetail });

  const hrefs = extractHrefs(sanitizedBody);

  // 6. Internal-link validity (warning) — expect ≥1 pillar link + ≥1 tool link.
  const pillarSlugs = CLUSTER_PILLAR_MAP[input.cluster] ?? [];
  const hasPillar = hrefs.some((h) => pillarSlugs.some((p) => h.includes(p)));
  const hasTool = hrefs.some((h) => h.includes("/tools/"));
  layers.push({
    id: "internal_links",
    label: "Internal links",
    required: false,
    passed: hasPillar && hasTool,
    detail: `${hrefs.length} link(s); pillar=${hasPillar}, tool=${hasTool}. ` +
      "DB-level noindex/redirect resolution is enforced at publish time.",
    data: { hrefCount: hrefs.length, hasPillar, hasTool },
  });

  // 7. Duplicate detection (warning, flags for review)
  const fp = bodyFingerprint(input.body);
  let maxSim = 0;
  let nearest = "";
  for (const entry of input.duplicateCorpus ?? []) {
    if (entry.slug === input.slug) continue;
    const sim = jaccard(fp, entry.fingerprint);
    if (sim > maxSim) {
      maxSim = sim;
      nearest = entry.slug;
    }
  }
  const dupPass = maxSim < DUPLICATE_JACCARD_THRESHOLD;
  layers.push({
    id: "duplicate",
    label: "Duplicate detection",
    required: false,
    passed: dupPass,
    detail: dupPass
      ? `Max similarity ${(maxSim * 100).toFixed(0)}% (< ${DUPLICATE_JACCARD_THRESHOLD * 100}%).`
      : `Near-duplicate of ${nearest} at ${(maxSim * 100).toFixed(0)}%.`,
    data: { maxSimilarity: maxSim, nearest },
  });

  // 8. Broken-link / scheme check (warning)
  const badLinks = hrefs.filter(
    (h) => !h || /^javascript:/i.test(h) || !/^(\/|https?:\/\/|#|mailto:|tel:)/i.test(h),
  );
  layers.push({
    id: "broken_links",
    label: "Link safety",
    required: false,
    passed: badLinks.length === 0,
    detail: badLinks.length === 0 ? "All hrefs well-formed and safe." : `${badLinks.length} suspicious href(s).`,
    data: { badLinks },
  });

  // 9. Readability (warning) — average sentence length heuristic.
  const sentences = plain.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  const avgSentenceWords = sentences.length ? wordCount / sentences.length : wordCount;
  layers.push({
    id: "readability",
    label: "Readability",
    required: false,
    passed: avgSentenceWords <= 30,
    detail: `Avg ${avgSentenceWords.toFixed(1)} words/sentence (want ≤ 30).`,
    data: { avgSentenceWords },
  });

  // 10. CTA presence (warning) — a tool/calculator link or explicit CTA anchor.
  const hasCta = hasTool || /request[-\s]?offers|join[-\s]?waitlist|get\s+offers/i.test(plain);
  layers.push({
    id: "cta_presence",
    label: "CTA presence",
    required: false,
    passed: hasCta,
    detail: hasCta ? "CTA / tool link present (route also injects CTAs)." : "No in-body CTA detected.",
  });

  // 11. Media presence (warning) — featured image is generated asynchronously.
  layers.push({
    id: "media_presence",
    label: "Featured media",
    required: false,
    passed: !!input.featuredImageUrl,
    detail: input.featuredImageUrl ? "Featured image set." : "No featured image yet (generated asynchronously).",
  });

  // 12. Fact-risk (warning, requires human review) — unsubstantiated quantitative
  // claims that compliance didn't already catch. Never auto-publish when flagged.
  const factRiskPatterns = [
    /\b(?:average|typically|on average|up to|as much as)\b[^.<\n]{0,20}\$\s?\d/i,
    /\b(?:average|typically|on average)\b[^.<\n]{0,20}\d{1,3}\s?%/i,
  ];
  const factHit = factRiskPatterns.find((p) => p.test(plain));
  const factPass = !factHit;
  layers.push({
    id: "fact_risk",
    label: "Fact risk",
    required: false,
    passed: factPass,
    detail: factPass
      ? "No unsubstantiated quantitative claims detected."
      : `Possible unsubstantiated quantitative claim near "${plain.match(factHit!)?.[0]?.trim().slice(0, 60)}". Needs human review.`,
  });

  const passed = layers.filter((l) => l.required).every((l) => l.passed);
  const requiresHumanReview = !factPass;

  return { passed, requiresHumanReview, layers, sanitizedBody };
}

// ── DB wrapper ────────────────────────────────────────────────────────────────

export interface ValidateArticleOptions {
  // When provided, an admin override is recorded on the result so a failed
  // required layer no longer blocks publish.
  overriddenByAdminId?: string;
  overrideReason?: string;
}

// Load the article, build the same-cluster/city duplicate corpus, run the core,
// persist the sanitized body if it changed, write a ContentValidationResult, and
// stamp lastValidatedAt. Returns the run result + the result row id.
export async function validateArticle(
  articleId: string,
  opts: ValidateArticleOptions = {},
) {
  const article = await prisma.contentArticle.findUnique({ where: { id: articleId } });
  if (!article) throw new Error(`article ${articleId} not found`);

  // Bounded corpus: other articles in the same cluster + city.
  const corpusRows = await prisma.contentArticle.findMany({
    where: { cluster: article.cluster, city: article.city, id: { not: article.id } },
    select: { slug: true, body: true },
    take: 200,
  });
  const duplicateCorpus: DuplicateCorpusEntry[] = corpusRows.map((r) => ({
    slug: r.slug,
    fingerprint: bodyFingerprint(r.body),
  }));

  const run = runContentValidation({
    slug: article.slug,
    title: article.title,
    metaDescription: article.metaDescription,
    h1: article.h1,
    body: article.body,
    faqJson: article.faqJson,
    targetKeyword: article.targetKeyword,
    cluster: article.cluster,
    city: article.city,
    state: article.state,
    featuredImageUrl: article.featuredImageUrl,
    duplicateCorpus,
  });

  const overridden = !!opts.overriddenByAdminId;

  // Persist the sanitized body (so the stored body is always safe) and stamp
  // validation timestamp. Only write the body if sanitization changed it.
  await prisma.contentArticle.update({
    where: { id: article.id },
    data: {
      lastValidatedAt: new Date(),
      ...(run.sanitizedBody !== article.body ? { body: run.sanitizedBody } : {}),
    },
  });

  const result = await prisma.contentValidationResult.create({
    data: {
      articleId: article.id,
      checkResultsJson: JSON.stringify({
        passed: run.passed,
        requiresHumanReview: run.requiresHumanReview,
        layers: run.layers,
      }),
      passed: run.passed || overridden,
      overriddenByAdminId: opts.overriddenByAdminId ?? null,
      overrideReason: opts.overrideReason ?? null,
    },
  });

  return { result, run };
}
