// Batch 2 — trustworthy intake completion semantics.
//
// Pins the completion POLICY and bounded-retry/terminal mechanism:
//   • a REQUIRED-stage execution failure does NOT stamp intake_processed_at;
//   • ZERO_RESULTS (discovery ran, 0 dealers) IS a valid completion (no dead-letter);
//   • an OPTIONAL-stage failure still completes;
//   • REQUIRED failures increment a durable counter and, at MAX_INTAKE_ATTEMPTS,
//     transition to a terminal state (intake_failed_at) that the eligibility query
//     excludes — and NOTHING is written to jobs_dead_letter (Inngest-free terminal);
//   • the batch summary disambiguates succeeded / zeroSupply / requiredStageFailed /
//     deadLettered, and businessDead lights up only on a real dead workload.
//
// Also keeps the Batch 1 guarantees (already-processed no-op, duplicate blocked,
// per-item isolation, historical-safety gate).
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

// ── Controllable pipeline (returns the Batch 2 structured result) ─────────────
type StageOutcome = { stage: string; status: string; reason?: string };
type PipelineResult = {
  dealersContacted: number;
  stages: StageOutcome[];
  requiredFailed: boolean;
  deferred: boolean;
  zeroSupply: boolean;
};
let pipelineRuns = 0;
const okResult: PipelineResult = {
  dealersContacted: 2,
  stages: [
    { stage: "dealer_discovery", status: "SUCCESS" },
    { stage: "dealer_outreach", status: "SUCCESS" },
  ],
  requiredFailed: false,
  deferred: false,
  zeroSupply: false,
};
let pipelineImpl: (id: string) => Promise<PipelineResult> = async () => okResult;

mock.module("@/lib/services/acquisition/intake-pipeline.service", {
  namedExports: {
    runIntakePipeline: (id: string) => {
      pipelineRuns += 1;
      return pipelineImpl(id);
    },
    // The processor imports these from the pipeline — provide the real behavior.
    REQUIRED_STAGES: new Set(["dealer_discovery", "dealer_outreach"]),
    sanitizeIntakeMessage: (m: string) =>
      m
        .replace(/\s+/g, " ")
        .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
        .replace(/\+?\d[\d\s().-]{8,}\d/g, "[redacted-phone]")
        .replace(/\b\d{5}(?:-\d{4})?\b/g, "[redacted-zip]")
        .trim()
        .slice(0, 300),
  },
});

