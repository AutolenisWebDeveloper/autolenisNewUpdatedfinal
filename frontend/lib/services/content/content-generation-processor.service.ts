// Content generation processor — internal Vercel-Cron substrate (migrated off the
// retired Inngest `contentGenerateFn` / `contentRegenerateFn`).
//
// The ContentGenerationJobItem table IS the durable queue: an item's `status`
// (QUEUED → PROCESSING → SUCCEEDED/FAILED, plus admin PAUSED/CANCELED) is the
// single claim + terminal mechanism, so there is NO second queue/DLQ and no
// Inngest dependency. Concurrency and crash-recovery are provided by a Postgres
// compare-and-set on the row status:
//   • QUEUED → PROCESSING is claimed by exactly one drain (the UPDATE re-checks
//     its WHERE on the locked row, so a losing racer updates 0 rows);
//   • a PROCESSING row whose updatedAt is older than STALE_MS (> the cron's
//     maxDuration) is reclaimable, so a run killed mid-generation is re-driven;
//   • attemptCount bounds retries; at MAX_ATTEMPTS the item is marked FAILED
//     (terminal COLUMNS-ONLY — nothing is written to jobs_dead_letter, so the
//     Inngest-based DLQ drainer can NEVER re-emit a content job). Admin
//     `retryFailedItems` re-queues FAILED items (the replay path).
//
// Business logic (generation, versioning, validation) is unchanged — it calls the
// SAME generator/version/validation services the Inngest worker called. Content
// has no external (email/SMS/dealer) side effects, so a redundant generation is at
// worst wasted Groq work, never a duplicate production communication; the article
// upsert is keyed on the unique slug, so any retry/overlap converges to one row.

