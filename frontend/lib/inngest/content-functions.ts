// WO-2 — Content generation as durable Inngest functions.
//
// Long-running content work (generate / regenerate) runs here so it inherits
// Inngest's locking, retry/backoff, and concurrency. Each run:
//   1. acquires the shared idempotency_keys guard on the content identity (slug),
//   2. runs the existing generator.ts (no generation logic is re-implemented),
//   3. UPSERTS ContentArticle by unique slug (a retry converges, never dups),
//   4. snapshots a ContentArticleVersion,
//   5. runs the layered validation service and gates auto-publish on it,
//   6. updates the ContentGenerationJobItem + job aggregate,
//   7. on final failure, dead-letters via the shared jobs_dead_letter table.
//
// These are NEW functions; the existing messaging functions in functions.ts are
// untouched. They are served alongside them from app/api/inngest/route.ts.

import type { ArticleStatus } from "@prisma/client";

import { inngest } from "@/lib/inngest/client";
import {
  getSupabase,
  acquireIdempotencyGuard,
  updateIdempotencyState,
  moveJobToDeadLetter,
  isFinalAttempt,
  contentIdentityKey,
} from "@/lib/inngest/idempotency";
import { prisma } from "@/lib/prisma";
import { CONTENT_KEYWORDS, type ContentKeyword } from "@/lib/seo/content-keywords";
import { generateArticle, type GeneratedArticle } from "@/lib/content/generator";
import { snapshot } from "@/lib/services/content/content-version.service";
import { validateArticle } from "@/lib/services/content/content-validation.service";
import { recordWorkflowEvent } from "@/lib/services/content/content-workflow";

interface ContentGenerateEvent {
  slug: string;
  jobId?: string;
  jobItemId?: string;
  reviewOnly?: boolean;
  regenerate?: boolean;
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
// race-free vs. incrementing counters from concurrent item workers.
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

interface StepTools {
  run<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

async function runContentGeneration(
  ctx: { event: { data: ContentGenerateEvent }; step: StepTools; runId?: string },
  op: "generate" | "regenerate",
) {
  const { event, step } = ctx;
  const data = event.data;
  const supabase = getSupabase();
  const key = contentIdentityKey(data.slug, op);

  const proceed = await step.run("evaluate-idempotency", async () =>
    acquireIdempotencyGuard(supabase, key),
  );
  if (!proceed) return { status: "DUPLICATE_BLOCKED", slug: data.slug };

  if (data.jobItemId) {
    const skip = await step.run("mark-processing", async () => {
      const item = await prisma.contentGenerationJobItem.findUnique({
        where: { id: data.jobItemId },
        select: { status: true },
      });
      // Honor admin pause/cancel: these are state flags the function checks
      // rather than a custom scheduler. A CANCELED/PAUSED item bails out.
      if (item && (item.status === "CANCELED" || item.status === "PAUSED")) {
        return true;
      }
      await prisma.contentGenerationJobItem.update({
        where: { id: data.jobItemId },
        data: {
          status: "PROCESSING",
          inngestRunId: ctx.runId ?? null,
          attemptCount: { increment: 1 },
        },
      });
      return false;
    });
    if (skip) return { status: "SKIPPED", slug: data.slug };
  }

  try {
    const keyword = CONTENT_KEYWORDS.find((k) => k.slug === data.slug);
    if (!keyword) throw new Error(`no ContentKeyword for slug ${data.slug}`);

    // Generation (Groq) — memoized by step so retries don't re-bill the model
    // once a draft succeeds.
    const generated = await step.run("generate", async () =>
      generateArticle(keyword, { reviewOnly: data.reviewOnly ?? false }),
    );

    const articleId = await step.run("upsert-article", async () => {
      const row = await prisma.contentArticle.upsert({
        where: { slug: keyword.slug },
        create: { slug: keyword.slug, ...buildArticleData(keyword, generated) },
        update: buildArticleData(keyword, generated),
        select: { id: true },
      });
      return row.id;
    });

    await step.run("snapshot-version", async () => {
      await snapshot(articleId, {
        reason: op,
        actor: "inngest",
        createdByJobId: data.jobId ?? null,
        generatedByModel: generated.model,
        complianceResultJson: JSON.stringify(generated.compliance),
      });
    });

    // Validate + gate auto-publish: a PUBLISHED draft is downgraded to
    // REVIEW_NEEDED if validation fails a required layer or flags fact-risk.
    await step.run("validate", async () => {
      const { run } = await validateArticle(articleId);
      if (
        generated.status === "PUBLISHED" &&
        (!run.passed || run.requiresHumanReview)
      ) {
        await prisma.contentArticle.update({
          where: { id: articleId },
          data: { status: "REVIEW_NEEDED" as ArticleStatus, publishedAt: null },
        });
      }
    });

    if (data.jobItemId) {
      await step.run("finalize-item", async () => {
        await prisma.contentGenerationJobItem.update({
          where: { id: data.jobItemId },
          data: { status: "SUCCEEDED", articleId, lastError: null },
        });
        if (data.jobId) await reconcileJob(data.jobId);
      });
    }

    await step.run("record-event", async () => {
      await recordWorkflowEvent({
        articleId,
        jobId: data.jobId ?? null,
        eventType: `content.${op}`,
        actor: "inngest",
        payload: { slug: data.slug, status: generated.status },
      });
    });

    await updateIdempotencyState(supabase, key, "completed", { articleId });
    return { status: "SUCCESS", articleId, slug: data.slug };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateIdempotencyState(supabase, key, "failed", { error: message });

    if (isFinalAttempt(ctx as unknown as Record<string, unknown>)) {
      if (data.jobItemId) {
        await prisma.contentGenerationJobItem.update({
          where: { id: data.jobItemId },
          data: { status: "FAILED", lastError: message },
        });
        if (data.jobId) await reconcileJob(data.jobId);
      }
      await moveJobToDeadLetter(
        supabase,
        ctx.runId ?? "unknown",
        `autolenis/content.${op}`,
        data,
        message,
      );
    }
    throw err;
  }
}

export const contentGenerateFn = inngest.createFunction(
  { id: "content-generate-worker", name: "Content Generation", retries: 3, concurrency: 5 },
  { event: "autolenis/content.generate" },
  async (ctx) => runContentGeneration(ctx as never, "generate"),
);

export const contentRegenerateFn = inngest.createFunction(
  { id: "content-regenerate-worker", name: "Content Regeneration", retries: 3, concurrency: 5 },
  { event: "autolenis/content.regenerate" },
  async (ctx) => runContentGeneration(ctx as never, "regenerate"),
);

export const contentFunctions = [contentGenerateFn, contentRegenerateFn];
