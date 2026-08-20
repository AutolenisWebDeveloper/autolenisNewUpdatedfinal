// Parsing + decisioning proof for the MicroBilt iPredict integration against
// REALISTIC (mock) response bodies — NO live call. Mocks global fetch to return
// an OAuth token then a GetReport body, and asserts callIPredict correctly maps
// a real-shaped answer to decision / tier / loan amounts / OFAC / reason codes.
//
// Red-first: the OFAC-ABSENT case asserts `ofacFlagged === null` (indeterminate),
// which the fail-closed OFAC gate requires. Before the fix the parser returned
// `false` (asserting "cleared") for a response that carried no OFAC data.
//
// Run: pnpm test   (globs lib/services/prequal/__tests__/*.test.ts)

import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";

// Non-sandbox, production-shaped config. Must be set before callIPredict reads
// env (it reads lazily at call time). URLs are non-apitest and end with the spec
// suffixes so the production URL guards pass.
process.env.PREQUAL_ENCRYPTION_KEY ??= "a".repeat(64);
process.env.MICROBILT_SANDBOX = "false";
process.env.MICROBILT_BASE_URL = "https://api.microbilt.example/iPredict/GetReport";
process.env.MICROBILT_OAUTH_BASE_URL = "https://api.microbilt.example/OAuth/Token";
process.env.MICROBILT_CLIENT_ID = "test-client-id";
process.env.MICROBILT_CLIENT_SECRET = "test-client-secret";

const BUYER = {
  firstName: "Jane",
  lastName: "Doe",
  dateOfBirth: "01/15/1990",
  address: "123 Main St",
  city: "Austin",
  state: "TX",
  zip: "78701",
};

// A healthy income so the income gate never declines pre-call and the credit
// gate binds the final amount deterministically (income max caps at $85k).
const HIGH_INCOME_CENTS = 1_500_000; // $15,000/mo

// The report body the mocked GetReport call returns for the current test.
let reportBody: unknown = {};
let reportStatus = 200;
const originalFetch = global.fetch;

