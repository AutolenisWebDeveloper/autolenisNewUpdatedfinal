// S1 — runIntakePipeline: the intake background sequence, reconstructed from the
// persisted BuyerOpportunity so the reconciler (which only has the id) can
// re-drive it. Pins ordering (outreach runs AFTER discovery — the race the old
// dual-after() layout could get wrong) and the idempotency skips that keep a
// re-drive from re-enriching, re-scoring, or re-alerting.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks lib/services/acquisition/__tests__/intake-pipeline.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let opp: Record<string, unknown> | null = null;
const order: string[] = [];
const spy = {
  enrich: 0,
  discover: 0,
  score: 0,
  outreach: 0,
  dealersContactedEmail: 0,
  coverageGate: 0,
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      buyerOpportunity: {
        findUnique: async () => opp,
        update: async () => ({}),
      },
      dealerProspect: {
        count: async () => existingProspectCount,
        createMany: async () => ({ count: 0 }),
        findMany: async () => [],
      },
      vehicleRequest: {
        findFirst: async () => {
          if (linkedRequestThrows) throw new Error("db unavailable");
          return linkedVehicleRequest;
        },
      },
      leadScore: { create: async () => ({}) },
    },
  },
});

// Y2 coverage gate runs as the pipeline's final stage; unit-mock it here so this
// suite pins ORDERING (gate after outreach) without pulling in real coverage
// assessment. The gate's own behavior is covered by request-coverage-gate.test.ts.
mock.module("@/lib/services/acquisition/request-coverage-gate.service", {
  namedExports: {
    applyRequestCoverageGate: async () => {
      spy.coverageGate += 1;
      order.push("coverage-gate");
      return { held: false };
    },
  },
});

mock.module("@/lib/services/acquisition/compound-search.service", {
  namedExports: {
    enrichMarketData: async () => {
      spy.enrich += 1;
      order.push("enrich");
      return {
        msrpEstimate: 40000, avgPaidPrice: 38000, typicalMarkup: "3%",
        goodDealTarget: 37000, notes: "n",
      };
    },
    discoverDealers: async () => {
      spy.discover += 1;
      order.push("discover");
      return [];
    },
  },
});

mock.module("@/lib/services/acquisition/scoring.service", {
  namedExports: {
    scoreLeadFromConversation: async () => {
      spy.score += 1;
      return { score: scoreTemperature === "hot" ? 92 : 50, temperature: scoreTemperature, signals: {}, reasoning: "r" };
    },
  },
});

mock.module("@/lib/services/dealer-recruitment/phone-script-drafter.service", {
  namedExports: { draftAndSaveScript: async () => true },
});

mock.module("@/lib/services/acquisition/twilio.service", {
  namedExports: {
    notifyFounderHotLead: async () => ({}),
    sendHotLeadBuyerSms: async () => ({}),
  },
});

mock.module("@/lib/services/email/resend.service", {
  namedExports: {
    sendBuyerOpportunityConfirmationEmail: async () => ({ sent: true }),
    sendFounderHotLeadAlertEmail: async (args: Record<string, unknown>) => {
      founderAlertArgs = args;
      return { sent: true };
    },
  },
});

mock.module("@/lib/services/email/buyer-notifications.service", {
  namedExports: {
    sendDealersContactedEmail: async () => {
      spy.dealersContactedEmail += 1;
      return { sent: true };
    },
  },
});

let existingProspectCount = 0;
let outreachResult = { dealersContacted: 0 };
let scoreTemperature = "warm";
let linkedVehicleRequest: { id: string } | null = { id: "vr_1" };
let linkedRequestThrows = false;
let founderAlertArgs: Record<string, unknown> | null = null;
mock.module("@/lib/services/acquisition/post-intake-outreach.service", {
  namedExports: {
    runPostIntakeOutreach: async () => {
      spy.outreach += 1;
      order.push("outreach");
      return outreachResult;
    },
  },
});

async function load() {
  const mod = await import("@/lib/services/acquisition/intake-pipeline.service");
  return mod.runIntakePipeline;
}

function baseOpp(over: Record<string, unknown> = {}) {
  return {
    id: "opp_1", make: "Toyota", model: "Camry", zip: "75001", trim: null,
    vehicleType: "used", yearMin: 2020, yearMax: 2024, phone: "+12145551234",
    firstName: "Sam", email: "sam@example.com", timeline: "this_week",
    hasTradeIn: false, budgetAmount: 30000, monthlyPayment: null,
    marketEnrichedAt: null, leadTemperature: null,
    ...over,
  };
}

beforeEach(() => {
  opp = baseOpp();
  order.length = 0;
  spy.enrich = 0; spy.discover = 0; spy.score = 0; spy.outreach = 0;
  spy.dealersContactedEmail = 0; spy.coverageGate = 0;
  existingProspectCount = 0;
  outreachResult = { dealersContacted: 0 };
  scoreTemperature = "warm";
  linkedVehicleRequest = { id: "vr_1" };
  linkedRequestThrows = false;
  founderAlertArgs = null;
});

test("runs enrichment + discovery, then outreach AFTER discovery", async () => {
  const runIntakePipeline = await load();
  await runIntakePipeline("opp_1");
  assert.equal(spy.enrich, 1);
  assert.equal(spy.discover, 1);
  assert.equal(spy.outreach, 1);
  assert.ok(
    order.indexOf("outreach") > order.indexOf("discover"),
    "outreach must run after discovery",
  );
  assert.equal(spy.coverageGate, 1, "coverage gate runs once");
  assert.ok(
    order.indexOf("coverage-gate") > order.indexOf("outreach"),
    "coverage gate must run after outreach (assesses post-enrichment coverage)",
  );
});

