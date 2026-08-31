// Content Autopilot — unit tests for the scheduled generation seeder.
//
// `enqueueGeneration` previously had exactly ONE caller (the admin generate
// route), so the content-generation-drain cron was draining a queue nothing
// filled. `seedScheduledGeneration` is the missing trigger. These tests pin the
// behaviour that keeps an unattended, repeating cron from burning Groq budget or
// publishing when the owner has not asked it to:
//
//   • the kill switch is DEFAULT OFF and short-circuits before any DB read;
//   • slugs that already have a ContentArticle are skipped (the CLI's rule);
//   • slugs with an in-flight job item (QUEUED/PROCESSING/PAUSED) are skipped —
//     the CLI has no such rule because it is one-shot, a daily cron needs it;
//   • the per-run cap is never exceeded (each item is one Groq generation);
//   • enqueue is reviewOnly:false — the owner's FULL AUTO-PUBLISH decision, pinned
//     here so a later change to it has to be deliberate;
//   • re-running with no drain in between enqueues nothing the second time.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/content/__tests__/content-generation-seed.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Controllable state ───────────────────────────────────────────────────────
let keywords: Array<{ slug: string }> = [];
let articleRows: Array<{ slug: string }> = [];
// In-memory stand-in for content_generation_job_items. `contentGenerationJob.create`
// appends to it exactly like the nested write does, so a second seed run in the
// same test observes the first run's QUEUED items — the real "no drain in
// between" scenario.
let itemRows: Array<{
  targetSlug: string | null;
  status: string;
  payloadJson: string;
  updatedAt: Date;
}> = [];

// Fixed clock so "least recently attempted" is deterministic in tests.
const T0 = new Date("2026-01-01T00:00:00Z").getTime();
const at = (minutes: number) => new Date(T0 + minutes * 60_000);
let clock = 10_000; // minutes; advanced when a run writes new items

const calls = {
  jobCreate: [] as Array<Record<string, unknown>>,
  articleWhere: [] as Array<Record<string, unknown>>,
  itemWhere: [] as Array<Record<string, unknown>>,
  itemOrderBy: [] as Array<unknown>,
  events: [] as Array<{ eventType: string; actor: string }>,
};

mock.module("@/lib/seo/content-keywords", {
  namedExports: {
    get CONTENT_KEYWORDS() {
      return keywords;
    },
  },
});

mock.module("@/lib/services/content/content-workflow", {
  namedExports: {
    recordWorkflowEvent: async (p: { eventType: string; actor: string }) => {
      calls.events.push({ eventType: p.eventType, actor: p.actor });
    },
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      contentArticle: {
        findMany: async ({ where }: { where: { slug?: { in?: string[] } } }) => {
          calls.articleWhere.push(where);
          const wanted = new Set(where.slug?.in ?? []);
          return articleRows.filter((a) => wanted.has(a.slug)).map((a) => ({ slug: a.slug }));
        },
      },
      contentGenerationJobItem: {
        findMany: async ({
          where,
          orderBy,
        }: {
          where: { targetSlug?: { in?: string[] } };
          orderBy?: { updatedAt?: "asc" | "desc" };
        }) => {
          calls.itemWhere.push(where);
          calls.itemOrderBy.push(orderBy);
          const wanted = new Set(where.targetSlug?.in ?? []);
          const rows = itemRows
            .filter((i) => i.targetSlug !== null && wanted.has(i.targetSlug))
            .map((i) => ({ targetSlug: i.targetSlug, status: i.status, updatedAt: i.updatedAt }));
          if (orderBy?.updatedAt === "desc") {
            rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
          }
          return rows;
        },
      },
      contentGenerationJob: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          calls.jobCreate.push(data);
          const created = (data.items as { create: Array<Record<string, unknown>> }).create;
          // Mirror the nested write: the new items ARE in-flight from now on.
          clock += 1440; // a day between runs
          for (const item of created) {
            itemRows.push({
              targetSlug: item.targetSlug as string,
              status: item.status as string,
              payloadJson: item.payloadJson as string,
              updatedAt: at(clock),
            });
          }
          return { id: `job-${calls.jobCreate.length}`, items: created };
        },
        update: async () => ({}),
      },
    },
  },
});

