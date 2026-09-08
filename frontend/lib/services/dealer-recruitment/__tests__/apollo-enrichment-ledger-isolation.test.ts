// previewEnrichment must be INCAPABLE of touching the ledger — not merely
// choose not to. The credit-ledger module is mocked so that EVERY export
// throws; a preview that reached a draw, a refund, or even the cycle-key helper
// would reject instead of returning. runEnrichment is held to the opposite
// property in the same conditions: its draw runs BEFORE the paid call, so a
// ledger that cannot be reached means no call is made and the run aborts as an
// error with nothing spent — never a call whose credit was not taken first.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/dealer-recruitment/__tests__/apollo-enrichment-ledger-isolation.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { EnrichmentCandidate, EnrichmentDeps } from "../apollo-enrichment-job.service";

let reached: string[] = [];
const boom = (name: string) => () => {
  reached.push(name);
  throw new Error(`ledger export reached: ${name}`);
};

mock.module("@/lib/services/dealer-recruitment/apollo-credit-ledger.service", {
  namedExports: {
    RESERVE_CREDITS: 500,
    RESERVE_RELEASE_DAY: 25,
    DEFAULT_CYCLE_CAP_CREDITS: 2000,
    backfillReserveFloor: boom("backfillReserveFloor"),
    drawCredits: boom("drawCredits"),
    refundCredits: boom("refundCredits"),
    remainingCredits: boom("remainingCredits"),
    cycleKeyFor: boom("cycleKeyFor"),
    daysInCycleFor: boom("daysInCycleFor"),
    getOrCreateCycle: boom("getOrCreateCycle"),
    ensureCurrentCycleLedger: boom("ensureCurrentCycleLedger"),
  },
});

const JOB = "@/lib/services/dealer-recruitment/apollo-enrichment-job.service";
const NOW = new Date("2026-09-08T00:00:00Z");

const candidate = (id: string): EnrichmentCandidate => ({
  id: `cand_${id}`,
  apolloPersonId: id,
  rooftopId: `rt_${id}`,
  matchMethod: "name_zip",
  matchConfidence: "high",
  enrichmentStatus: "NEW",
  lastSyncedAt: null,
  priorityTier: 3,
});

beforeEach(() => {
  reached = [];
});

test("preview returns while every ledger export throws — it has no path to a draw or a refund", async () => {
  const { previewEnrichment } = (await import(JOB)) as typeof import("../apollo-enrichment-job.service");
  let run: Record<string, unknown> | null = null;
  const deps: Partial<EnrichmentDeps> = {
    now: NOW,
    waterfallEnabled: () => false,
    selectCandidates: async () => [candidate("a"), candidate("b"), candidate("c")],
    // The one ledger fact a preview needs — the balance it quotes — is
    // injected, exactly as the orchestration layer injects the real read.
    ledgerRemaining: async () => 50,
    persistRun: async (r) => { run = r as unknown as Record<string, unknown>; },
  };

  const preview = await previewEnrichment({ maxCredits: 10 }, deps);
  assert.equal(preview.candidateCount, 3);
  assert.equal(preview.worstCaseCredits, 3);
  assert.equal(preview.creditsRemaining, 50);
  assert.deepEqual(reached, [], "no ledger export was reached by the preview");
  assert.equal((run as Record<string, unknown> | null)?.creditsSpent, 0);
});

test("a run whose ledger cannot be reached makes NO paid call and aborts as an error, nothing spent", async () => {
  const { runEnrichment } = (await import(JOB)) as typeof import("../apollo-enrichment-job.service");
  const reveals: string[] = [];
  let run: Record<string, unknown> | null = null;
  // ledgerDraw / ledgerRefund are NOT injected: the job's own defaults, built
  // on the mocked module, are what runs here.
  const deps: Partial<EnrichmentDeps> = {
    now: NOW,
    enabled: () => true,
    waterfallEnabled: () => false,
    selectCandidates: async () => [candidate("a")],
    ledgerRemaining: async () => 50,
    reveal: async (personId) => {
      reveals.push(personId);
      return { email: `${personId}@dealer.invalid`, phone: null, dncStatus: null, phoneType: null };
    },
    persistRun: async (r) => { run = r as unknown as Record<string, unknown>; },
  };

  const r = await runEnrichment({ maxCredits: 10 }, deps);
  assert.equal(r.status, "ABORTED_ERROR");
  assert.match(r.abortReason ?? "", /ledger/);
  assert.equal(r.creditsSpent, 0);
  assert.deepEqual(reveals, [], "no paid call without a draw that succeeded first");
  assert.ok(reached.length >= 1, "the run path DOES reach the ledger — the draw was attempted");
  assert.equal((run as Record<string, unknown> | null)?.status, "ABORTED_ERROR", "the aborted run is still recorded");
});
