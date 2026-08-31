// WO-2 — Content generation orchestration (thin).
//
// Creates a ContentGenerationJob + per-slug items in the QUEUED state; the durable
// work happens on the internal Vercel-Cron substrate
// (app/api/cron/content-generation-drain → drainContentGenerationQueue). The
// ContentGenerationJobItem status IS the queue, so this module only writes rows —
// there is no Inngest event and no competing scheduler. Pause/resume/cancel/retry
// are STATE FLAGS the drain honors via the item status.

import { prisma } from "@/lib/prisma";
import { CONTENT_KEYWORDS } from "@/lib/seo/content-keywords";
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

// ─── Content Autopilot: scheduled, unattended generation ─────────────────────
//
// Everything downstream of `enqueueGeneration` was already autonomous — the
// content-generation-drain cron (*/2 min) claims QUEUED items, generates, scores
// against the quality rubric + compliance validator, and the post-generation
// validation gate downgrades anything that fails to REVIEW_NEEDED. What was
// missing was the TRIGGER: `enqueueGeneration` had exactly one caller (the admin
// generate route), so the drain was draining a queue nothing filled. This seeder
// is that trigger, invoked once a day by app/api/cron/content-generation-seed.
//
// It adds no new state, no new table, and no new decision about what gets
// published: it only chooses which slugs to enqueue and hands them to the SAME
// `enqueueGeneration` the admin route uses.

/**
 * Env var name — one string shared by the code, the tests, and the runbook.
 * @see isContentAutopilotEnabled
 */
export const CONTENT_AUTOPILOT_FLAG = "CONTENT_AUTOPILOT_ENABLED";

/**
 * KILL SWITCH — default OFF, and deliberately strict.
 *
 * Merging and deploying the autopilot must NOT start publishing to the public
 * site. The owner turns it on by setting CONTENT_AUTOPILOT_ENABLED=true in the
 * Vercel project, and off by unsetting it — no deploy either way, because the
 * value is read at CALL time, never at module load. An unset, empty, "1" or
 * "TRUE" value all read as disabled, so the gate can only be opened
 * deliberately. Follows the established CRM_INAPP_ENGINE_ENABLED /
 * ESIGN_EXECUTED_ARTIFACT_ENABLED cutover-flag pattern.
 */
export function isContentAutopilotEnabled(): boolean {
  return process.env[CONTENT_AUTOPILOT_FLAG] === "true";
}

/**
 * Items enqueued per scheduled run. **EACH ITEM IS EXACTLY ONE GROQ GENERATION**
 * (content-generation-processor.service → generateArticle), so raising this
 * raises Groq spend LINEARLY: 25 items/day is 25 generations/day. 25 is the
 * batch size scripts/generate-articles.ts already chose as "cheap and
 * reviewable"; CONTENT_KEYWORDS holds 900 slugs, so at this cap a full corpus
 * seeds over ~36 days.
 */
export const CONTENT_SEED_MAX_PER_RUN = 25;

/**
 * The vercel.json schedule for /api/cron/content-generation-seed — ONE RUN PER
 * DAY at 08:00 UTC. Declared here so the cap and the cadence (the two numbers
 * that together set the spend rate: 25 × 1/day) sit side by side; a test pins
 * this against the vercel.json entry so the two can never drift apart.
 */
export const CONTENT_SEED_SCHEDULE = "0 8 * * *";

export interface SeedScheduledGenerationResult {
  /** False when the kill switch is off — nothing was read or written. */
  enabled: boolean;
  /** Candidate slugs examined (the whole keyword database). */
  considered: number;
  /** Skipped because a ContentArticle row already exists. */
  skippedExisting: number;
  /** Skipped because a QUEUED/PROCESSING/PAUSED job item is already in flight. */
  skippedInFlight: number;
  /** Slugs actually enqueued this run (never more than maxPerRun). */
  enqueued: number;
  /** The ContentGenerationJob created, or null when nothing was enqueued. */
  jobId: string | null;
}

/** Item statuses that mean a slug is already being worked on. */
const IN_FLIGHT_STATUSES = ["QUEUED", "PROCESSING", "PAUSED"] as const;

