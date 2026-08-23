// Transport-agnostic buyer-intake orchestration (Inngest-free).
//
// Pins: idempotent no-op on an already-completed intake; duplicate/concurrent
// invocations blocked by the claim; success stamps intakeProcessedAt exactly once;
// failure never stamps and releases the claim; per-item isolation in the batch;
// and the historical-safety eligibility gate on the batch query.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks lib/services/acquisition/__tests__/intake-processor.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Controllable idempotency claim ───────────────────────────────────────────
let claimResult = true;
let claimThrowId: string | null = null;
const claimCalls = { claim: 0, release: 0, update: [] as string[] };
mock.module("@/lib/jobs/idempotency", {
  namedExports: {
    getSupabase: () => ({}),
    claimJob: async (_s: unknown, key: string) => {
      claimCalls.claim += 1;
      if (claimThrowId && key.includes(claimThrowId)) throw new Error("db connection lost");
      return claimResult;
    },
    releaseIdempotencyGuard: async () => {
      claimCalls.release += 1;
    },
    updateIdempotencyState: async (_s: unknown, _k: string, status: string) => {
      claimCalls.update.push(status);
    },
  },
});

// ── Controllable pipeline ────────────────────────────────────────────────────
let pipelineRuns = 0;
let pipelineImpl: (id: string) => Promise<{ dealersContacted: number }> = async () => ({
  dealersContacted: 2,
});
mock.module("@/lib/services/acquisition/intake-pipeline.service", {
  namedExports: {
    runIntakePipeline: (id: string) => {
      pipelineRuns += 1;
      return pipelineImpl(id);
    },
  },
});

// ── Controllable prisma ──────────────────────────────────────────────────────
let oppRow: { id: string; intakeProcessedAt: Date | null } | null = { id: "opp_1", intakeProcessedAt: null };
let recheckRow: { intakeProcessedAt: Date | null } = { intakeProcessedAt: null };
let stamps = 0;
let findManyArgs: Record<string, unknown> | null = null;
let eligibleRows: Array<{ id: string }> = [];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      buyerOpportunity: {
        findUnique: async ({ select }: { select: Record<string, boolean> }) => {
          // The pre-check selects intakeProcessedAt + id; the recheck selects only
          // intakeProcessedAt. Distinguish by whether `id` was requested.
          if (select.id) return oppRow;
          return oppRow ? recheckRow : null;
        },
        update: async ({ data }: { data: Record<string, unknown> }) => {
          if ("intakeProcessedAt" in data) stamps += 1;
          return {};
        },
        findMany: async (args: Record<string, unknown>) => {
          findManyArgs = args;
          return eligibleRows;
        },
      },
    },
  },
});

async function load() {
  return await import("@/lib/services/acquisition/intake-processor.service");
}

beforeEach(() => {
  claimResult = true;
  claimCalls.claim = 0;
  claimCalls.release = 0;
  claimCalls.update = [];
  pipelineRuns = 0;
  pipelineImpl = async () => ({ dealersContacted: 2 });
  oppRow = { id: "opp_1", intakeProcessedAt: null };
  recheckRow = { intakeProcessedAt: null };
  stamps = 0;
  findManyArgs = null;
  eligibleRows = [];
  claimThrowId = null;
  delete process.env.INTAKE_ELIGIBILITY_START_AT;
});

// ── Single-item orchestration ────────────────────────────────────────────────

test("already-completed intake is a no-op (no claim, no pipeline, no stamp)", async () => {
  oppRow = { id: "opp_1", intakeProcessedAt: new Date() };
  const { processBuyerOpportunityIntake } = await load();
  const r = await processBuyerOpportunityIntake("opp_1");
  assert.equal(r.status, "ALREADY_PROCESSED");
  assert.equal(claimCalls.claim, 0);
  assert.equal(pipelineRuns, 0);
  assert.equal(stamps, 0);
});