async function load() {
  return import("@/lib/services/content/content-generation.service");
}

function slugs(n: number, prefix = "kw"): Array<{ slug: string }> {
  return Array.from({ length: n }, (_, i) => ({ slug: `${prefix}-${i + 1}` }));
}

beforeEach(() => {
  process.env.CONTENT_AUTOPILOT_ENABLED = "true";
  keywords = slugs(5);
  articleRows = [];
  itemRows = [];
  calls.jobCreate = [];
  calls.articleWhere = [];
  calls.itemWhere = [];
  calls.itemOrderBy = [];
  clock = 10_000;
  calls.events = [];
});

// ── Kill switch ──────────────────────────────────────────────────────────────

test("disabled flag enqueues nothing, creates no job, and reports enabled:false", async () => {
  delete process.env.CONTENT_AUTOPILOT_ENABLED;
  const { seedScheduledGeneration } = await load();
  const result = await seedScheduledGeneration(25);
  assert.equal(result.enabled, false);
  assert.equal(result.enqueued, 0);
  assert.equal(result.jobId, null);
  assert.equal(calls.jobCreate.length, 0, "no ContentGenerationJob is created");
  assert.equal(calls.articleWhere.length, 0, "gate short-circuits BEFORE any DB read");
});

test("a non-exact flag value ('1'/'TRUE'/empty) still reads as disabled", async () => {
  const { seedScheduledGeneration } = await load();
  for (const value of ["1", "TRUE", "yes", ""]) {
    process.env.CONTENT_AUTOPILOT_ENABLED = value;
    const result = await seedScheduledGeneration(25);
    assert.equal(result.enabled, false, `"${value}" must not enable the autopilot`);
    assert.equal(result.enqueued, 0);
  }
  assert.equal(calls.jobCreate.length, 0);
});

test("the flag is read at call time, so it can be flipped without a redeploy", async () => {
  const { seedScheduledGeneration, CONTENT_AUTOPILOT_FLAG } = await load();
  assert.equal(CONTENT_AUTOPILOT_FLAG, "CONTENT_AUTOPILOT_ENABLED");
  delete process.env.CONTENT_AUTOPILOT_ENABLED;
  assert.equal((await seedScheduledGeneration(25)).enabled, false);
  process.env.CONTENT_AUTOPILOT_ENABLED = "true";
  assert.equal((await seedScheduledGeneration(25)).enabled, true);
});

// ── Selection ────────────────────────────────────────────────────────────────

test("skips slugs that already have a ContentArticle row", async () => {
  articleRows = [{ slug: "kw-2" }, { slug: "kw-4" }];
  const { seedScheduledGeneration } = await load();
  const result = await seedScheduledGeneration(25);
  assert.equal(result.considered, 5);
  assert.equal(result.skippedExisting, 2);
  assert.equal(result.enqueued, 3);
  const created = (calls.jobCreate[0]!.items as { create: Array<{ targetSlug: string }> }).create;
  assert.deepEqual(
    created.map((i) => i.targetSlug),
    ["kw-1", "kw-3", "kw-5"],
  );
});

test("skips slugs with an in-flight job item (QUEUED / PROCESSING / PAUSED)", async () => {
  itemRows = [
    { targetSlug: "kw-1", status: "QUEUED", payloadJson: "{}", updatedAt: at(0) },
    { targetSlug: "kw-2", status: "PROCESSING", payloadJson: "{}", updatedAt: at(0) },
    { targetSlug: "kw-3", status: "PAUSED", payloadJson: "{}", updatedAt: at(0) },
  ];
  const { seedScheduledGeneration } = await load();
  const result = await seedScheduledGeneration(25);
  assert.equal(result.skippedInFlight, 3);
  assert.equal(result.enqueued, 2);
  const created = (calls.jobCreate[0]!.items as { create: Array<{ targetSlug: string }> }).create;
  assert.deepEqual(
    created.map((i) => i.targetSlug),
    ["kw-4", "kw-5"],
  );
});

