// Batch 2 — the pipeline reports truthful per-stage outcomes and stays idempotent.
//
// Proves: dealer discovery distinguishes ZERO_RESULTS (ran, 0 dealers) from FAILED
// (threw); a REQUIRED-stage (discovery/outreach) FAILED sets requiredFailed; an
// OPTIONAL-stage failure (market enrichment) is recorded but does NOT set
// requiredFailed; and a re-drive never re-enriches or re-discovers (idempotency
// guards preserved), so a retry after a partial failure repeats no completed side
// effect.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks lib/services/acquisition/__tests__/intake-pipeline-outcomes.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

test("sanitizeIntakeMessage redacts email, phone, and ZIP; bounds length; single-lines", async () => {
  const { sanitizeIntakeMessage } = await import(
    "@/lib/services/acquisition/intake-pipeline.service"
  );
  // Bare 5-digit ZIP (the phone regex needs 10+ chars, so it won't catch this).
  const s = sanitizeIntakeMessage("fail\nfor sam@x.com phone +1-555-123-4567 zip 90210");
  assert.doesNotMatch(s, /sam@x\.com/);
  assert.doesNotMatch(s, /555/);
  assert.doesNotMatch(s, /90210/, "a bare ZIP must be redacted");
  assert.match(s, /\[redacted-email\]/);
  assert.match(s, /\[redacted-phone\]/);
  assert.match(s, /\[redacted-zip\]/);
  assert.doesNotMatch(s, /\n/);
  // A ZIP+4 is long enough that the phone rule catches it first — still redacted.
  assert.doesNotMatch(sanitizeIntakeMessage("area 90210-1234"), /90210/);
  assert.ok(sanitizeIntakeMessage("x".repeat(500)).length <= 300);
});

// ── External stage dependencies (controllable) ────────────────────────────────
let enrichImpl: () => Promise<unknown> = async () => ({ msrpEstimate: 1, avgPaidPrice: 1, typicalMarkup: "x", goodDealTarget: 1, notes: "n" });
let enrichCalls = 0;
let discoverImpl: () => Promise<Array<Record<string, unknown>>> = async () => [];
let discoverCalls = 0;
mock.module("@/lib/services/acquisition/compound-search.service", {
  namedExports: {
    enrichMarketData: async () => { enrichCalls += 1; return enrichImpl(); },
    discoverDealers: async () => { discoverCalls += 1; return discoverImpl(); },
  },
});

let outreachImpl: () => Promise<{ dealersContacted: number; status: string; reason?: string }> =
  async () => ({ dealersContacted: 0, status: "ZERO_RESULTS" });
mock.module("@/lib/services/acquisition/post-intake-outreach.service", {
  namedExports: { runPostIntakeOutreach: async () => outreachImpl() },
});

mock.module("@/lib/services/acquisition/scoring.service", {
  namedExports: { scoreLeadFromConversation: async () => ({ score: 1, temperature: "cold", reasoning: "r", signals: {} }) },
});
mock.module("@/lib/services/dealer-recruitment/phone-script-drafter.service", {
  namedExports: { draftAndSaveScript: async () => ({}) },
});
mock.module("@/lib/services/acquisition/twilio.service", {
  namedExports: { notifyFounderHotLead: async () => ({}), sendHotLeadBuyerSms: async () => ({}) },
});
mock.module("@/lib/services/email/resend.service", {
  namedExports: { sendBuyerOpportunityConfirmationEmail: async () => ({}), sendFounderHotLeadAlertEmail: async () => ({}) },
});
mock.module("@/lib/services/email/buyer-notifications.service", {
  namedExports: { sendDealersContactedEmail: async () => ({}) },
});
let enrichProspectImpl: () => Promise<unknown> = async () => ({});
mock.module("@/lib/services/dealer-recruitment/prospect-email-enrichment.service", {
  namedExports: { enrichProspectEmailsForOpportunity: async () => enrichProspectImpl() },
});
mock.module("@/lib/services/acquisition/request-coverage-gate.service", {
  namedExports: { applyRequestCoverageGate: async () => ({}) },
});

// ── prisma ────────────────────────────────────────────────────────────────────
let oppRow: Record<string, unknown> | null;
let existingProspects = 0;
let pendingScripts: Array<{ id: string }> = [];
mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      buyerOpportunity: {
        findUnique: async () => oppRow,
        update: async () => ({}),
      },
      dealerProspect: {
        count: async () => existingProspects,
        createMany: async () => ({ count: 1 }),
        findMany: async () => pendingScripts,
      },
      vehicleRequest: { findFirst: async () => null },
    },
  },
});

async function load() {
  return (await import("@/lib/services/acquisition/intake-pipeline.service")).runIntakePipeline;
}