/**
 * Seed a day's worth of article generation from the keyword database.
 *
 * Selection, in order:
 *   1. every slug in CONTENT_KEYWORDS;
 *   2. minus slugs that already have a ContentArticle row — the same rule
 *      scripts/generate-articles.ts:98-109 applies (a generated-but-unpublished
 *      article, e.g. one the validation gate held at REVIEW_NEEDED, HAS a row and
 *      is therefore never silently regenerated by this cron);
 *   3. minus slugs with an in-flight ContentGenerationJobItem. The CLI has no
 *      such rule because it is one-shot; a REPEATING cron needs it, or every run
 *      re-enqueues the slugs the previous run left in the queue and burns Groq
 *      budget on duplicate work;
 *   4. capped at maxPerRun.
 *
 * A settled item (SUCCEEDED/FAILED/CANCELED) does not block a slug: SUCCEEDED
 * always left an article row (rule 2 stops it), while FAILED/CANCELED slugs are
 * genuinely un-generated and are meant to be re-attempted on a later day — that
 * is the only retry path for a cron-seeded item, since no admin is watching to
 * press "retry failed". A slug whose generation throws deterministically will
 * therefore be re-attempted daily; `considered`/`skippedExisting`/`enqueued` in
 * the cron-monitor run record are what make that visible.
 *
 * Concurrency: two overlapping seed runs could both read "not in flight" and
 * enqueue the same slugs, costing a duplicate generation each. The window is the
 * few milliseconds between the in-flight probe and the nested item insert, the
 * schedule is once a day, and the drain's article upsert is keyed on the unique
 * slug — so the worst case is redundant Groq work, never a duplicate article.
 * This is the same trade-off content-generation-processor.service already makes.
 *
 * `createdByAdminId` is null and the workflow event records actor "system" —
 * the correct audit trail for an unattended cron, not a fabricated admin.
 */
export async function seedScheduledGeneration(
  maxPerRun: number = CONTENT_SEED_MAX_PER_RUN,
): Promise<SeedScheduledGenerationResult> {
  const inert: SeedScheduledGenerationResult = {
    enabled: false,
    considered: 0,
    skippedExisting: 0,
    skippedInFlight: 0,
    enqueued: 0,
    jobId: null,
  };

  // Short-circuit BEFORE any query: a disabled autopilot costs nothing.
  if (!isContentAutopilotEnabled()) return inert;

  const candidateSlugs = CONTENT_KEYWORDS.map((k) => k.slug);
  const considered = candidateSlugs.length;
  const empty: SeedScheduledGenerationResult = { ...inert, enabled: true, considered };
  // A non-finite or negative cap is clamped to 0 — a spend cap must fail toward
  // spending nothing, explicitly rather than by accident.
  const cap = Number.isFinite(maxPerRun) ? Math.max(0, Math.trunc(maxPerRun)) : 0;
  if (considered === 0 || cap === 0) return empty;

  // Rule 2 — reuse the CLI's shape (scripts/generate-articles.ts:103-107).
  const existing = await prisma.contentArticle.findMany({
    where: { slug: { in: candidateSlugs } },
    select: { slug: true },
  });
  const haveArticle = new Set(existing.map((e) => e.slug));

  // Rule 3 — the check the one-shot CLI does not need.
  const inFlight = await prisma.contentGenerationJobItem.findMany({
    where: {
      targetSlug: { in: candidateSlugs },
      status: { in: [...IN_FLIGHT_STATUSES] },
    },
    select: { targetSlug: true },
  });
  const queued = new Set(inFlight.map((i) => i.targetSlug).filter((s): s is string => !!s));

  let skippedExisting = 0;
  let skippedInFlight = 0;
  const eligible: string[] = [];
  for (const slug of candidateSlugs) {
    // Checked in order so a slug matching both rules is counted exactly once.
    if (haveArticle.has(slug)) {
      skippedExisting += 1;
      continue;
    }
    if (queued.has(slug)) {
      skippedInFlight += 1;
      continue;
    }
    eligible.push(slug);
  }

  const slugs = eligible.slice(0, cap);
  // `enqueueGeneration` throws on an empty batch; a fully-seeded corpus is a
  // normal quiet run, not an error, and must not leave an empty job row behind.
  if (slugs.length === 0) {
    return { ...empty, skippedExisting, skippedInFlight };
  }

  const job = await enqueueGeneration({
    slugs,
    op: "generate",
    // Owner decision: FULL AUTO-PUBLISH. Articles that clear compliance, the
    // quality rubric and post-generation validation go live at
    // /buying-guide/[slug] with no review gate. Pinned by a test so any later
    // change to this is deliberate.
    reviewOnly: false,
    createdByAdminId: null,
    filter: null,
  });

  return {
    enabled: true,
    considered,
    skippedExisting,
    skippedInFlight,
    // The count actually PERSISTED, not the count we asked for — enqueueGeneration
    // de-duplicates its input, so this is the honest number for the run record.
    enqueued: job.items.length,
    jobId: job.id,
  };
}