test("exactly QUEUED, PROCESSING and PAUSED count as in-flight", async () => {
  const { IN_FLIGHT_STATUSES } = await load();
  assert.deepEqual([...IN_FLIGHT_STATUSES].sort(), ["PAUSED", "PROCESSING", "QUEUED"]);
});

test("one item probe per run serves both the in-flight and the attempted check", async () => {
  const { seedScheduledGeneration } = await load();
  await seedScheduledGeneration(25);
  assert.equal(calls.itemWhere.length, 1, "a single query, not one per rule");
  // It must NOT filter on status: the attempted/never-attempted partition needs
  // settled rows (FAILED especially) that an in-flight-only filter would hide.
  assert.equal((calls.itemWhere[0] as { status?: unknown }).status, undefined);
});

test("a settled item (SUCCEEDED / FAILED / CANCELED) does NOT block a slug", async () => {
  // A SUCCEEDED item always leaves a ContentArticle row, which is the rule that
  // actually stops it; FAILED/CANCELED slugs are genuinely un-generated and are
  // meant to be re-attempted on a later run.
  itemRows = [
    { targetSlug: "kw-1", status: "SUCCEEDED", payloadJson: "{}", updatedAt: at(0) },
    { targetSlug: "kw-2", status: "FAILED", payloadJson: "{}", updatedAt: at(0) },
    { targetSlug: "kw-3", status: "CANCELED", payloadJson: "{}", updatedAt: at(0) },
  ];
  const { seedScheduledGeneration } = await load();
  const result = await seedScheduledGeneration(25);
  assert.equal(result.skippedInFlight, 0);
  assert.equal(result.enqueued, 5);
});

test("existing-article and in-flight skips are counted without double-counting", async () => {
  articleRows = [{ slug: "kw-1" }];
  itemRows = [
    { targetSlug: "kw-1", status: "QUEUED", payloadJson: "{}", updatedAt: at(0) }, // both rules match
    { targetSlug: "kw-2", status: "QUEUED", payloadJson: "{}", updatedAt: at(0) },
  ];
  const { seedScheduledGeneration } = await load();
  const result = await seedScheduledGeneration(25);
  assert.equal(result.considered, 5);
  assert.equal(result.skippedExisting, 1);
  assert.equal(result.skippedInFlight, 1, "kw-1 is counted once, as an existing article");
  assert.equal(result.enqueued, 3);
});

// ── Spend cap ────────────────────────────────────────────────────────────────

test("never enqueues more than maxPerRun (each item is one Groq generation)", async () => {
  keywords = slugs(100);
  const { seedScheduledGeneration } = await load();
  const result = await seedScheduledGeneration(25);
  assert.equal(result.considered, 100);
  assert.equal(result.enqueued, 25);
  const created = (calls.jobCreate[0]!.items as { create: unknown[] }).create;
  assert.equal(created.length, 25);
  assert.equal(calls.jobCreate[0]!.totalItems, 25);
});

test("the shipped cap is 25 — the batch size the CLI already chose", async () => {
  const { CONTENT_SEED_MAX_PER_RUN } = await load();
  assert.equal(CONTENT_SEED_MAX_PER_RUN, 25);
});

test("the declared schedule constant matches the vercel.json cron entry", async () => {
  const { CONTENT_SEED_SCHEDULE } = await load();
  const { readFileSync } = await import("node:fs");
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    crons: Array<{ path: string; schedule: string }>;
  };
  const entry = vercel.crons.find((c) => c.path === "/api/cron/content-generation-seed");
  assert.ok(entry, "the seed cron is registered in vercel.json");
  assert.equal(entry!.schedule, CONTENT_SEED_SCHEDULE);
  assert.equal(CONTENT_SEED_SCHEDULE, "0 8 * * *", "one run per day");
});

