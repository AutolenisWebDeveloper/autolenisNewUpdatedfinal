// WO-2 — Content generation orchestration (thin).
//
// Creates a ContentGenerationJob + per-slug items in the QUEUED state; the durable
// work happens on the internal Vercel-Cron substrate
// (app/api/cron/content-generation-drain → drainContentGenerationQueue). The
// ContentGenerationJobItem status IS the queue, so this module only writes rows —
// there is no Inngest event and no competing scheduler. Pause/resume/cancel/retry
// are STATE FLAGS the drain honors via the item status.

import { prisma } from "@/lib/prisma";
import { recordWorkflowEvent } from "@/lib/services/content/content-workflow";

export type GenerationOp = "generate" | "regenerate";

// Stable per-item identity key (audit column on ContentGenerationJobItem). Derived
// from the slug (itself cluster+city+state+make+model+wave), so a re-enqueue of the
// same slug+op keeps a stable key. Inlined so content no longer imports lib/inngest.
function contentIdentityKey(slug: string, op: GenerationOp): string {
  return `content:${op}:${slug}`;
}

export interface EnqueueGenerationParams {
  slugs: string[];
  op?: GenerationOp;
  reviewOnly?: boolean;
  createdByAdminId?: string | null;
  filter?: Record<string, unknown> | null;
}

// Create the job + items in QUEUED; the content-generation-drain cron picks them up.
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

  // Items are QUEUED; the content-generation-drain cron claims and processes
  // them. Flip the job to PROCESSING so the admin UI reflects in-flight state
  // (reconcileJob settles it as items complete).
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

// Re-queue PAUSED items — the drain picks them up on its next tick.
export async function resumeJob(jobId: string, actor: string) {
  const job = await prisma.contentGenerationJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error(`job ${jobId} not found`);
  const requeued = await prisma.contentGenerationJobItem.updateMany({
    where: { jobId, status: "PAUSED" },
    data: { status: "QUEUED" },
  });
  await prisma.contentGenerationJob.update({ where: { id: jobId }, data: { status: "PROCESSING" } });
  await recordWorkflowEvent({ jobId, eventType: "job.resume", actor, payload: { requeued: requeued.count } });
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

// Retry failed items: re-queue them (reset attemptCount so the bounded-retry
// budget starts fresh) — the drain re-drives them on its next tick. This is the
// replay path for the columns-only terminal state (item.status = FAILED); no
// jobs_dead_letter row is involved, so nothing here depends on Inngest.
export async function retryFailedItems(jobId: string, actor: string) {
  const job = await prisma.contentGenerationJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error(`job ${jobId} not found`);
  const requeued = await prisma.contentGenerationJobItem.updateMany({
    where: { jobId, status: "FAILED" },
    data: { status: "QUEUED", lastError: null, attemptCount: 0 },
  });
  if (requeued.count === 0) return { requeued: 0 };

  await prisma.contentGenerationJob.update({ where: { id: jobId }, data: { status: "PROCESSING" } });
  await recordWorkflowEvent({ jobId, eventType: "job.retry_failed", actor, payload: { requeued: requeued.count } });
  return { requeued: requeued.count };
}