// ── Controllable prisma ──────────────────────────────────────────────────────
let oppRow: { id: string; intakeProcessedAt: Date | null } | null = { id: "opp_1", intakeProcessedAt: null };
let recheckRow: { intakeProcessedAt: Date | null } = { intakeProcessedAt: null };
let stamps = 0;
let terminalWrites = 0;
let attemptsState = 0;
let lastFailureReason: string | null = null;
let findManyArgs: Record<string, unknown> | null = null;
let eligibleRows: Array<{ id: string }> = [];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      buyerOpportunity: {
        findUnique: async ({ select }: { select: Record<string, boolean> }) => {
          if (select.id) return oppRow;
          return oppRow ? recheckRow : null;
        },
        update: async ({ data }: { data: Record<string, unknown> }) => {
          if ("intakeProcessedAt" in data) stamps += 1;
          if ("intakeFailedAt" in data) {
            terminalWrites += 1;
            lastFailureReason = (data.intakeFailureReason as string) ?? null;
          }
          const attemptInc = data.intakeAttempts as { increment?: number } | undefined;
          if (attemptInc && typeof attemptInc === "object" && "increment" in attemptInc) {
            attemptsState += attemptInc.increment ?? 1;
            return { intakeAttempts: attemptsState };
          }
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

function reqFailResult(stage = "dealer_discovery", reason = "provider boom"): PipelineResult {
  return {
    dealersContacted: 0,
    stages: [{ stage, status: "FAILED", reason }],
    requiredFailed: true,
    deferred: false,
    zeroSupply: false,
  };
}

beforeEach(() => {
  claimResult = true;
  claimThrowId = null;
  claimCalls.claim = 0;
  claimCalls.release = 0;
  claimCalls.update = [];
  pipelineRuns = 0;
  pipelineImpl = async () => okResult;
  oppRow = { id: "opp_1", intakeProcessedAt: null };
  recheckRow = { intakeProcessedAt: null };
  stamps = 0;
  terminalWrites = 0;
  attemptsState = 0;
  lastFailureReason = null;
  findManyArgs = null;
  eligibleRows = [];
  delete process.env.INTAKE_ELIGIBILITY_START_AT;
});

// ── Completion policy ─────────────────────────────────────────────────────────

test("REQUIRED-stage execution failure → NOT stamped, status REQUIRED_FAILED (retryable)", async () => {
  pipelineImpl = async () => reqFailResult();
  const { processBuyerOpportunityIntake } = await load();
  const r = await processBuyerOpportunityIntake("opp_1");
  assert.equal(r.status, "REQUIRED_FAILED");
  assert.equal(stamps, 0, "intake_processed_at must NOT be stamped on a required-stage failure");
  assert.equal(terminalWrites, 0, "not terminal before the cap");
  assert.equal(r.attempts, 1);
  assert.deepEqual(r.failedStages, ["dealer_discovery"]);
  assert.equal(claimCalls.release, 1, "claim released so the next tick can retry");
});

test("dealer discovery SUCCESS with 0 dealers → completes as ZERO_SUPPLY, never dead-letters", async () => {
  pipelineImpl = async () => ({
    dealersContacted: 0,
    stages: [
      { stage: "dealer_discovery", status: "ZERO_RESULTS" },
      { stage: "dealer_outreach", status: "ZERO_RESULTS" },
    ],
    requiredFailed: false,
    deferred: false,
    zeroSupply: true,
  });
  const { processBuyerOpportunityIntake } = await load();
  const r = await processBuyerOpportunityIntake("opp_1");
  assert.equal(r.status, "ZERO_SUPPLY");
  assert.equal(stamps, 1, "zero-supply is a valid completion");
  assert.equal(terminalWrites, 0);
});

test("OPTIONAL-stage failure (enrichment) → still completes, not blocked", async () => {
  pipelineImpl = async () => ({
    dealersContacted: 2,
    stages: [
      { stage: "market_enrichment", status: "FAILED", reason: "groq down" },
      { stage: "dealer_discovery", status: "SUCCESS" },
      { stage: "dealer_outreach", status: "SUCCESS" },
    ],
    requiredFailed: false,
    deferred: false,
    zeroSupply: false,
  });
  const { processBuyerOpportunityIntake } = await load();
  const r = await processBuyerOpportunityIntake("opp_1");
  assert.equal(r.status, "SUCCESS");
  assert.equal(stamps, 1, "an optional-stage failure must not block completion");
});

test("plain success (dealers found) → SUCCESS, stamped once", async () => {
  const { processBuyerOpportunityIntake } = await load();
  const r = await processBuyerOpportunityIntake("opp_1");
  assert.equal(r.status, "SUCCESS");
  assert.equal(r.dealersContacted, 2);
  assert.equal(stamps, 1);
  assert.deepEqual(claimCalls.update, ["completed"]);
});

test("DEFERRED (transient throttle) → NOT stamped, NOT counted toward the cap, claim released", async () => {
  attemptsState = 0;
  pipelineImpl = async () => ({
    dealersContacted: 0,
    stages: [
      { stage: "dealer_discovery", status: "SUCCESS" },
      { stage: "dealer_outreach", status: "DEFERRED", reason: "throttled" },
    ],
    requiredFailed: false,
    deferred: true,
    zeroSupply: false,
  });
  const { processBuyerOpportunityIntake } = await load();
  const r = await processBuyerOpportunityIntake("opp_1");
  assert.equal(r.status, "DEFERRED");
  assert.equal(stamps, 0, "a throttled outreach must not complete the intake");
  assert.equal(attemptsState, 0, "a transient throttle must NOT burn the bounded-retry budget");
  assert.equal(terminalWrites, 0);
  assert.equal(claimCalls.release, 1, "claim released so a later tick retries when the throttle clears");
});

// ── Bounded retry + terminal state ─────────────────────────────────────────────

test("after MAX attempts a REQUIRED failure → DEAD_LETTERED (terminal), no stamp", async () => {
  attemptsState = 2; // this run's increment → 3 == MAX_INTAKE_ATTEMPTS
  pipelineImpl = async () => reqFailResult("dealer_outreach", "all sends failed");
  const { processBuyerOpportunityIntake } = await load();
  const r = await processBuyerOpportunityIntake("opp_1");
  assert.equal(r.status, "DEAD_LETTERED");
  assert.equal(r.attempts, 3);
  assert.equal(terminalWrites, 1, "intake_failed_at set at the cap");
  assert.equal(stamps, 0, "a dead-lettered intake is never marked complete");
  assert.ok(lastFailureReason && lastFailureReason.length > 0, "a sanitized reason is persisted");
});

test("terminal reason is PII-redacted before it is persisted", async () => {
  attemptsState = 2;
  pipelineImpl = async () =>
    reqFailResult("dealer_outreach", "smtp to sam@example.com / +1 (555) 123-4567 refused");
  const { processBuyerOpportunityIntake } = await load();
  await processBuyerOpportunityIntake("opp_1");
  assert.equal(terminalWrites, 1);
  assert.doesNotMatch(lastFailureReason ?? "", /sam@example\.com/);
  assert.doesNotMatch(lastFailureReason ?? "", /555.*123.*4567/);
});

test("eligibility query excludes dead-lettered rows (intake_failed_at IS NULL)", async () => {
  const { processEligibleBuyerIntakes } = await load();
  await processEligibleBuyerIntakes({ now: new Date("2026-08-23T00:00:00Z"), windowHours: 48 });
  const where = findManyArgs!.where as Record<string, unknown>;
  assert.equal(where.intakeProcessedAt, null);
  assert.equal(where.intakeFailedAt, null, "terminal intakes are never re-selected");
  assert.equal(where.completed, true);
});

// ── Batch summary disambiguation + business-dead escalation ────────────────────

test("provider-outage batch (all REQUIRED-failed) → businessDead true", async () => {
  eligibleRows = [{ id: "a" }, { id: "b" }];
  pipelineImpl = async () => reqFailResult();
  oppRow = { id: "x", intakeProcessedAt: null };
  const { processEligibleBuyerIntakes } = await load();
  const s = await processEligibleBuyerIntakes({ now: new Date("2026-08-23T00:00:00Z") });
  assert.equal(s.requiredStageFailed, 2);
  assert.equal(s.succeeded, 0);
  assert.equal(s.zeroSupply, 0);
  assert.equal(s.businessDead, true, "zero completions + required failures = dead workload");
  assert.equal(s.stageFailureCounts.dealer_discovery, 2);
});

test("all-ZERO_SUPPLY batch → NOT businessDead (stays green)", async () => {
  eligibleRows = [{ id: "a" }, { id: "b" }];
  pipelineImpl = async () => ({
    dealersContacted: 0,
    stages: [{ stage: "dealer_discovery", status: "ZERO_RESULTS" }],
    requiredFailed: false,
    deferred: false,
    zeroSupply: true,
  });
  oppRow = { id: "x", intakeProcessedAt: null };
  const { processEligibleBuyerIntakes } = await load();
  const s = await processEligibleBuyerIntakes({ now: new Date("2026-08-23T00:00:00Z") });
  assert.equal(s.zeroSupply, 2);
  assert.equal(s.businessDead, false, "a legitimate supply gap is not a dead workload");
});

test("a lone zeroSupply must NOT mask concurrent required failures (businessDead true)", async () => {
  // Reviewer MED2: an outreach outage fails the buyers who had dealers; one buyer
  // legitimately zero-supplies. businessDead must NOT be suppressed by that one.
  eligibleRows = [{ id: "nosupply" }, { id: "fail1" }, { id: "fail2" }];
  pipelineImpl = async (id: string) =>
    id === "nosupply"
      ? {
          dealersContacted: 0,
          stages: [{ stage: "dealer_discovery", status: "ZERO_RESULTS" }],
          requiredFailed: false,
          deferred: false,
          zeroSupply: true,
        }
      : reqFailResult("dealer_outreach", "resend down");
  oppRow = { id: "x", intakeProcessedAt: null };
  const { processEligibleBuyerIntakes } = await load();
  const s = await processEligibleBuyerIntakes({ now: new Date("2026-08-23T00:00:00Z") });
  assert.equal(s.zeroSupply, 1);
  assert.equal(s.requiredStageFailed, 2);
  assert.equal(s.succeeded, 0);
  assert.equal(s.businessDead, true, "zeroSupply must not mask an outreach outage");
});

test("all-DEFERRED batch (throttled) → NOT businessDead (backpressure, not death)", async () => {
  eligibleRows = [{ id: "a" }, { id: "b" }];
  pipelineImpl = async () => ({
    dealersContacted: 0,
    stages: [
      { stage: "dealer_discovery", status: "SUCCESS" },
      { stage: "dealer_outreach", status: "DEFERRED", reason: "throttled" },
    ],
    requiredFailed: false,
    deferred: true,
    zeroSupply: false,
  });
  oppRow = { id: "x", intakeProcessedAt: null };
  const { processEligibleBuyerIntakes } = await load();
  const s = await processEligibleBuyerIntakes({ now: new Date("2026-08-23T00:00:00Z") });
  assert.equal(s.deferred, 2);
  assert.equal(s.businessDead, false, "a self-clearing throttle is not a dead workload");
});

test("mixed batch: one succeeds, one required-fails → not businessDead, both tallied", async () => {
  eligibleRows = [{ id: "good" }, { id: "bad" }];
  pipelineImpl = async (id: string) => (id === "bad" ? reqFailResult() : okResult);
  oppRow = { id: "x", intakeProcessedAt: null };
  const { processEligibleBuyerIntakes } = await load();
  const s = await processEligibleBuyerIntakes({ now: new Date("2026-08-23T00:00:00Z") });
  assert.equal(s.succeeded, 1);
  assert.equal(s.requiredStageFailed, 1);
  assert.equal(s.businessDead, false, "a completion happened, so not dead");
});

// ── Batch 1 guarantees preserved ───────────────────────────────────────────────

test("already-completed intake is a no-op (no claim, no pipeline, no stamp)", async () => {
  oppRow = { id: "opp_1", intakeProcessedAt: new Date() };
  const { processBuyerOpportunityIntake } = await load();
  const r = await processBuyerOpportunityIntake("opp_1");
  assert.equal(r.status, "ALREADY_PROCESSED");
  assert.equal(claimCalls.claim, 0);
  assert.equal(pipelineRuns, 0);
  assert.equal(stamps, 0);
});

test("already-terminal (dead-lettered) intake passed directly → no-op, no claim, no pipeline", async () => {
  oppRow = { id: "opp_1", intakeProcessedAt: null, intakeFailedAt: new Date() } as never;
  const { processBuyerOpportunityIntake } = await load();
  const r = await processBuyerOpportunityIntake("opp_1");
  assert.equal(r.status, "DEAD_LETTERED");
  assert.equal(claimCalls.claim, 0);
  assert.equal(pipelineRuns, 0);
});

test("duplicate/concurrent invocation blocked by the claim — pipeline never runs", async () => {
  claimResult = false;
  const { processBuyerOpportunityIntake } = await load();
  const r = await processBuyerOpportunityIntake("opp_1");
  assert.equal(r.status, "DUPLICATE_BLOCKED");
  assert.equal(pipelineRuns, 0);
});

test("per-item isolation: an infra throw in one item does not abort the batch", async () => {
  eligibleRows = [{ id: "a" }, { id: "b" }, { id: "c" }];
  claimThrowId = "b";
  oppRow = { id: "x", intakeProcessedAt: null };
  const { processEligibleBuyerIntakes } = await load();
  const s = await processEligibleBuyerIntakes({ now: new Date("2026-08-23T00:00:00Z") });
  assert.equal(s.attempted, 3);
  assert.equal(s.succeeded, 2);
  assert.equal(s.failed, 1);
});

test("historical-safety gate unchanged: window floor applied, owner cutoff wins when later", async () => {
  const { processEligibleBuyerIntakes } = await load();
  await processEligibleBuyerIntakes({ now: new Date("2026-08-23T00:00:00.000Z"), windowHours: 48 });
  let where = findManyArgs!.where as Record<string, unknown>;
  assert.equal((where.createdAt as { gte: Date }).gte.toISOString(), "2026-08-21T00:00:00.000Z");
  process.env.INTAKE_ELIGIBILITY_START_AT = "2026-08-22T12:00:00.000Z";
  await processEligibleBuyerIntakes({ now: new Date("2026-08-23T00:00:00.000Z"), windowHours: 48 });
  where = findManyArgs!.where as Record<string, unknown>;
  assert.equal((where.createdAt as { gte: Date }).gte.toISOString(), "2026-08-22T12:00:00.000Z");
});