test("a cap of 0 or less enqueues nothing rather than throwing", async () => {
  const { seedScheduledGeneration } = await load();
  const result = await seedScheduledGeneration(0);
  assert.equal(result.enqueued, 0);
  assert.equal(result.jobId, null);
  assert.equal(calls.jobCreate.length, 0);
});

// ── Owner decision: FULL AUTO-PUBLISH ────────────────────────────────────────

test("enqueues with reviewOnly:false (the owner's full auto-publish decision)", async () => {
  const { seedScheduledGeneration } = await load();
  await seedScheduledGeneration(25);
  const created = (calls.jobCreate[0]!.items as { create: Array<{ payloadJson: string }> }).create;
  for (const item of created) {
    assert.deepEqual(JSON.parse(item.payloadJson), { reviewOnly: false });
  }
});

test("enqueues op 'generate' with a null admin actor and a 'system' audit trail", async () => {
  const { seedScheduledGeneration } = await load();
  await seedScheduledGeneration(25);
  assert.equal(calls.jobCreate[0]!.jobType, "generate");
  assert.equal(calls.jobCreate[0]!.createdByAdminId, null);
  assert.equal(calls.jobCreate[0]!.filterJson, null);
  const event = calls.events.find((e) => e.eventType === "job.enqueue.generate");
  assert.ok(event, "the enqueue is recorded on the workflow ledger");
  assert.equal(event!.actor, "system", "a cron's audit actor is 'system', not an admin id");
});

test("items are created QUEUED so the existing drain cron picks them up", async () => {
  const { seedScheduledGeneration } = await load();
  await seedScheduledGeneration(25);
  const created = (calls.jobCreate[0]!.items as { create: Array<{ status: string }> }).create;
  assert.ok(created.every((i) => i.status === "QUEUED"));
});

// ── Idempotence across runs ──────────────────────────────────────────────────

test("re-running with no drain in between enqueues nothing the second time", async () => {
  const { seedScheduledGeneration } = await load();

  const first = await seedScheduledGeneration(25);
  assert.equal(first.enqueued, 5);
  assert.ok(first.jobId);

  const second = await seedScheduledGeneration(25);
  assert.equal(second.enqueued, 0, "the first run's QUEUED items block a re-enqueue");
  assert.equal(second.skippedInFlight, 5);
  assert.equal(second.jobId, null, "no empty job row is created");
  assert.equal(calls.jobCreate.length, 1, "exactly one job across both runs");
});

test("returns the full diagnosable shape for the cron-monitor run record", async () => {
  articleRows = [{ slug: "kw-1" }];
  itemRows = [{ targetSlug: "kw-2", status: "QUEUED", payloadJson: "{}", updatedAt: at(0) }];
  const { seedScheduledGeneration } = await load();
  const result = await seedScheduledGeneration(25);
  assert.deepEqual(result, {
    enabled: true,
    considered: 5,
    skippedExisting: 1,
    skippedInFlight: 1,
    enqueued: 3,
    enqueuedNew: 3,
    enqueuedRetry: 0,
    jobId: "job-1",
  });
});

test("an empty keyword database is a clean no-op, not a throw", async () => {
  keywords = [];
  const { seedScheduledGeneration } = await load();
  const result = await seedScheduledGeneration(25);
  assert.equal(result.considered, 0);
  assert.equal(result.enqueued, 0);
  assert.equal(result.jobId, null);
  assert.equal(calls.jobCreate.length, 0);
});

// ── Starvation: forward progress must survive a permanent-failure backlog ─────
//
// The defect these pin: FAILED is not an in-flight status and a terminally-failed
// item leaves no ContentArticle row, so neither skip rule excludes it. With
// `eligible` walked in fixed CONTENT_KEYWORDS order, a deterministically-failing
// slug returned to the eligible pool every run AT ITS ORIGINAL POSITION — ~25
// permanent failures near the head of the list re-filled the whole daily batch
// forever and the corpus never advanced.

