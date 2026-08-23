// Unit tests for the content-generation processor — migrated off the Inngest
// content workers onto the internal Vercel-Cron drain. Pins the claim/terminal
// state machine and the parity of the generation → upsert → snapshot → validate →
// finalize pipeline.
//
//   • the status CAS is the single claim (a losing racer → SKIPPED);
//   • happy path: generate → upsert article → snapshot → validate → item SUCCEEDED;
//   • a PUBLISHED draft that fails validation is downgraded to REVIEW_NEEDED;
//   • a transient failure below MAX_ATTEMPTS re-queues (RETRY);
//   • at MAX_ATTEMPTS the item is terminal FAILED — COLUMNS ONLY (no jobs_dead_letter);
//   • a missing ContentKeyword is terminal (NO_KEYWORD);
//   • drain returns NO_QUEUED_ITEMS when empty and aggregates outcomes.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/content/__tests__/content-generation-processor.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Controllable state ───────────────────────────────────────────────────────
let claimCount = 1; // rows the PROCESSING-claim CAS updates (1 = won, 0 = lost)
let finalizeCount = 1; // rows a guarded finalize/terminal/retry updates (0 = canceled mid-flight)
let itemRow: Record<string, unknown> | null = null;
let generateThrows = false;
let generatedStatus = "REVIEW_NEEDED";
let validatePassed = true;
let validateRequiresHuman = false;
let drainCandidates: Array<{ id: string }> = [];
let reconcileItems: Array<{ status: string }> = [];
let dlqInserts = 0;

const calls = {
  claim: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
  itemUpdate: [] as Array<Record<string, unknown>>,
  articleUpdate: [] as Array<Record<string, unknown>>,
  events: [] as string[],
  snapshots: 0,
};

const KEYWORD = {
  slug: "slug-1",
  cluster: "buying-guide",
  make: "Toyota",
  model: "Camry",
  city: "Austin",
  state: "TX",
  metro: "Austin",
  wave: 1,
  targetKeyword: "toyota camry austin",
  title: "T",
  metaDescription: "M",
  h1: "H",
};

mock.module("@/lib/seo/content-keywords", {
  namedExports: { CONTENT_KEYWORDS: [KEYWORD] },
});

mock.module("@/lib/content/generator", {
  namedExports: {
    generateArticle: async () => {
      if (generateThrows) throw new Error("groq exploded");
      return {
        keyword: KEYWORD,
        body: "body",
        faqs: [],
        faqJson: "[]",
        wordCount: 900,
        model: "groq-x",
        attempts: 1,
        compliance: { ok: true },
        quality: { score: 88 },
        status: generatedStatus,
        qualityFlags: "[]",
      };
    },
  },
});

mock.module("@/lib/services/content/content-version.service", {
  namedExports: { snapshot: async () => { calls.snapshots += 1; } },
});

mock.module("@/lib/services/content/content-validation.service", {
  namedExports: {
    validateArticle: async () => ({ run: { passed: validatePassed, requiresHumanReview: validateRequiresHuman } }),
  },
});

mock.module("@/lib/services/content/content-workflow", {
  namedExports: {
    recordWorkflowEvent: async (p: { eventType: string }) => { calls.events.push(p.eventType); },
  },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

// Any write to jobs_dead_letter must NOT happen for content (columns-only terminal).
mock.module("@/lib/jobs/idempotency", {
  namedExports: {
    moveJobToDeadLetter: async () => { dlqInserts += 1; },
    getSupabase: () => ({}),
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      contentGenerationJobItem: {
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: { status?: string } }) => {
          // The PROCESSING-status write is the claim CAS; everything else is a
          // guarded finalize/terminal/retry write (status filter = PROCESSING).
          if (data.status === "PROCESSING") {
            calls.claim.push({ where, data });
            return { count: claimCount };
          }
          calls.itemUpdate.push(data);
          return { count: finalizeCount };
        },
        findUnique: async () => itemRow,
        update: async ({ data }: { data: Record<string, unknown> }) => {
          calls.itemUpdate.push(data);
          return {};
        },
        findMany: async ({ select }: { select?: Record<string, boolean> }) =>
          select && select.id ? drainCandidates : reconcileItems,
      },
      contentGenerationJob: {
        update: async () => ({}),
      },
      contentArticle: {
        upsert: async () => ({ id: "art-1" }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          calls.articleUpdate.push(data);
          return {};
        },
      },
    },
  },
});

async function load() {
  return import("@/lib/services/content/content-generation-processor.service");
}

function baseItem(attempt: number) {
  return {
    id: "item-1",
    jobId: "job-1",
    targetSlug: "slug-1",
    attemptCount: attempt,
    payloadJson: JSON.stringify({ reviewOnly: false }),
    job: { id: "job-1", jobType: "generate" },
  };
}

beforeEach(() => {
  claimCount = 1;
  finalizeCount = 1;
  itemRow = baseItem(1);
  generateThrows = false;
  generatedStatus = "REVIEW_NEEDED";
  validatePassed = true;
  validateRequiresHuman = false;
  drainCandidates = [];
  reconcileItems = [{ status: "SUCCEEDED" }];
  dlqInserts = 0;
  calls.claim = [];
  calls.itemUpdate = [];
  calls.articleUpdate = [];
  calls.events = [];
  calls.snapshots = 0;
});

test("SKIPPED when the claim CAS updates 0 rows (lost the race)", async () => {
  claimCount = 0;
  const { processContentItem } = await load();
  const outcome = await processContentItem("item-1");
  assert.equal(outcome, "SKIPPED");
  assert.equal(calls.itemUpdate.length, 0);
});

