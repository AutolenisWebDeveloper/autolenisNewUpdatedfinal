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
let itemRows: Array<{ targetSlug: string | null; status: string; payloadJson: string }> = [];

const calls = {
  jobCreate: [] as Array<Record<string, unknown>>,
  articleWhere: [] as Array<Record<string, unknown>>,
  itemWhere: [] as Array<Record<string, unknown>>,
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
        }: {
          where: { targetSlug?: { in?: string[] }; status?: { in?: string[] } };
        }) => {
          calls.itemWhere.push(where);
          const wanted = new Set(where.targetSlug?.in ?? []);
          const statuses = new Set(where.status?.in ?? []);
          return itemRows
            .filter((i) => i.targetSlug !== null && wanted.has(i.targetSlug))
            .filter((i) => statuses.has(i.status))
            .map((i) => ({ targetSlug: i.targetSlug }));
        },
      },
      contentGenerationJob: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          calls.jobCreate.push(data);
          const created = (data.items as { create: Array<Record<string, unknown>> }).create;
          // Mirror the nested write: the new items ARE in-flight from now on.
          for (const item of created) {
            itemRows.push({
              targetSlug: item.targetSlug as string,
              status: item.status as string,
              payloadJson: item.payloadJson as string,
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
    { targetSlug: "kw-1", status: "QUEUED", payloadJson: "{}" },
    { targetSlug: "kw-2", status: "PROCESSING", payloadJson: "{}" },
    { targetSlug: "kw-3", status: "PAUSED", payloadJson: "{}" },
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

test("the in-flight query filters on exactly QUEUED, PROCESSING and PAUSED", async () => {
  const { seedScheduledGeneration } = await load();
  await seedScheduledGeneration(25);
  assert.equal(calls.itemWhere.length, 1, "one in-flight probe per run");
  const status = (calls.itemWhere[0] as { status?: { in?: string[] } }).status;
  assert.deepEqual([...(status?.in ?? [])].sort(), ["PAUSED", "PROCESSING", "QUEUED"]);
});

test("a settled item (SUCCEEDED / FAILED / CANCELED) does NOT block a slug", async () => {
  // A SUCCEEDED item always leaves a ContentArticle row, which is the rule that
  // actually stops it; FAILED/CANCELED slugs are genuinely un-generated and are
  // meant to be re-attempted on a later run.
  itemRows = [
    { targetSlug: "kw-1", status: "SUCCEEDED", payloadJson: "{}" },
    { targetSlug: "kw-2", status: "FAILED", payloadJson: "{}" },
    { targetSlug: "kw-3", status: "CANCELED", payloadJson: "{}" },
  ];
  const { seedScheduledGeneration } = await load();
  const result = await seedScheduledGeneration(25);
  assert.equal(result.skippedInFlight, 0);
  assert.equal(result.enqueued, 5);
});

test("existing-article and in-flight skips are counted without double-counting", async () => {
  articleRows = [{ slug: "kw-1" }];
  itemRows = [
    { targetSlug: "kw-1", status: "QUEUED", payloadJson: "{}" }, // both rules match
    { targetSlug: "kw-2", status: "QUEUED", payloadJson: "{}" },
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
  itemRows = [{ targetSlug: "kw-2", status: "QUEUED", payloadJson: "{}" }];
  const { seedScheduledGeneration } = await load();
  const result = await seedScheduledGeneration(25);
  assert.deepEqual(result, {
    enabled: true,
    considered: 5,
    skippedExisting: 1,
    skippedInFlight: 1,
    enqueued: 3,
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
