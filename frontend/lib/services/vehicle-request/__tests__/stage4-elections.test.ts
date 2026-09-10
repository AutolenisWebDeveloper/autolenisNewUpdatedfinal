// Stage 4 elections: co-buyer and trade (§4c, §5a, §6.2; Phase 4).
//
// §5a makes "co-buyer and trade elections recorded" a precondition of taking the deposit.
// RECORDED, not true — a buyer buying alone with nothing to trade answers no twice and passes.
// This file pins the three rules that make the capture safe to run at all:
//
//   1. NO IDENTITY NUMBERS for a third party. `co_buyers` has no SSN column and the service
//      REFUSES a body carrying one rather than letting Zod strip it — a silently dropped field
//      makes a caller believe it was stored and stop looking for where.
//   2. CONSENT BEFORE PII. A co-buyer is not our user. Their details are stored only against a
//      recorded, versioned confirmation that the buyer has permission to share them.
//   3. THE EDIT PATH IS THE FEATURE. A trade packet is entered before the buyer has looked up
//      their payoff or found the second key. A capture-once form publishes figures to dealers
//      that are wrong by the time they are read.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/vehicle-request/__tests__/stage4-elections.test.ts

import test, { beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

const NOW = new Date("2026-09-10T12:00:00Z");

let requestRow: Record<string, unknown> | null = null;
let coBuyerRow: Record<string, unknown> | null = null;
let tradeRow: Record<string, unknown> | null = null;
const requestUpdates: Array<Record<string, unknown>> = [];
const coBuyerWrites: Array<{ op: string; data: Record<string, unknown> }> = [];
const tradeWrites: Array<{ op: string; data: Record<string, unknown> }> = [];
const financingUpdates: Array<Record<string, unknown>> = [];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      $transaction: async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
      vehicleRequest: {
        findFirst: async () => requestRow,
        update: async ({ data }: { data: Record<string, unknown> }) => { requestUpdates.push(data); return { id: "vr1" }; },
      },
      coBuyer: {
        findFirst: async () => coBuyerRow,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          coBuyerWrites.push({ op: "create", data });
          coBuyerRow = { id: "cb1", ...data };
          return coBuyerRow;
        },
        update: async ({ data }: { data: Record<string, unknown> }) => {
          coBuyerWrites.push({ op: "update", data });
          coBuyerRow = { ...(coBuyerRow ?? {}), ...data };
          return coBuyerRow;
        },
        deleteMany: async () => { coBuyerWrites.push({ op: "deleteMany", data: {} }); coBuyerRow = null; return { count: 1 }; },
        updateMany: async ({ data }: { data: Record<string, unknown> }) => { coBuyerWrites.push({ op: "updateMany", data }); return { count: 1 }; },
      },
      tradeInSubmission: {
        findFirst: async () => tradeRow,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          tradeWrites.push({ op: "create", data });
          tradeRow = { id: "ti1", ...data };
          return tradeRow;
        },
        update: async ({ data }: { data: Record<string, unknown> }) => {
          tradeWrites.push({ op: "update", data });
          tradeRow = { ...(tradeRow ?? {}), ...data };
          return tradeRow;
        },
        updateMany: async ({ data }: { data: Record<string, unknown> }) => { tradeWrites.push({ op: "updateMany", data }); return { count: 1 }; },
      },
      vehicleRequestFinancing: {
        // UPSERT, not updateMany: `updateMany` was a silent no-op when the request had no
        // financing row, which is the exact state `trade_elected` exists for. Found in review.
        upsert: async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
          financingUpdates.push({ ...create, ...update });
          return { id: "f1" };
        },
      },
    },
  },
});

async function coBuyerSvc() { return import("@/lib/services/buyer/co-buyer.service"); }
async function tradeSvc() { return import("@/lib/services/trade-in/trade-in.service"); }

const GOOD_CO_BUYER = {
  legalFirstName: "Dana", legalLastName: "Reyes", email: "dana@example.test",
  phone: null, isRequiredSigner: true, shareConsent: true,
} as const;

const GOOD_TRADE = {
  year: 2018, make: "Honda", model: "Civic", condition: "GOOD",
  loanStatus: "OWNED_OUTRIGHT", shareConsent: true,
} as const;

beforeEach(() => {
  requestRow = { id: "vr1", status: "SUBMITTED" };
  coBuyerRow = null;
  tradeRow = null;
  requestUpdates.length = 0;
  coBuyerWrites.length = 0;
  tradeWrites.length = 0;
  financingUpdates.length = 0;
});

// ── rule 1: no identity numbers ─────────────────────────────────────────────