function baseOpp(over: Record<string, unknown> = {}) {
  return {
    id: "opp_1", vehicleType: "used", make: "Toyota", model: "Camry", trim: null,
    yearMin: null, yearMax: null, budgetAmount: 300, monthlyPayment: null,
    hasTradeIn: null, timeline: "this_week", zip: "75001", phone: null,
    firstName: "Sam", email: "sam@example.com", marketEnrichedAt: null, leadTemperature: null,
    ...over,
  };
}

function stageOf(stages: Array<{ stage: string; status: string }>, name: string) {
  return stages.find((s) => s.stage === name)?.status;
}

beforeEach(() => {
  enrichCalls = 0;
  discoverCalls = 0;
  enrichImpl = async () => ({ msrpEstimate: 1, avgPaidPrice: 1, typicalMarkup: "x", goodDealTarget: 1, notes: "n" });
  discoverImpl = async () => [];
  outreachImpl = async () => ({ dealersContacted: 0, status: "ZERO_RESULTS" });
  enrichProspectImpl = async () => ({});
  oppRow = baseOpp();
  existingProspects = 0;
  pendingScripts = [];
});

test("discovery returns [] → dealer_discovery ZERO_RESULTS, zeroSupply, NOT requiredFailed", async () => {
  discoverImpl = async () => [];
  outreachImpl = async () => ({ dealersContacted: 0, status: "ZERO_RESULTS" });
  const run = await load();
  const r = await run("opp_1");
  assert.equal(stageOf(r.stages, "dealer_discovery"), "ZERO_RESULTS");
  assert.equal(r.zeroSupply, true);
  assert.equal(r.requiredFailed, false, "a genuine supply gap is not an execution failure");
});

test("discoverDealers throws → dealer_discovery FAILED → requiredFailed", async () => {
  discoverImpl = async () => { throw new Error("places api 503"); };
  const run = await load();
  const r = await run("opp_1");
  assert.equal(stageOf(r.stages, "dealer_discovery"), "FAILED");
  assert.equal(r.requiredFailed, true);
  assert.equal(r.zeroSupply, false);
});

test("outreach FAILED (all sends failed) → requiredFailed even if discovery succeeded", async () => {
  discoverImpl = async () => [{ name: "D", email: "d@x.com" }];
  outreachImpl = async () => ({ dealersContacted: 0, status: "FAILED", reason: "all 3 sends failed" });
  const run = await load();
  const r = await run("opp_1");
  assert.equal(stageOf(r.stages, "dealer_discovery"), "SUCCESS");
  assert.equal(stageOf(r.stages, "dealer_outreach"), "FAILED");
  assert.equal(r.requiredFailed, true);
});

test("outreach DEFERRED (rate-limited) → result.deferred true, requiredFailed false, not zeroSupply", async () => {
  discoverImpl = async () => [{ name: "D", email: "d@x.com" }];
  outreachImpl = async () => ({ dealersContacted: 0, status: "DEFERRED", reason: "throttled — retry later" });
  const run = await load();
  const r = await run("opp_1");
  assert.equal(stageOf(r.stages, "dealer_outreach"), "DEFERRED");
  assert.equal(r.deferred, true);
  assert.equal(r.requiredFailed, false, "a throttle is not an execution failure");
  assert.equal(r.zeroSupply, false);
});

test("OPTIONAL market-enrichment failure is recorded but does NOT block (requiredFailed false)", async () => {
  enrichImpl = async () => { throw new Error("groq timeout"); };
  discoverImpl = async () => [{ name: "D", email: "d@x.com" }];
  outreachImpl = async () => ({ dealersContacted: 1, status: "SUCCESS" });
  const run = await load();
  const r = await run("opp_1");
  assert.equal(stageOf(r.stages, "market_enrichment"), "FAILED");
  assert.equal(stageOf(r.stages, "dealer_discovery"), "SUCCESS");
  assert.equal(r.requiredFailed, false, "an optional stage never blocks completion");
});

test("idempotent re-drive: existing prospects → discovery SUCCESS, discoverDealers NOT called", async () => {
  existingProspects = 5; // a prior pass already discovered
  outreachImpl = async () => ({ dealersContacted: 2, status: "SUCCESS" });
  const run = await load();
  const r = await run("opp_1");
  assert.equal(discoverCalls, 0, "must not re-discover on a re-drive");
  assert.equal(stageOf(r.stages, "dealer_discovery"), "SUCCESS");
});

test("idempotent re-drive: marketEnrichedAt set → enrichMarketData NOT called (SKIPPED)", async () => {
  oppRow = baseOpp({ marketEnrichedAt: new Date() });
  const run = await load();
  const r = await run("opp_1");
  assert.equal(enrichCalls, 0, "must not re-enrich on a re-drive");
  assert.equal(stageOf(r.stages, "market_enrichment"), "SKIPPED");
});