test("30 never-attempted slugs, cap 25 → 25 new enqueued and zero retries", async () => {
  keywords = slugs(30);
  const { seedScheduledGeneration } = await load();
  const result = await seedScheduledGeneration(25);
  assert.equal(result.enqueued, 25);
  assert.equal(result.enqueuedNew, 25, "a clean pool spends the whole cap on new work");
  assert.equal(result.enqueuedRetry, 0, "no retry slots are reserved when nothing has failed");
});

test("REGRESSION: 25 FAILED head slugs + 100 new, cap 25 → the run still advances", async () => {
  // 125 keywords: the first 25 are permanently failed, the rest never attempted.
  keywords = slugs(125);
  itemRows = keywords.slice(0, 25).map((k) => ({
    targetSlug: k.slug,
    status: "FAILED",
    payloadJson: "{}",
    updatedAt: at(0),
  }));

  const { seedScheduledGeneration } = await load();
  const result = await seedScheduledGeneration(25);

  const failedHead = new Set(keywords.slice(0, 25).map((k) => k.slug));
  const created = (calls.jobCreate[0]!.items as { create: Array<{ targetSlug: string }> }).create;
  const enqueuedSlugs = created.map((i) => i.targetSlug);
  const newlySeeded = enqueuedSlugs.filter((s) => !failedHead.has(s));

  assert.equal(result.enqueued, 25);
  assert.ok(
    result.enqueuedNew > result.enqueuedRetry,
    `the batch must be predominantly never-attempted (new=${result.enqueuedNew}, retry=${result.enqueuedRetry})`,
  );
  assert.equal(newlySeeded.length, result.enqueuedNew);
  assert.ok(
    newlySeeded.length >= 20,
    `forward progress: expected >=20 never-attempted slugs, got ${newlySeeded.length}`,
  );
  // The precise starvation assertion: the batch is NOT the failed head over again.
  assert.notDeepEqual(
    [...enqueuedSlugs].sort(),
    [...failedHead].sort(),
    "the run must not re-enqueue the same failed head every day",
  );
});

test("REGRESSION: consecutive runs keep advancing past a permanent-failure backlog", async () => {
  keywords = slugs(125);
  itemRows = keywords.slice(0, 25).map((k) => ({
    targetSlug: k.slug,
    status: "FAILED",
    payloadJson: "{}",
    updatedAt: at(0),
  }));
  const failedHead = new Set(keywords.slice(0, 25).map((k) => k.slug));

  const { seedScheduledGeneration } = await load();
  const first = await seedScheduledGeneration(25);
  // Run 2 sees run 1's items as in-flight (no drain in between), exactly as production would.
  const second = await seedScheduledGeneration(25);

  const batch = (n: number) =>
    (calls.jobCreate[n]!.items as { create: Array<{ targetSlug: string }> }).create.map(
      (i) => i.targetSlug,
    );
  const newIn = (n: number) => batch(n).filter((s) => !failedHead.has(s));

  assert.ok(first.enqueuedNew >= 20 && second.enqueuedNew >= 20, "both runs seed new slugs");
  assert.equal(
    newIn(0).filter((s) => newIn(1).includes(s)).length,
    0,
    "the second run seeds DIFFERENT new slugs — the corpus is advancing",
  );
});

test("all slugs attempted-and-failed → retries fill the whole batch", async () => {
  keywords = slugs(60);
  itemRows = keywords.map((k, i) => ({
    targetSlug: k.slug,
    status: "FAILED",
    payloadJson: "{}",
    updatedAt: at(i),
  }));
  const { seedScheduledGeneration } = await load();
  const result = await seedScheduledGeneration(25);
  assert.equal(result.enqueued, 25, "retry still works when there is nothing new");
  assert.equal(result.enqueuedNew, 0);
  assert.equal(result.enqueuedRetry, 25, "retries expand into the unused new-slug slots");
});