test("a body carrying an identity number is REFUSED, not quietly stripped", async () => {
  const { recordCoBuyerElection, findProhibitedField } = await coBuyerSvc();
  for (const key of ["ssn", "SSN", "social_security", "taxId", "dob", "dateOfBirth", "driversLicense"]) {
    assert.equal(findProhibitedField({ [key]: "x" }), key, `${key} must be caught`);
  }
  const r = await recordCoBuyerElection("b1", "vr1", true, { ...GOOD_CO_BUYER }, { ssn: "123-45-6789", ...GOOD_CO_BUYER });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, "PROHIBITED_FIELD");
  assert.deepEqual(coBuyerWrites, [], "nothing at all is written when a prohibited field is present");
});

test("ordinary fields are not mistaken for identity numbers", async () => {
  const { findProhibitedField } = await coBuyerSvc();
  for (const key of ["legalFirstName", "email", "phone", "address", "state", "role", "isRequiredSigner"]) {
    assert.equal(findProhibitedField({ [key]: "x" }), null, `${key} is legitimate`);
  }
});

// ── rule 2: consent before PII ──────────────────────────────────────────────

test("no consent, no storage — and the refusal names the way forward", async () => {
  const { recordCoBuyerElection } = await coBuyerSvc();
  const r = await recordCoBuyerElection("b1", "vr1", true, { ...GOOD_CO_BUYER, shareConsent: false });
  assert.equal(r.ok === false && r.code, "CONSENT_REQUIRED");
  assert.match(r.ok === false ? r.message : "", /permission/);
  assert.deepEqual(coBuyerWrites, []);
});

test("consent is recorded WITH its version, so a later change of wording is detectable", async () => {
  const { recordCoBuyerElection, CO_BUYER_SHARE_CONSENT_VERSION } = await coBuyerSvc();
  const r = await recordCoBuyerElection("b1", "vr1", true, { ...GOOD_CO_BUYER }, {}, NOW);
  assert.equal(r.ok, true);
  const written = coBuyerWrites.find((w) => w.op === "create")!.data;
  assert.equal(written.shareConsentAt, NOW);
  assert.equal(written.shareConsentVersion, CO_BUYER_SHARE_CONSENT_VERSION);
  assert.equal(written.isRequiredSigner, true);
});

test("a co-buyer who cannot be reached cannot sign", async () => {
  const { recordCoBuyerElection } = await coBuyerSvc();
  const r = await recordCoBuyerElection("b1", "vr1", true, { ...GOOD_CO_BUYER, email: null, phone: null });
  assert.equal(r.ok === false && r.code, "CONTACT_REQUIRED");
});

test("a missing legal name is refused — the contract is signed in that name", async () => {
  const { recordCoBuyerElection } = await coBuyerSvc();
  const r = await recordCoBuyerElection("b1", "vr1", true, { ...GOOD_CO_BUYER, legalLastName: "   " });
  assert.equal(r.ok === false && r.code, "NAME_REQUIRED");
});

// ── rule 3: "no" is an answer, and it takes the PII with it ─────────────────

test("electing NO anonymises and detaches the co-buyer — it never DELETES the row", async () => {
  // A BLOCKER FOUND IN REVIEW. This used to be a hard `deleteMany`, and `deals.co_buyer_id`
  // and `e_sign_envelopes.co_buyer_id` are both ON DELETE SET NULL — so a buyer on an
  // OFFER_ACCEPTED request (still an open status) who mis-clicked "No" silently erased a
  // signed deal's record of WHO SIGNED. Saying "no" must do two things and only two: remove
  // the third party's details, and detach them from this request with the signer flag
  // cleared. Anything that already referenced the row keeps its reference.
  const { recordCoBuyerElection } = await coBuyerSvc();
  coBuyerRow = { id: "cb1", legalFirstName: "Dana" };
  const r = await recordCoBuyerElection("b1", "vr1", false, undefined, {}, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.ok === true && r.elected, false);
  assert.equal(r.ok === true && r.coBuyer, null);

  assert.equal(coBuyerWrites.filter((w) => w.op === "deleteMany").length, 0,
    "deleting severs a retained deal's record of who signed it");
  const wipe = coBuyerWrites.find((w) => w.op === "updateMany");
  assert.ok(wipe, "the row must be anonymised");
  for (const field of ["email", "phone", "address", "city", "state", "zip"]) {
    assert.equal(wipe!.data[field], null, `${field} must be cleared`);
  }
  assert.equal(wipe!.data.isRequiredSigner, false,
    "no required signer on an envelope for a deal that has none");
  assert.equal(wipe!.data.vehicleRequestId, null, "and detached from this request");
  assert.equal(requestUpdates[0]!.coBuyerElected, false, "false is RECORDED — it is not the absence of an answer");
});