test("missing opportunity → NOT_FOUND (no claim, no pipeline)", async () => {
  oppRow = null;
  const { processBuyerOpportunityIntake } = await load();
  const r = await processBuyerOpportunityIntake("opp_x");
  assert.equal(r.status, "NOT_FOUND");
  assert.equal(claimCalls.claim, 0);
  assert.equal(pipelineRuns, 0);
});

test("duplicate/concurrent invocation blocked by the claim — pipeline never runs", async () => {
  claimResult = false;
  const { processBuyerOpportunityIntake } = await load();
  const r = await processBuyerOpportunityIntake("opp_1");
  assert.equal(r.status, "DUPLICATE_BLOCKED");
  assert.equal(pipelineRuns, 0);
  assert.equal(stamps, 0);
});

test("success runs the pipeline once and stamps intakeProcessedAt exactly once", async () => {
  const { processBuyerOpportunityIntake } = await load();
  const r = await processBuyerOpportunityIntake("opp_1");
  assert.equal(r.status, "SUCCESS");
  assert.equal(r.dealersContacted, 2);
  assert.equal(pipelineRuns, 1);
  assert.equal(stamps, 1);
  assert.deepEqual(claimCalls.update, ["completed"]);
  assert.equal(claimCalls.release, 0, "a successful claim is not released");
});

test("check-then-claim race: recheck finds it completed → no pipeline, release, no stamp", async () => {
  recheckRow = { intakeProcessedAt: new Date() };
  const { processBuyerOpportunityIntake } = await load();
  const r = await processBuyerOpportunityIntake("opp_1");
  assert.equal(r.status, "ALREADY_PROCESSED");
  assert.equal(pipelineRuns, 0);
  assert.equal(stamps, 0);
  assert.equal(claimCalls.release, 1, "claim released when a concurrent run already finished");
});

test("failed pipeline → FAILED, no stamp, claim released for retry", async () => {
  pipelineImpl = async () => {
    throw new Error("dealer discovery boom");
  };
  const { processBuyerOpportunityIntake } = await load();
  const r = await processBuyerOpportunityIntake("opp_1");
  assert.equal(r.status, "FAILED");
  assert.equal(r.category, "PIPELINE_ERROR");
  assert.match(r.error ?? "", /boom/);
  assert.equal(stamps, 0, "never stamped on failure");
  assert.deepEqual(claimCalls.update, ["failed"]);
  assert.equal(claimCalls.release, 1, "claim released so the next tick can re-drive");
});

test("failure error is redacted (defense-in-depth) before it can reach logs/cron result", async () => {
  pipelineImpl = async () => {
    throw new Error("SDK error contacting sam@example.com / +1 (555) 123-4567 failed");
  };
  const { processBuyerOpportunityIntake } = await load();
  const r = await processBuyerOpportunityIntake("opp_1");
  assert.equal(r.status, "FAILED");
  assert.doesNotMatch(r.error ?? "", /sam@example\.com/);
  assert.doesNotMatch(r.error ?? "", /555.*123.*4567/);
  assert.match(r.error ?? "", /\[redacted-email\]/);
  assert.match(r.error ?? "", /\[redacted-phone\]/);
});

// ── Batch execution + historical safety ──────────────────────────────────────

test("batch query enforces the historical eligibility gate (recency floor + active VR)", async () => {
  const { processEligibleBuyerIntakes } = await load();
  const now = new Date("2026-08-23T00:00:00.000Z");
  await processEligibleBuyerIntakes({ now, windowHours: 48 });
  assert.ok(findManyArgs, "findMany called");
  const where = findManyArgs!.where as Record<string, unknown>;
  assert.equal(where.intakeProcessedAt, null);
  // READINESS GATE — in-progress opportunities (completed:false, e.g. an empty
  // concierge chat still being filled out) must be excluded so they are never
  // stamped processed before the buyer finishes.
  assert.equal(where.completed, true);
  const gte = (where.createdAt as { gte: Date }).gte;
  // 48h before now — long-dormant historical rows (May/June) are excluded.
  assert.equal(gte.toISOString(), "2026-08-21T00:00:00.000Z");
  const or = where.OR as Array<Record<string, unknown>>;
  assert.deepEqual(
    (or[0]!.vehicleRequests as { some: { status: { in: string[] } } }).some.status.in,
    ["SUBMITTED", "INTAKE", "ACTIVE_SOURCING"],
  );
  assert.deepEqual((or[1]!.vehicleRequests as { none: unknown }).none, {});
  assert.equal(findManyArgs!.orderBy && (findManyArgs!.orderBy as { createdAt: string }).createdAt, "asc");
});