test("the claim CAS targets QUEUED-or-stale-PROCESSING and increments attemptCount", async () => {
  const { processContentItem } = await load();
  await processContentItem("item-1");
  assert.equal(calls.claim.length, 1, "exactly one claim attempt");
  const { where, data } = calls.claim[0];
  // Claim must only match QUEUED or a stale PROCESSING row.
  const or = (where as { OR?: Array<Record<string, unknown>> }).OR;
  assert.ok(Array.isArray(or) && or.length === 2, "claim WHERE has the QUEUED/stale-PROCESSING OR");
  assert.equal((or![0] as { status?: string }).status, "QUEUED");
  assert.equal((or![1] as { status?: string }).status, "PROCESSING");
  assert.ok((or![1] as { updatedAt?: { lt?: unknown } }).updatedAt?.lt, "stale branch bounds updatedAt");
  // Claim transitions to PROCESSING and increments the retry counter.
  assert.equal((data as { status?: string }).status, "PROCESSING");
  assert.deepEqual((data as { attemptCount?: unknown }).attemptCount, { increment: 1 });
});

test("a cancel/pause that wins the finalize race yields SKIPPED (item not forced SUCCEEDED)", async () => {
  finalizeCount = 0; // guarded finalize updates 0 rows → item was CANCELED/PAUSED mid-flight
  const { processContentItem } = await load();
  const outcome = await processContentItem("item-1");
  assert.equal(outcome, "SKIPPED");
  // No workflow "content.generate" success event is recorded for a canceled item.
  assert.ok(!calls.events.includes("content.generate"));
});

test("happy path generates, upserts, snapshots, validates, and marks SUCCEEDED", async () => {
  const { processContentItem } = await load();
  const outcome = await processContentItem("item-1");
  assert.equal(outcome, "SUCCESS");
  assert.equal(calls.snapshots, 1);
  const finalize = calls.itemUpdate.find((d) => d.status === "SUCCEEDED");
  assert.ok(finalize, "item marked SUCCEEDED");
  assert.equal(finalize!.articleId, "art-1");
  assert.ok(calls.events.includes("content.generate"));
  assert.equal(dlqInserts, 0);
});

test("a PUBLISHED draft failing validation is downgraded to REVIEW_NEEDED", async () => {
  generatedStatus = "PUBLISHED";
  validatePassed = false;
  const { processContentItem } = await load();
  const outcome = await processContentItem("item-1");
  assert.equal(outcome, "SUCCESS");
  const downgrade = calls.articleUpdate.find((d) => d.status === "REVIEW_NEEDED");
  assert.ok(downgrade, "PUBLISHED article downgraded to REVIEW_NEEDED");
  assert.equal(downgrade!.publishedAt, null);
});

test("a PUBLISHED draft passing validation is NOT downgraded", async () => {
  generatedStatus = "PUBLISHED";
  validatePassed = true;
  validateRequiresHuman = false;
  const { processContentItem } = await load();
  await processContentItem("item-1");
  assert.equal(calls.articleUpdate.find((d) => d.status === "REVIEW_NEEDED"), undefined);
});

test("transient failure below MAX_ATTEMPTS re-queues (RETRY), no dead-letter", async () => {
  generateThrows = true;
  itemRow = baseItem(1); // attempt 1 of 4
  const { processContentItem } = await load();
  const outcome = await processContentItem("item-1");
  assert.equal(outcome, "RETRY");
  const requeue = calls.itemUpdate.find((d) => d.status === "QUEUED");
  assert.ok(requeue, "item re-queued");
  assert.equal(dlqInserts, 0, "no jobs_dead_letter write");
});

test("failure at MAX_ATTEMPTS is terminal FAILED, COLUMNS-ONLY (no jobs_dead_letter)", async () => {
  generateThrows = true;
  const mod = await load();
  itemRow = baseItem(mod.MAX_CONTENT_ATTEMPTS); // attempt == MAX
  const outcome = await mod.processContentItem("item-1");
  assert.equal(outcome, "DEAD_LETTERED");
  const failed = calls.itemUpdate.find((d) => d.status === "FAILED");
  assert.ok(failed, "item marked FAILED");
  assert.equal(dlqInserts, 0, "terminal state is columns-only, nothing to jobs_dead_letter");
  assert.ok(calls.events.some((e) => e.endsWith(".dead_letter")));
});

test("a missing ContentKeyword is terminal (NO_KEYWORD)", async () => {
  itemRow = { ...baseItem(1), targetSlug: "does-not-exist" };
  const { processContentItem } = await load();
  const outcome = await processContentItem("item-1");
  assert.equal(outcome, "NO_KEYWORD");
  const failed = calls.itemUpdate.find((d) => d.status === "FAILED");
  assert.ok(failed);
  assert.equal(dlqInserts, 0);
});

test("drain returns NO_QUEUED_ITEMS when the queue is empty", async () => {
  drainCandidates = [];
  const { drainContentGenerationQueue } = await load();
  const summary = await drainContentGenerationQueue();
  assert.equal(summary.status, "NO_QUEUED_ITEMS");
  assert.equal(summary.claimed, 0);
});

test("drain processes candidates and aggregates the summary", async () => {
  drainCandidates = [{ id: "item-1" }];
  const { drainContentGenerationQueue } = await load();
  const summary = await drainContentGenerationQueue();
  assert.equal(summary.status, "OK");
  assert.equal(summary.succeeded, 1);
  assert.equal(summary.claimed, 1);
});