test("editing re-uses the existing row rather than accumulating a second co-buyer", async () => {
  const { recordCoBuyerElection } = await coBuyerSvc();
  coBuyerRow = { id: "cb1", legalFirstName: "Dana", legalLastName: "Reyes" };
  const r = await recordCoBuyerElection("b1", "vr1", true, { ...GOOD_CO_BUYER, legalLastName: "Reyes-Ford" });
  assert.equal(r.ok, true);
  assert.deepEqual(coBuyerWrites.map((w) => w.op), ["update"]);
});

test("a closed request cannot have its co-buyer changed", async () => {
  const { recordCoBuyerElection } = await coBuyerSvc();
  requestRow = { id: "vr1", status: "CANCELLED" };
  const r = await recordCoBuyerElection("b1", "vr1", true, { ...GOOD_CO_BUYER });
  assert.equal(r.ok === false && r.code, "REQUEST_CLOSED");
  requestRow = null;
  const gone = await recordCoBuyerElection("b1", "vr1", true, { ...GOOD_CO_BUYER });
  assert.equal(gone.ok === false && gone.code, "REQUEST_NOT_FOUND");
});

// ── the trade packet ────────────────────────────────────────────────────────

test("the appraisal disclaimer travels with the packet, always", async () => {
  const { recordTradeElection, TRADE_APPRAISAL_DISCLAIMER } = await tradeSvc();
  const r = await recordTradeElection("b1", "vr1", true, { ...GOOD_TRADE }, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.ok === true && r.packet?.disclaimer, TRADE_APPRAISAL_DISCLAIMER);
  assert.match(TRADE_APPRAISAL_DISCLAIMER, /not an offer/i, "the words must say it is not an offer");
  assert.match(TRADE_APPRAISAL_DISCLAIMER, /inspection/i, "and that an allowance follows an inspection");
});

test("a financed trade with no payoff is refused, and the refusal says why it matters", async () => {
  const { recordTradeElection } = await tradeSvc();
  for (const loanStatus of ["FINANCED", "LEASED"]) {
    const r = await recordTradeElection("b1", "vr1", true, { ...GOOD_TRADE, loanStatus, loanBalanceCents: null }, NOW);
    assert.equal(r.ok === false && r.code, "PAYOFF_REQUIRED", loanStatus);
    assert.match(r.ok === false ? r.message : "", /payoff/i);
  }
  const owned = await recordTradeElection("b1", "vr1", true, { ...GOOD_TRADE, loanStatus: "OWNED_OUTRIGHT" }, NOW);
  assert.equal(owned.ok, true, "a car owned outright has no payoff to state");
});

test("the EDIT path updates the packet dealers read and marks that the appraisal moved", async () => {
  const { recordTradeElection } = await tradeSvc();
  tradeRow = { id: "ti1", year: 2018, make: "Honda", model: "Civic" };
  const r = await recordTradeElection("b1", "vr1", true,
    { ...GOOD_TRADE, loanStatus: "FINANCED", loanBalanceCents: 850_000, hasSecondKey: true }, NOW);
  assert.equal(r.ok, true);
  const write = tradeWrites.find((w) => w.op === "update")!;
  assert.equal(write.data.loanBalanceCents, 850_000);
  assert.equal(write.data.hasSecondKey, true);
  assert.equal(write.data.appraisalChangedAt, NOW,
    "a change to a packet a dealer may already have seen is itself a fact");
  assert.equal(tradeWrites.filter((w) => w.op === "create").length, 0, "editing must not create a second packet");
});

test("electing NO detaches the packet from the request but does not forget the vehicle", async () => {
  const { recordTradeElection } = await tradeSvc();
  tradeRow = { id: "ti1" };
  const r = await recordTradeElection("b1", "vr1", false, undefined, NOW);
  assert.equal(r.ok, true);
  const detach = tradeWrites.find((w) => w.op === "updateMany")!;
  assert.equal(detach.data.vehicleRequestId, null);
  assert.equal(requestUpdates[0]!.tradeElected, false);
  assert.equal(financingUpdates[0]!.tradeIn, false, "the older financing flag must not disagree");
});

test("the election mirrors to VehicleRequestFinancing.tradeIn in both directions", async () => {
  const { recordTradeElection } = await tradeSvc();
  await recordTradeElection("b1", "vr1", true, { ...GOOD_TRADE }, NOW);
  assert.equal(financingUpdates.at(-1)!.tradeIn, true);
  await recordTradeElection("b1", "vr1", false, undefined, NOW);
  assert.equal(financingUpdates.at(-1)!.tradeIn, false);
});

test("a trade with no year, make or model is refused before consent is even considered", async () => {
  const { recordTradeElection } = await tradeSvc();
  const r = await recordTradeElection("b1", "vr1", true, { ...GOOD_TRADE, make: "  " }, NOW);
  assert.equal(r.ok === false && r.code, "VEHICLE_REQUIRED");
});