test("owner cutoff (INTAKE_ELIGIBILITY_START_AT) overrides the window when it is later", async () => {
  process.env.INTAKE_ELIGIBILITY_START_AT = "2026-08-22T12:00:00.000Z";
  const { processEligibleBuyerIntakes } = await load();
  const now = new Date("2026-08-23T00:00:00.000Z");
  await processEligibleBuyerIntakes({ now, windowHours: 48 });
  const where = findManyArgs!.where as Record<string, unknown>;
  const gte = (where.createdAt as { gte: Date }).gte;
  assert.equal(gte.toISOString(), "2026-08-22T12:00:00.000Z", "hard cutoff wins over the wider window");
});

test("per-item isolation: one failure does not abort the others; summary is accurate", async () => {
  eligibleRows = [{ id: "a" }, { id: "b" }, { id: "c" }];
  // a succeeds, b fails, c succeeds.
  pipelineImpl = async (id: string) => {
    if (id === "b") throw new Error("boom b");
    return { dealersContacted: id === "a" ? 3 : 1 };
  };
  // findUnique must reflect the current id — it always returns an unprocessed row.
  oppRow = { id: "x", intakeProcessedAt: null };
  const { processEligibleBuyerIntakes } = await load();
  const s = await processEligibleBuyerIntakes({ now: new Date("2026-08-23T00:00:00Z") });
  assert.equal(s.eligible, 3);
  assert.equal(s.attempted, 3);
  assert.equal(s.succeeded, 2);
  assert.equal(s.failed, 1);
  assert.equal(s.totalDealersContacted, 4);
  assert.equal(s.failures.length, 1);
  assert.equal(s.failures[0]!.opportunityId, "b");
  assert.equal(s.allAttemptedFailed, false);
});

test("per-item isolation holds for an INFRA throw (claim/pre-check) — batch continues", async () => {
  eligibleRows = [{ id: "a" }, { id: "b" }, { id: "c" }];
  claimThrowId = "b"; // claim throws for b (simulates a DB blip outside the try/catch)
  oppRow = { id: "x", intakeProcessedAt: null };
  const { processEligibleBuyerIntakes } = await load();
  const s = await processEligibleBuyerIntakes({ now: new Date("2026-08-23T00:00:00Z") });
  assert.equal(s.attempted, 3);
  assert.equal(s.succeeded, 2, "a and c still processed despite b's infra throw");
  assert.equal(s.failed, 1);
  assert.equal(s.failures[0]!.opportunityId, "b");
});

test("allAttemptedFailed is true when work was attempted but nothing succeeded", async () => {
  eligibleRows = [{ id: "a" }, { id: "b" }];
  pipelineImpl = async () => {
    throw new Error("everything down");
  };
  oppRow = { id: "x", intakeProcessedAt: null };
  const { processEligibleBuyerIntakes } = await load();
  const s = await processEligibleBuyerIntakes({ now: new Date("2026-08-23T00:00:00Z") });
  assert.equal(s.attempted, 2);
  assert.equal(s.succeeded, 0);
  assert.equal(s.allAttemptedFailed, true);
});

test("empty eligible set → nothing attempted, not a business-dead condition", async () => {
  eligibleRows = [];
  const { processEligibleBuyerIntakes } = await load();
  const s = await processEligibleBuyerIntakes({ now: new Date("2026-08-23T00:00:00Z") });
  assert.equal(s.eligible, 0);
  assert.equal(s.attempted, 0);
  assert.equal(s.allAttemptedFailed, false);
});