test("skips enrichment when the opportunity is already enriched (idempotent re-drive)", async () => {
  opp = baseOpp({ marketEnrichedAt: new Date() });
  const runIntakePipeline = await load();
  await runIntakePipeline("opp_1");
  assert.equal(spy.enrich, 0, "no re-enrichment");
  assert.equal(spy.discover, 1, "discovery still runs");
  assert.equal(spy.outreach, 1);
});

test("skips discovery when the opportunity already has prospects (idempotent re-drive)", async () => {
  existingProspectCount = 5; // a prior run already discovered dealers
  const runIntakePipeline = await load();
  await runIntakePipeline("opp_1");
  assert.equal(spy.discover, 0, "no re-discovery → no duplicate prospects/outreach");
  assert.equal(spy.outreach, 1, "outreach still runs (self-guarded)");
});

test("skips discovery + enrichment when make/zip are missing", async () => {
  opp = baseOpp({ make: null, zip: null });
  const runIntakePipeline = await load();
  await runIntakePipeline("opp_1");
  assert.equal(spy.discover, 0);
  assert.equal(spy.enrich, 0);
  assert.equal(spy.outreach, 1, "outreach still runs (it self-guards)");
});

test("skips scoring when already scored (leadTemperature set)", async () => {
  opp = baseOpp({ leadTemperature: "warm" });
  const runIntakePipeline = await load();
  await runIntakePipeline("opp_1");
  assert.equal(spy.score, 0, "no re-scoring on re-drive");
});

test("skips scoring when there is no phone", async () => {
  opp = baseOpp({ phone: null });
  const runIntakePipeline = await load();
  await runIntakePipeline("opp_1");
  assert.equal(spy.score, 0);
});

test("sends the dealers-contacted email only when outreach contacted at least one dealer", async () => {
  outreachResult = { dealersContacted: 2 };
  const runIntakePipeline = await load();
  const res = await runIntakePipeline("opp_1");
  assert.equal(res.dealersContacted, 2);
  assert.equal(spy.dealersContactedEmail, 1);
});

test("throws when the opportunity does not exist (so the worker retries/DLQs)", async () => {
  opp = null;
  const runIntakePipeline = await load();
  await assert.rejects(() => runIntakePipeline("missing"), /not found/i);
});

// ─── Founder hot-lead alert — the CTA must point at a page that exists ──────
//
// Regression: the alert linked to /admin/opportunities/{opportunityId}. No such
// admin page has ever existed, so every hot-lead alert handed the founder a 404
// at the exact moment speed matters. There is no BuyerOpportunity detail page to
// point at; the canonical operational surface is the VehicleRequest the
// opportunity produced.

test("hot-lead alert links to the canonical VehicleRequest command view", async () => {
  scoreTemperature = "hot";
  linkedVehicleRequest = { id: "vr_42" };
  process.env.FOUNDER_EMAIL = "founder@example.com";

  const runIntakePipeline = await load();
  await runIntakePipeline("opp_1");

  assert.ok(founderAlertArgs, "founder alert must be sent for a hot lead with a phone");
  assert.equal(
    founderAlertArgs!.adminPath,
    "/admin/requests/vr_42",
    "the CTA must open the surface that can action the lead",
  );
});

test("hot-lead alert falls back to an existing list when no VehicleRequest is linked", async () => {
  // Voice/concierge opportunities can be scored before (or without) a
  // VehicleRequest ever being created. The CTA must still resolve.
  scoreTemperature = "hot";
  linkedVehicleRequest = null;
  process.env.FOUNDER_EMAIL = "founder@example.com";

  const runIntakePipeline = await load();
  await runIntakePipeline("opp_1");

  assert.ok(founderAlertArgs, "founder alert must still be sent");
  assert.equal(founderAlertArgs!.adminPath, "/admin/buyer-sources");
});

test("hot-lead alert never links to the phantom opportunities route", async () => {
  scoreTemperature = "hot";
  process.env.FOUNDER_EMAIL = "founder@example.com";

  const runIntakePipeline = await load();
  await runIntakePipeline("opp_1");

  assert.ok(founderAlertArgs);
  assert.ok(
    !String(founderAlertArgs!.adminPath).startsWith("/admin/opportunities"),
    "/admin/opportunities has no page.tsx — linking there 404s",
  );
});

test("a failed CTA lookup degrades the link but never suppresses the alert", async () => {
  // Resolving the CTA added a DB read to a best-effort notification fan-out.
  // If that read could throw, a transient failure would take out ALL FOUR
  // hot-lead channels — a strictly worse outcome than a less precise link.
  scoreTemperature = "hot";
  linkedRequestThrows = true;
  process.env.FOUNDER_EMAIL = "founder@example.com";

  const runIntakePipeline = await load();
  const result = await runIntakePipeline("opp_1");

  assert.ok(founderAlertArgs, "the hot-lead alert must still be sent");
  assert.equal(founderAlertArgs!.adminPath, "/admin/buyer-sources", "degraded, not broken");
  assert.equal(
    result.stages.find((s) => s.stage === "lead_scoring_alerts")?.status,
    "SUCCESS",
    "a CTA lookup failure must not fail the scoring stage",
  );
});