test("no consent, no packet", async () => {
  const { recordTradeElection } = await tradeSvc();
  const r = await recordTradeElection("b1", "vr1", true, { ...GOOD_TRADE, shareConsent: false }, NOW);
  assert.equal(r.ok === false && r.code, "CONSENT_REQUIRED");
  assert.deepEqual(tradeWrites, []);
});

// ── the schema half of rule 1 ───────────────────────────────────────────────

test("BUILD-FAILING RULE: co_buyers has no identity-number column, and no code adds one", () => {
  // The runtime refusal above stops a body carrying an SSN. This stops the column existing to
  // put one in. A third party's identity number, collected by someone else, through a form we
  // control, is the highest-consequence field on this platform and Stage 4 does not need it:
  // the co-buyer gives it to the LENDER, directly, at financing.
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const schema = readFileSync(`${process.cwd()}/prisma/schema.prisma`, "utf8");
  const model = schema.slice(schema.indexOf("model CoBuyer "), schema.indexOf("@@map(\"co_buyers\")"));
  assert.ok(model.length > 100, "the CoBuyer model was not found — this rule is not scanning anything");
  assert.doesNotMatch(model, /\bssn\b|social_?security|\bitin\b|tax_?id|drivers_?license/i,
    "an identity-number column on co_buyers is the point of no return: once it exists it will be filled");
  // The columns the model DOES need are still there — an over-broad guard that removed the
  // signer flag or the consent trail would be worse than none.
  for (const required of ["legalFirstName", "shareConsentAt", "shareConsentVersion", "isRequiredSigner"]) {
    assert.match(model, new RegExp(`\\b${required}\\b`), `${required} is required by §4c/§6.2 and is missing`);
  }
});

test("the elections a public form already asks reach the columns the deposit gate reads", async () => {
  // The wizard has always asked "will anyone else be on the loan?" and "do you have a
  // trade-in?". Both answers went to BuyerOpportunity and neither reached
  // `vehicle_requests.co_buyer_elected` / `trade_elected`, so a buyer who had answered both
  // still met ELECTIONS_REQUIRED at checkout. `MergeableRequestData` now carries them.
  const { MergeableRequestData } = await import("@/lib/services/vehicle-request/open-request.service") as unknown as Record<string, unknown>;
  void MergeableRequestData; // type-only; the assertion below is the real one
  const src = (require("node:fs") as typeof import("node:fs"))
    .readFileSync(`${process.cwd()}/lib/services/acquisition/unified-buyer-intake.service.ts`, "utf8");
  assert.match(src, /coBuyerElected:\s*input\.coBuyer/, "the co-buyer answer must reach the request");
  assert.match(src, /tradeElected:\s*input\.hasTradeIn/, "the trade answer must reach the request");
  // And it must NOT be flattened: `?? false` here would record every buyer who skipped the
  // question as having declined.
  assert.doesNotMatch(src, /coBuyerElected:\s*input\.coBuyer\s*\?\?/, "the election must stay three-state");
  assert.doesNotMatch(src, /tradeElected:\s*input\.hasTradeIn\s*\?\?/, "the election must stay three-state");
});

test("GET and PUT on the trade route return the SAME disclaimer shape, version included", async () => {
  // Found by review on the PR. GET returned `disclaimer: { text, version }` and PUT returned a
  // bare string, so the two methods on one route disagreed about their own contract — and the
  // half PUT dropped was the VERSION, which is the only field that records WHICH appraisal
  // disclaimer the buyer was actually shown (§6.2). A client storing PUT's answer kept the
  // words and lost the provenance, and a packet edit is exactly when the words can change.
  //
  // Source-scanned rather than invoked: this file's harness mocks the services, not the route,
  // and the defect is in the response literal itself. Comments are stripped first so the rule
  // cannot be satisfied by prose describing it.
  const src = (require("node:fs") as typeof import("node:fs"))
    .readFileSync(`${process.cwd()}/app/api/buyer/requests/[requestId]/trade/route.ts`, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  const responses = [...src.matchAll(/successResponse\(\{[\s\S]*?\}\)/g)].map((m) => m[0]);
  const withDisclaimer = responses.filter((r) => /disclaimer/.test(r));
  assert.ok(withDisclaimer.length >= 2, `expected GET and PUT to both return a disclaimer; found ${withDisclaimer.length}`);

  for (const r of withDisclaimer) {
    assert.match(r, /disclaimer:\s*\{/, "the disclaimer must be the structured shape, never a bare string");
    assert.match(r, /text:\s*TRADE_APPRAISAL_DISCLAIMER/, "carrying the text");
    assert.match(r, /version:\s*TRADE_PACKET_DISCLAIMER_VERSION/, "and the version §6.2 records");
  }
});
