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
 * seeds in ~36 days with no failures, or ~45 days if the retry quota
 * (CONTENT_SEED_RETRY_QUOTA_FRACTION) is fully claimed every run — 20 new slugs
 * per run instead of 25.
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
  /** Of `enqueued`, slugs never attempted before — this is forward progress. */
  enqueuedNew: number;
  /** Of `enqueued`, previously-attempted slugs being retried (quota-bounded). */
  enqueuedRetry: number;
  /** The ContentGenerationJob created, or null when nothing was enqueued. */
  jobId: string | null;
}

/** Item statuses that mean a slug is already being worked on. */
export const IN_FLIGHT_STATUSES = ["QUEUED", "PROCESSING", "PAUSED"] as const;

/**
 * Share of each batch that previously-attempted (i.e. failed or canceled) slugs
 * may claim while never-attempted slugs remain.
 *
 * Without this bound the seeder STARVES. FAILED is not an in-flight status and a
 * terminally-failed item leaves no ContentArticle row, so neither skip rule
 * excludes it — and because candidates are walked in fixed CONTENT_KEYWORDS
 * order, a deterministically-failing slug returned to the eligible pool every run
 * at its ORIGINAL POSITION. Roughly `maxPerRun` permanent failures near the head
 * of the keyword list would re-fill the entire daily batch forever: 25 Groq calls
 * a day, and a corpus that never advances. Fewer failures still permanently
 * occupied a slot each, decaying throughput.
 *
 * Reserving the rest of the batch for never-attempted slugs makes forward
 * progress unconditional, whatever the failure count, while retries still happen.
 * Retries expand into unused new-slug slots, so when nothing new is left the
 * whole batch is retries.
 */
export const CONTENT_SEED_RETRY_QUOTA_FRACTION = 0.2;

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
 *   4. what remains is partitioned into never-attempted and previously-attempted
 *      (any ContentGenerationJobItem at all means attempted), and the batch is
 *      filled new-first with retries bounded by CONTENT_SEED_RETRY_QUOTA_FRACTION.
 *
 * A settled item (SUCCEEDED/FAILED/CANCELED) does not block a slug: SUCCEEDED
 * always left an article row (rule 2 stops it), while FAILED/CANCELED slugs are
 * genuinely un-generated. Retrying them is the only retry path for a cron-seeded
 * item, since no admin is watching to press "retry failed" — but it is a QUOTA,
 * not a free pass, precisely so a deterministically-failing slug can never crowd
 * out new work (see CONTENT_SEED_RETRY_QUOTA_FRACTION). `enqueuedNew` vs
 * `enqueuedRetry` in the cron-monitor run record is how a growing failure
 * backlog shows up.
 *
 * The retry pool is ordered least-recently-attempted first (per-slug max item
 * `updatedAt`), so the quota rotates through it instead of burning on the same
 * few slugs every run, and no previously-attempted slug is skipped forever.
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
    enqueuedNew: 0,
    enqueuedRetry: 0,
    jobId: null,
  };

  // Short-circuit BEFORE any query: a disabled autopilot costs nothing.
  if (!isContentAutopilotEnabled()) return inert;

  const candidateSlugs = CONTENT_KEYWORDS.map((k) => k.slug);
  const considered = candidateSlugs.length;
  const empty: SeedScheduledGenerationResult = { ...inert, enabled: true, considered };
  // NOTE: `inert` supplies enqueuedNew/enqueuedRetry = 0 for every early return.
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

  // Rules 3 + 4 in ONE probe: every job item for a candidate slug, whatever its
  // status. An in-flight-only filter would hide exactly the settled rows (FAILED,
  // CANCELED) the never-attempted/previously-attempted partition depends on.
  // content_generation_job_items has no index on target_slug, so this is a scan.
  // Deliberately left that way: the table grows ~25 rows/day, so a once-a-day scan
  // stays trivial and an index does not justify a migration.
  //
  // `updatedAt` comes back too — it is what orders the retry pool (below). Newest
  // first, so the row kept per (slug, status) by `distinct` is that pair's most
  // recent one and the per-slug max is the true last-attempt time.
  const items = await prisma.contentGenerationJobItem.findMany({
    where: { targetSlug: { in: candidateSlugs } },
    select: { targetSlug: true, status: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    distinct: ["targetSlug", "status"],
  });
  const inFlightSet: ReadonlySet<string> = new Set(IN_FLIGHT_STATUSES);
  const queued = new Set<string>();
  const attempted = new Set<string>();
  const lastAttemptAt = new Map<string, number>();
  for (const item of items) {
    if (!item.targetSlug) continue;
    attempted.add(item.targetSlug);
    if (inFlightSet.has(item.status)) queued.add(item.targetSlug);
    const at = item.updatedAt.getTime();
    const seen = lastAttemptAt.get(item.targetSlug);
    if (seen === undefined || at > seen) lastAttemptAt.set(item.targetSlug, at);
  }

  let skippedExisting = 0;
  let skippedInFlight = 0;
  const neverAttempted: string[] = [];
  const previouslyAttempted: string[] = [];
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
    (attempted.has(slug) ? previouslyAttempted : neverAttempted).push(slug);
  }

  // Rotate the retry pool: least-recently-attempted first. Without this the pool is
  // walked in keyword order, so the same `retryQuota` slugs are retried every run —
  // ~5 Groq calls a day forever for zero output — while a transient failure deeper
  // in the list is never retried at all, turning a recoverable failure permanent.
  // Ordering by last attempt means a slug that just failed goes to the BACK, so
  // every previously-attempted slug comes up in turn. Sort is stable, so slugs
  // sharing a timestamp keep keyword order.
  previouslyAttempted.sort(
    (a, b) => (lastAttemptAt.get(a) ?? 0) - (lastAttemptAt.get(b) ?? 0),
  );

  // Never-attempted slugs get the batch minus the retry quota, so forward
  // progress is guaranteed however long the failure backlog grows. Each pool then
  // absorbs whatever the other leaves unused: a clean corpus spends the whole cap
  // on new work, and a fully-attempted one spends it all on retries.
  const retryQuota = Math.floor(cap * CONTENT_SEED_RETRY_QUOTA_FRACTION);
  const reservedForRetry = Math.min(previouslyAttempted.length, retryQuota);
  const newSlugs = neverAttempted.slice(0, cap - reservedForRetry);
  const retrySlugs = previouslyAttempted.slice(0, cap - newSlugs.length);
  const slugs = [...newSlugs, ...retrySlugs];
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
    enqueuedNew: newSlugs.length,
    enqueuedRetry: retrySlugs.length,
    jobId: job.id,
  };
}