import type { ArticleStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { CONTENT_KEYWORDS, type ContentKeyword } from "@/lib/seo/content-keywords";
import { generateArticle, type GeneratedArticle } from "@/lib/content/generator";
import { snapshot } from "@/lib/services/content/content-version.service";
import { validateArticle } from "@/lib/services/content/content-validation.service";
import { recordWorkflowEvent } from "@/lib/services/content/content-workflow";

// Retries before a REQUIRED failure is terminal. Matches the retired worker's
// `retries: 3` (Inngest attempt 0..3 = up to 4 tries → we bound at 4 attempts).
export const MAX_CONTENT_ATTEMPTS = 4;

// A PROCESSING row older than this is treated as abandoned (a prior drain died
// mid-generation) and is reclaimable. MUST exceed the drain route's maxDuration
// (300s) so a live run is never reclaimed underneath itself.
const STALE_MS = 15 * 60 * 1000;

// Items processed per drain tick. Each item is a long Groq call, so the batch is
// sized to finish within the route's maxDuration (300s). Because the cron runs
// every 2 min and maxDuration (300s) exceeds the 120s interval, invocations can
// overlap and the STALE_MS guard keeps them working on DISJOINT items — so the
// effective throughput is several items concurrently, restoring the retired
// worker's `concurrency: 5` ballpark. NOTE: a bulk `filter` regeneration can
// enqueue up to ~5000 slugs (admin generate route); at ~10 items / 2 min that
// backlog drains over hours, not the instant Inngest fan-out — the job stays
// PROCESSING until the drain works through it (this is eventual, not stuck).
export const CONTENT_DRAIN_BATCH = 10;

export type GenerationOp = "generate" | "regenerate";

export type ContentItemOutcome =
  | "SUCCESS"
  | "SKIPPED" // lost the claim race / no longer eligible
  | "RETRY" // failed this attempt, re-queued for a later drain
  | "DEAD_LETTERED" // failed at MAX_ATTEMPTS → terminal FAILED (columns-only)
  | "NO_KEYWORD"; // slug has no ContentKeyword → terminal FAILED

export interface ContentDrainSummary {
  status: "OK" | "NO_QUEUED_ITEMS";
  claimed: number;
  succeeded: number;
  retried: number;
  deadLettered: number;
  skipped: number;
}

function buildArticleData(keyword: ContentKeyword, generated: GeneratedArticle) {
  const publishedAt = generated.status === "PUBLISHED" ? new Date() : null;
  return {
    cluster: keyword.cluster,
    make: keyword.make ?? null,
    model: keyword.model ?? null,
    city: keyword.city,
    state: keyword.state,
    metro: keyword.metro,
    wave: keyword.wave,
    targetKeyword: keyword.targetKeyword,
    title: keyword.title,
    metaDescription: keyword.metaDescription,
    h1: keyword.h1,
    body: generated.body,
    faqJson: generated.faqJson,
    wordCount: generated.wordCount,
    authorSlug: "markist",
    status: generated.status,
    qualityScore: generated.quality.score,
    qualityFlags: generated.qualityFlags,
    generatedAt: new Date(),
    groqModel: generated.model,
    searchGrounded: false,
    publishedAt,
  };
}

// Recompute a job's aggregate counters + status from its items. Cheap and
// race-free vs. incrementing counters from concurrent item drains.
async function reconcileJob(jobId: string): Promise<void> {
  const items = await prisma.contentGenerationJobItem.findMany({
    where: { jobId },
    select: { status: true },
  });
  const total = items.length;
  const succeeded = items.filter((i) => i.status === "SUCCEEDED").length;
  const failed = items.filter((i) => i.status === "FAILED").length;
  const canceled = items.filter((i) => i.status === "CANCELED").length;
  const settled = succeeded + failed + canceled;
  const allDone = settled >= total && total > 0;
  await prisma.contentGenerationJob.update({
    where: { id: jobId },
    data: {
      totalItems: total,
      succeededItems: succeeded,
      failedItems: failed,
      status: allDone ? (failed > 0 ? "FAILED" : "SUCCEEDED") : "PROCESSING",
      ...(allDone ? { completedAt: new Date() } : {}),
    },
  });
}

// Claim + process a single item by id. Returns the typed outcome. Safe to call
// concurrently: the status CAS guarantees at most one drain does the work.
export async function processContentItem(itemId: string): Promise<ContentItemOutcome> {
  const staleCutoff = new Date(Date.now() - STALE_MS);

  // Atomic claim: QUEUED, or a stale PROCESSING row (previous drain died). The
  // UPDATE re-evaluates its predicate on the locked row, so a racing drain that
  // reaches an already-claimed row updates 0 rows and backs off.
  const claim = await prisma.contentGenerationJobItem.updateMany({
    where: {
      id: itemId,
      OR: [{ status: "QUEUED" }, { status: "PROCESSING", updatedAt: { lt: staleCutoff } }],
    },
    data: { status: "PROCESSING", attemptCount: { increment: 1 } },
  });
  if (claim.count === 0) return "SKIPPED";

  const item = await prisma.contentGenerationJobItem.findUnique({
    where: { id: itemId },
    include: { job: { select: { id: true, jobType: true } } },
  });
  if (!item || !item.targetSlug) {
    // Missing slug can never generate — terminal (guarded so a concurrent cancel wins).
    await prisma.contentGenerationJobItem.updateMany({
      where: { id: itemId, status: "PROCESSING" },
      data: { status: "FAILED", lastError: "missing target slug" },
    });
    if (item?.jobId) await reconcileJob(item.jobId);
    return "NO_KEYWORD";
  }

  const op: GenerationOp = item.job.jobType === "regenerate" ? "regenerate" : "generate";
  const slug = item.targetSlug;
  const reviewOnly = parseReviewOnly(item.payloadJson);
  const attempt = item.attemptCount;

  try {
    const keyword = CONTENT_KEYWORDS.find((k) => k.slug === slug);
    if (!keyword) {
      // A permanently-missing keyword is terminal — do not retry (guarded so a
      // concurrent cancel wins).
      await prisma.contentGenerationJobItem.updateMany({
        where: { id: itemId, status: "PROCESSING" },
        data: { status: "FAILED", lastError: `no ContentKeyword for slug ${slug}` },
      });
      await reconcileJob(item.jobId);
      return "NO_KEYWORD";
    }

    const generated = await generateArticle(keyword, { reviewOnly });

    const article = await prisma.contentArticle.upsert({
      where: { slug: keyword.slug },
      create: { slug: keyword.slug, ...buildArticleData(keyword, generated) },
      update: buildArticleData(keyword, generated),
      select: { id: true },
    });
    const articleId = article.id;

    await snapshot(articleId, {
      reason: op,
      actor: "cron",
      createdByJobId: item.jobId,
      generatedByModel: generated.model,
      complianceResultJson: JSON.stringify(generated.compliance),
    });

    // Validate + gate auto-publish: a PUBLISHED draft is downgraded to
    // REVIEW_NEEDED if validation fails a required layer or flags fact-risk.
    const { run } = await validateArticle(articleId);
    if (generated.status === "PUBLISHED" && (!run.passed || run.requiresHumanReview)) {
      await prisma.contentArticle.update({
        where: { id: articleId },
        data: { status: "REVIEW_NEEDED" as ArticleStatus, publishedAt: null },
      });
    }

    // Guarded finalize: only transition an item that is STILL PROCESSING. If an
    // admin `cancelJob`/`pauseJob` flipped it mid-generation (PROCESSING→CANCELED/
    // PAUSED), this updates 0 rows and we respect that terminal admin action (the
    // article was already upserted — harmless; the item keeps its new status).
    const finalized = await prisma.contentGenerationJobItem.updateMany({
      where: { id: itemId, status: "PROCESSING" },
      data: { status: "SUCCEEDED", articleId, lastError: null },
    });
    await reconcileJob(item.jobId);
    if (finalized.count === 0) return "SKIPPED";

    await recordWorkflowEvent({
      articleId,
      jobId: item.jobId,
      eventType: `content.${op}`,
      actor: "cron",
      payload: { slug, status: generated.status },
    });

    return "SUCCESS";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (attempt >= MAX_CONTENT_ATTEMPTS) {
      // Terminal — COLUMNS-ONLY (item.status = FAILED). Nothing is written to
      // jobs_dead_letter, so the Inngest DLQ drainer can never re-emit this.
      // Guarded so a concurrent cancel/pause still wins.
      const failed = await prisma.contentGenerationJobItem.updateMany({
        where: { id: itemId, status: "PROCESSING" },
        data: { status: "FAILED", lastError: message },
      });
      await reconcileJob(item.jobId);
      if (failed.count === 0) return "SKIPPED";
      await recordWorkflowEvent({
        jobId: item.jobId,
        eventType: `content.${op}.dead_letter`,
        actor: "cron",
        payload: { slug, attempts: attempt, error: message.slice(0, 500) },
      });
      logger.error(`[content-drain] item ${itemId} dead-lettered after ${attempt} attempts`, message);
      return "DEAD_LETTERED";
    }
    // Re-queue for a later drain tick — guarded so a concurrent cancel/pause wins.
    const requeued = await prisma.contentGenerationJobItem.updateMany({
      where: { id: itemId, status: "PROCESSING" },
      data: { status: "QUEUED", lastError: message },
    });
    if (requeued.count === 0) return "SKIPPED";
    logger.warn(`[content-drain] item ${itemId} attempt ${attempt} failed, re-queued`, message);
    return "RETRY";
  }
}

// Drain a bounded batch of pending content-generation items. Selects QUEUED
// items and reclaimable stale PROCESSING items, oldest first, and processes each.
export async function drainContentGenerationQueue(
  batchSize: number = CONTENT_DRAIN_BATCH,
): Promise<ContentDrainSummary> {
  const staleCutoff = new Date(Date.now() - STALE_MS);
  const candidates = await prisma.contentGenerationJobItem.findMany({
    where: {
      OR: [{ status: "QUEUED" }, { status: "PROCESSING", updatedAt: { lt: staleCutoff } }],
    },
    orderBy: { createdAt: "asc" },
    take: batchSize,
    select: { id: true },
  });

  if (candidates.length === 0) {
    return { status: "NO_QUEUED_ITEMS", claimed: 0, succeeded: 0, retried: 0, deadLettered: 0, skipped: 0 };
  }

  let succeeded = 0;
  let retried = 0;
  let deadLettered = 0;
  let skipped = 0;
  for (const c of candidates) {
    let outcome: ContentItemOutcome;
    try {
      outcome = await processContentItem(c.id);
    } catch (err) {
      // processContentItem is defensive, but never let one item abort the batch.
      logger.error(`[content-drain] unexpected error processing item ${c.id}`, err);
      skipped += 1;
      continue;
    }
    switch (outcome) {
      case "SUCCESS":
        succeeded += 1;
        break;
      case "RETRY":
        retried += 1;
        break;
      case "DEAD_LETTERED":
      case "NO_KEYWORD":
        deadLettered += 1;
        break;
      case "SKIPPED":
        skipped += 1;
        break;
    }
  }

  return {
    status: "OK",
    claimed: succeeded + retried + deadLettered,
    succeeded,
    retried,
    deadLettered,
    skipped,
  };
}

function parseReviewOnly(payloadJson: string | null): boolean {
  if (!payloadJson) return false;
  try {
    const parsed = JSON.parse(payloadJson) as { reviewOnly?: boolean };
    return parsed.reviewOnly ?? false;
  } catch {
    return false;
  }
}
