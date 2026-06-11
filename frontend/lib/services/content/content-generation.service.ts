// WO-2 — Content generation orchestration (thin).
//
// Creates a ContentGenerationJob + per-slug items and emits Inngest events; the
// durable work happens in lib/inngest/content-functions.ts. Pause/resume/cancel/
// retry are STATE FLAGS the Inngest function checks — not a competing scheduler.

import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { contentIdentityKey, getSupabase, releaseIdempotencyGuard } from "@/lib/inngest/idempotency";
import { recordWorkflowEvent } from "@/lib/services/content/content-workflow";

export type GenerationOp = "generate" | "regenerate";

export interface EnqueueGenerationParams {
  slugs: string[];
  op?: GenerationOp;
  reviewOnly?: boolean;
  createdByAdminId?: string | null;
  filter?: Record<string, unknown> | null;
}

function eventName(op: GenerationOp): string {
  return op === "regenerate" ? "autolenis/content.regenerate" : "autolenis/content.generate";
}

// Create the job + items and emit one Inngest event per slug.
export async function enqueueGeneration(params: EnqueueGenerationParams) {
  const op = params.op ?? "generate";
  const slugs = [...new Set(params.slugs)].filter(Boolean);
  if (slugs.length === 0) throw new Error("no slugs to enqueue");

  const job = await prisma.contentGenerationJob.create({
    data: {
      status: "QUEUED",
      jobType: op,
      totalItems: slugs.length,
      createdByAdminId: params.createdByAdminId ?? null,
      filterJson: params.filter ? JSON.stringify(params.filter) : null,
      startedAt: new Date(),
      items: {
        create: slugs.map((slug) => ({
          status: "QUEUED",
          idempotencyKey: contentIdentityKey(slug, op),
          targetSlug: slug,
          payloadJson: JSON.stringify({ reviewOnly: params.reviewOnly ?? false }),
        })),
      },
    },
    include: { items: true },
  });

  await inngest.send(
    job.items.map((item) => ({
      name: eventName(op),
      data: {
        slug: item.targetSlug,
        jobId: job.id,
        jobItemId: item.id,
        reviewOnly: params.reviewOnly ?? false,
        regenerate: op === "regenerate",
      },
    })),
  );

  await prisma.contentGenerationJob.update({ where: { id: job.id }, data: { status: "PROCESSING" } });
  await recordWorkflowEvent({
    jobId: job.id,
    eventType: `job.enqueue.${op}`,
    actor: params.createdByAdminId ?? "system",
    payload: { count: slugs.length },
  });

  return job;
}

// Flip QUEUED items to PAUSED so the function bails when they run.
export async function pauseJob(jobId: string, actor: string) {
  await prisma.contentGenerationJobItem.updateMany({
    where: { jobId, status: "QUEUED" },
    data: { status: "PAUSED" },
  });
  await prisma.contentGenerationJob.update({ where: { id: jobId }, data: { status: "PAUSED" } });
  await recordWorkflowEvent({ jobId, eventType: "job.pause", actor });
}

// Re-queue PAUSED items and re-emit their events.
export async function resumeJob(jobId: string, actor: string) {
  const job = await prisma.contentGenerationJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error(`job ${jobId} not found`);
  const items = await prisma.contentGenerationJobItem.findMany({
    where: { jobId, status: "PAUSED" },
  });
  await prisma.contentGenerationJobItem.updateMany({
    where: { jobId, status: "PAUSED" },
    data: { status: "QUEUED" },
  });
  const op = (job.jobType as GenerationOp) ?? "generate";
  if (items.length > 0) {
    await inngest.send(
      items.map((item) => ({
        name: eventName(op),
        data: { slug: item.targetSlug, jobId, jobItemId: item.id, regenerate: op === "regenerate" },
      })),
    );
  }
  await prisma.contentGenerationJob.update({ where: { id: jobId }, data: { status: "PROCESSING" } });
  await recordWorkflowEvent({ jobId, eventType: "job.resume", actor, payload: { requeued: items.length } });
}

// Cancel all not-yet-settled items.
export async function cancelJob(jobId: string, actor: string) {
  await prisma.contentGenerationJobItem.updateMany({
    where: { jobId, status: { in: ["QUEUED", "PAUSED", "PROCESSING"] } },
    data: { status: "CANCELED" },
  });
  await prisma.contentGenerationJob.update({
    where: { id: jobId },
    data: { status: "CANCELED", completedAt: new Date() },
  });
  await recordWorkflowEvent({ jobId, eventType: "job.cancel", actor });
}

// Retry failed items: release the idempotency guard (so the function re-runs),
// re-queue, and re-emit events.
export async function retryFailedItems(jobId: string, actor: string) {
  const job = await prisma.contentGenerationJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error(`job ${jobId} not found`);
  const failed = await prisma.contentGenerationJobItem.findMany({
    where: { jobId, status: "FAILED" },
  });
  if (failed.length === 0) return { requeued: 0 };

  const supabase = getSupabase();
  const op = (job.jobType as GenerationOp) ?? "generate";
  for (const item of failed) {
    await releaseIdempotencyGuard(supabase, item.idempotencyKey);
  }
  await prisma.contentGenerationJobItem.updateMany({
    where: { jobId, status: "FAILED" },
    data: { status: "QUEUED", lastError: null },
  });
  await inngest.send(
    failed.map((item) => ({
      name: eventName(op),
      data: { slug: item.targetSlug, jobId, jobItemId: item.id, regenerate: op === "regenerate" },
    })),
  );
  await prisma.contentGenerationJob.update({ where: { id: jobId }, data: { status: "PROCESSING" } });
  await recordWorkflowEvent({ jobId, eventType: "job.retry_failed", actor, payload: { requeued: failed.length } });
  return { requeued: failed.length };
}