test("the retry quota is respected when both pools are non-empty", async () => {
  keywords = slugs(110);
  // 10 failed, 100 never attempted — retries must take the quota, not all 10.
  itemRows = keywords.slice(0, 10).map((k) => ({
    targetSlug: k.slug,
    status: "FAILED",
    payloadJson: "{}",
    updatedAt: at(0),
  }));
  const { seedScheduledGeneration, CONTENT_SEED_RETRY_QUOTA_FRACTION } = await load();
  const result = await seedScheduledGeneration(25);
  const quota = Math.floor(25 * CONTENT_SEED_RETRY_QUOTA_FRACTION);
  assert.equal(quota, 5, "20% of a 25-item cap");
  assert.equal(result.enqueuedRetry, quota, "retries are capped at the quota, not the pool size");
  assert.equal(result.enqueuedNew, 25 - quota);
});

test("the retry quota is at most 20% of the cap", async () => {
  const { CONTENT_SEED_RETRY_QUOTA_FRACTION } = await load();
  assert.ok(
    CONTENT_SEED_RETRY_QUOTA_FRACTION > 0 && CONTENT_SEED_RETRY_QUOTA_FRACTION <= 0.2,
    "a larger share would let retries crowd out forward progress",
  );
});

test("a CANCELED or SUCCEEDED-without-article slug is a retry, not new work", async () => {
  // "Attempted" is ANY job item, not just a failed one — a slug that was canceled
  // mid-flight has consumed an attempt and must not compete as never-attempted.
  keywords = slugs(30);
  itemRows = [
    { targetSlug: "kw-1", status: "CANCELED", payloadJson: "{}", updatedAt: at(0) },
    { targetSlug: "kw-2", status: "FAILED", payloadJson: "{}", updatedAt: at(0) },
  ];
  const { seedScheduledGeneration } = await load();
  const result = await seedScheduledGeneration(25);
  assert.equal(result.enqueuedRetry, 2, "both previously-attempted slugs land in the retry pool");
  assert.equal(result.enqueuedNew, 23);
});

// ── Retry rotation: the retry quota must not burn on the same slugs forever ───
//
// Without ordering, the retry pool is walked in keyword order, so the same
// `quota` slugs are retried every single run — ~5 Groq calls a day forever for
// zero output — while a transient failure deeper in the list is NEVER retried,
// which turns a recoverable failure into a permanent one. Ordering the pool by
// each slug's most recent attempt (ascending) rotates it.

test("the item probe orders by updatedAt desc so the newest attempt per slug wins", async () => {
  const { seedScheduledGeneration } = await load();
  await seedScheduledGeneration(25);
  assert.deepEqual(calls.itemOrderBy[0], { updatedAt: "desc" });
});

test("the retry pool is ordered least-recently-attempted first", async () => {
  keywords = slugs(10);
  // Keyword order is kw-1..kw-10; attempt order is the REVERSE, so a seeder that
  // ignores timestamps would pick kw-1..kw-3 and one that rotates picks kw-10..kw-8.
  itemRows = keywords.map((k, i) => ({
    targetSlug: k.slug,
    status: "FAILED",
    payloadJson: "{}",
    updatedAt: at(100 - i * 5), // kw-1 newest, kw-10 oldest
  }));
  const { seedScheduledGeneration } = await load();
  const result = await seedScheduledGeneration(3);
  assert.equal(result.enqueuedRetry, 3);
  const created = (calls.jobCreate[0]!.items as { create: Array<{ targetSlug: string }> }).create;
  assert.deepEqual(
    created.map((i) => i.targetSlug),
    ["kw-10", "kw-9", "kw-8"],
    "oldest attempts first, not keyword order",
  );
});