before(() => {
  // Route OAuth → token, GetReport → the per-test reportBody.
  global.fetch = (async (url: string | URL | Request) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.toString() : (url as Request).url;
    if (u.includes("/OAuth/Token")) {
      return new Response(JSON.stringify({ access_token: "tok_test", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    // GetReport
    return new Response(JSON.stringify(reportBody), {
      status: reportStatus,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  reportStatus = 200;
});

after(() => {
  global.fetch = originalFetch;
});

function successBody(overrides: {
  decision?: { code?: string; Value?: string };
  recommendedLoanAmount?: string;
  maxLoanAmount?: string;
  scoreValue?: string;
  reasons?: Array<{ code?: string; Value?: string }>;
  idv?: Record<string, string>;
  ofac?: Record<string, string> | null;
  includeOfacBlock?: boolean;
}) {
  const idv: Record<string, string> = {
    score: "95",
    fraudWarning: "N",
    deceasedIndicator: "N",
    bankruptcyFlag: "N",
    highRiskAddress: "N",
    ...(overrides.idv ?? {}),
  };
  const serviceDetails: Record<string, unknown> = { IDV: idv };
  if (overrides.ofac !== null && overrides.ofac !== undefined) serviceDetails.OFAC = overrides.ofac;
  return {
    RESPONSE: {
      STATUS: { type: "SUCCESS", action: "DONE", applicationNumber: "APP-1" },
      CONTENT: {
        DECISION: {
          decision: overrides.decision ?? { code: "A", Value: "APPROVED" },
          decisionTimestamp: "2026-08-20T00:00:00Z",
          recommendedLoanAmount: overrides.recommendedLoanAmount ?? "42000.00",
          maxLoanAmount: overrides.maxLoanAmount ?? "50000.00",
          SCORES: [{ type: "iPredict", model: "Advantage", Value: overrides.scoreValue ?? "712" }],
          REASONS: overrides.reasons ?? [],
        },
        SERVICEDETAILS: serviceDetails,
      },
    },
  };
}

async function callWith(body: unknown) {
  reportBody = body;
  const { callIPredict } = await import("@/lib/services/prequal/microbilt.service");
  return callIPredict({
    buyer: BUYER,
    monthlyIncomeCents: HIGH_INCOME_CENTS,
    employmentStatus: "FULL_TIME",
    lengthOfEmployment: "5+ years",
    statedBudgetCents: null,
    monthlyHousingPaymentCents: null,
    monthlyOtherDebtCents: null,
  });
}

test("APPROVED, cleared OFAC: maps decision + tier + credit-gated amount", async () => {
  const res = await callWith(successBody({ ofac: { ofacresult: "N" }, idv: { OFACAlert: "N" } }));
  assert.equal(res.decision, "APPROVED");
  assert.equal(res.tier, "GOOD", "creditScore 712 ⇒ GOOD (660–719)");
  assert.equal(res.creditScore, 712);
  assert.equal(res.recommendedLoanAmountCents, 4_200_000);
  assert.equal(res.maxLoanAmountCents, 5_000_000);
  // Two-gate minimum: income max caps at $85k, credit gate is $42k ⇒ $42k.
  assert.equal(res.maxOtdAmountCents, 4_200_000);
  assert.equal(res.ofacFlagged, false, "explicit N ⇒ screened & cleared");
  assert.equal(res.mocked, false);
});

test("OFAC ABSENT on a successful response ⇒ indeterminate (null), never false", async () => {
  // No OFAC service block AND no IDV.OFACAlert field — we have NO screening data.
  const res = await callWith(successBody({ ofac: null, idv: {} }));
  assert.equal(
    res.ofacFlagged,
    null,
    "missing OFAC data must be indeterminate so the gate fails closed — not silently 'cleared'",
  );
});

test("OFAC hit (IDV.OFACAlert=Y) ⇒ flagged true", async () => {
  const res = await callWith(successBody({ idv: { OFACAlert: "Y" }, ofac: { ofacresult: "N" } }));
  assert.equal(res.ofacFlagged, true);
});

test("OFAC hit (OFAC.ofacresult=Y) ⇒ flagged true even if IDV says N", async () => {
  const res = await callWith(successBody({ idv: { OFACAlert: "N" }, ofac: { ofacresult: "Y" } }));
  assert.equal(res.ofacFlagged, true);
});

test("DECLINED response maps to DECLINED with FCRA reason codes + zero budget", async () => {
  const res = await callWith(
    successBody({
      decision: { code: "D", Value: "DECLINED" },
      reasons: [{ code: "038", Value: "Serious delinquency" }, { code: "013", Value: "Time since delinquency too recent" }],
      ofac: { ofacresult: "N" },
      idv: { OFACAlert: "N" },
    }),
  );
  assert.equal(res.decision, "DECLINED");
  assert.equal(res.maxOtdAmountCents, 0);
  assert.deepEqual(res.adverseReasonCodes, ["038", "013"]);
});

test("APPROVED but no loan amount ⇒ MANUAL_REVIEW (cannot issue a reliable budget)", async () => {
  const res = await callWith(
    successBody({ recommendedLoanAmount: "", maxLoanAmount: "", ofac: { ofacresult: "N" }, idv: { OFACAlert: "N" } }),
  );
  assert.equal(res.decision, "MANUAL_REVIEW");
  assert.equal(res.maxOtdAmountCents, 0);
});

test("ERROR via RESPONSE.STATUS.type ⇒ MANUAL_REVIEW with IPREDICT_ERROR reason", async () => {
  const res = await callWith({
    RESPONSE: { STATUS: { type: "ERROR", error: { code: "E01", message: "bad request", type: "APPLICATION" } } },
  });
  assert.equal(res.decision, "MANUAL_REVIEW");
  assert.equal(res.reason, "IPREDICT_ERROR");
});

test("ERROR via MsgRsHdr.Status.Severity=Error ⇒ MANUAL_REVIEW (not a silent empty parse)", async () => {
  const res = await callWith({
    MsgRsHdr: { Status: { StatusCode: 500, Severity: "Error", StatusDesc: "system error" } },
  });
  assert.equal(res.decision, "MANUAL_REVIEW");
  assert.equal(res.reason, "IPREDICT_ERROR");
});

test("HTTP non-200 ⇒ MANUAL_REVIEW with HTTP_<status> reason (body suppressed for PII)", async () => {
  reportStatus = 500;
  const res = await callWith({ anything: true });
  assert.equal(res.decision, "MANUAL_REVIEW");
  assert.equal(res.reason, "HTTP_500");
});