test("REGRESSION: two consecutive runs retry DISJOINT sets (20 attempted, quota 5)", async () => {
  // A pool of never-attempted slugs must exist, or retries expand into the unused
  // new-slug slots and the quota never binds.
  keywords = slugs(120);
  itemRows = keywords.slice(0, 20).map((k, i) => ({
    targetSlug: k.slug,
    status: "FAILED",
    payloadJson: "{}",
    updatedAt: at(i), // kw-1 oldest … kw-20 newest
  }));

  const { seedScheduledGeneration } = await load();

  const first = await seedScheduledGeneration(25);
  const second = await seedScheduledGeneration(25);

  // `slugs` is [...newSlugs, ...retrySlugs], so the retries are the tail.
  const retriesOf = (n: number, count: number) =>
    (calls.jobCreate[n]!.items as { create: Array<{ targetSlug: string }> }).create
      .map((i) => i.targetSlug)
      .slice(-count);

  assert.equal(first.enqueuedRetry, 5);
  assert.equal(second.enqueuedRetry, 5);
  const a = retriesOf(0, first.enqueuedRetry);
  const b = retriesOf(1, second.enqueuedRetry);
  assert.deepEqual(
    a.filter((s) => b.includes(s)),
    [],
    "the second run must retry a different set of slugs",
  );
});

test("REGRESSION: rotation holds even after the drain settles the first run's retries", async () => {
  // The hard case. Without the in-flight skip masking it, a keyword-ordered pool
  // re-picks the SAME slugs: run 1's retries come back FAILED (not in-flight), so
  // only their fresher updatedAt can push them to the back of the queue.
  keywords = slugs(120);
  itemRows = keywords.slice(0, 20).map((k, i) => ({
    targetSlug: k.slug,
    status: "FAILED",
    payloadJson: "{}",
    updatedAt: at(i),
  }));

  const { seedScheduledGeneration } = await load();
  const failedPool = new Set(keywords.slice(0, 20).map((k) => k.slug));

  const first = await seedScheduledGeneration(25);
  const firstRetries = (calls.jobCreate[0]!.items as { create: Array<{ targetSlug: string }> })
    .create.map((i) => i.targetSlug)
    .filter((s) => failedPool.has(s));

  // Simulate the drain: run 1's retried items fail AGAIN, stamped at that moment.
  clock += 60;
  for (const row of itemRows) {
    if (row.status === "QUEUED" && firstRetries.includes(row.targetSlug!)) {
      row.status = "FAILED";
      row.updatedAt = at(clock);
    }
  }

  const second = await seedScheduledGeneration(25);
  const secondRetries = (calls.jobCreate[1]!.items as { create: Array<{ targetSlug: string }> })
    .create.map((i) => i.targetSlug)
    .filter((s) => failedPool.has(s));

  assert.equal(first.enqueuedRetry, 5);
  assert.equal(second.enqueuedRetry, 5);
  assert.deepEqual(
    firstRetries.filter((s) => secondRetries.includes(s)),
    [],
    "a re-failed slug goes to the BACK of the retry queue, not the front",
  );
});

test("every previously-attempted slug is eventually retried (no permanent skip)", async () => {
  // 20 failed slugs, quota 5 → four runs must cover all 20 exactly once.
  keywords = slugs(120);
  itemRows = keywords.slice(0, 20).map((k, i) => ({
    targetSlug: k.slug,
    status: "FAILED",
    payloadJson: "{}",
    updatedAt: at(i),
  }));
  const { seedScheduledGeneration } = await load();
  const failedPool = new Set(keywords.slice(0, 20).map((k) => k.slug));

  const seen: string[] = [];
  for (let run = 0; run < 4; run++) {
    await seedScheduledGeneration(25);
    const retries = (calls.jobCreate[run]!.items as { create: Array<{ targetSlug: string }> })
      .create.map((i) => i.targetSlug)
      .filter((s) => failedPool.has(s));
    seen.push(...retries);
    // Drain: this run's retries fail again with a fresh timestamp.
    clock += 60;
    for (const row of itemRows) {
      if (row.status === "QUEUED" && retries.includes(row.targetSlug!)) {
        row.status = "FAILED";
        row.updatedAt = at(clock);
      }
    }
  }

  assert.equal(seen.length, 20, "four runs x quota 5");
  assert.equal(new Set(seen).size, 20, "every failed slug retried exactly once — none starved");
});
