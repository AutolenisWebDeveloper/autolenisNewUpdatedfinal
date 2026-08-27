// Provider-OUTCOME proof for the MicroBilt iPredict adapter — NO live call.
//
// Regression target (the ~8-week silent revenue outage): a MicroBilt call that
// errored, timed out, returned an empty body, or returned unparseable data was
// indistinguishable downstream from a genuine risk-triggered manual review.
// Two shapes in particular were swallowed outright:
//   * a 200 whose body is not valid JSON — `res.json().catch(() => ({}))`
//     turned a broken payload into an empty object with NO reason, and
//   * a 200 whose body carries no DECISION content — `mapDecision(undefined,
//     undefined)` collapsed "the provider returned nothing" into a plain
//     MANUAL_REVIEW carrying no provider-error reason at all.
// Both now surface a distinct provider-failure reason so the orchestrator can
// record + alert on them. The DECISION itself is unchanged and still
// fail-closed: every one of these paths is MANUAL_REVIEW with ofacFlagged null
// and a zero budget — never an approval.
//
// Run: pnpm test   (globs lib/services/prequal/__tests__/*.test.ts)

import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PreQualDecision } from "@prisma/client";

// Non-sandbox, production-shaped config, set before callIPredict reads env
// lazily at call time. Non-apitest URLs with the spec suffixes so the
// production URL guards pass and we exercise the real request path.
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

// Healthy income so the income gate never declines before the call — every
// case below must reach the provider and fail there, not short-circuit.
const HIGH_INCOME_CENTS = 1_500_000; // $15,000/mo

let reportStatus = 200;
let reportBodyRaw = "{}";
let oauthOk = true;
const originalFetch = global.fetch;

before(() => {
  global.fetch = (async (url: string | URL | Request) => {
    const u =
      typeof url === "string" ? url : url instanceof URL ? url.toString() : (url as Request).url;
    if (u.includes("/OAuth/Token")) {
      return oauthOk
        ? new Response(JSON.stringify({ access_token: "tok_test", expires_in: 3600 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        : new Response("nope", { status: 401 });
    }
    // GetReport — returns the per-test raw body verbatim so a test can send a
    // body that is deliberately NOT valid JSON.
    return new Response(reportBodyRaw, {
      status: reportStatus,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  reportStatus = 200;
  reportBodyRaw = "{}";
  oauthOk = true;
});

after(() => {
  global.fetch = originalFetch;
});

async function call() {
  const { callIPredict } = await import("@/lib/services/prequal/microbilt.service");
  return callIPredict({
    buyer: BUYER,
    monthlyIncomeCents: HIGH_INCOME_CENTS,
    employmentStatus: "FULL_TIME",
    lengthOfEmployment: "3_PLUS_YEARS",
    statedBudgetCents: 4_000_000,
    monthlyHousingPaymentCents: 200_000,
    monthlyOtherDebtCents: 50_000,
  });
}

// Every provider-failure path must be fail-closed and carry no fabricated data.
function assertFailClosed(res: Awaited<ReturnType<typeof call>>) {
  assert.equal(res.decision, PreQualDecision.MANUAL_REVIEW, "provider failure never approves");
  assert.equal(res.maxOtdAmountCents, 0, "no budget is fabricated on a provider failure");
  assert.equal(res.tier, null, "no tier is fabricated on a provider failure");
  assert.equal(res.ofacFlagged, null, "OFAC is indeterminate — never asserted clear");
  assert.equal(res.creditScore, null, "no credit score is fabricated");
}

// NOTE: this case must run FIRST. `getMicroBiltToken` memoises the access token
// in module scope for its lifetime, so once any earlier test has completed an
// OAuth handshake the cached token is reused and the failure branch is never
// reached. Ordering keeps the assertion honest without adding a test-only
// cache-reset hook to production code.
test("failed OAuth ⇒ OAUTH_FAILED, never a report call", async () => {
  oauthOk = false;
  const res = await call();
  assert.equal(res.reason, "OAUTH_FAILED");
  assertFailClosed(res);
});

test("200 with a body that is NOT valid JSON ⇒ UNPARSEABLE_RESPONSE (was silently swallowed to {})", async () => {
  reportBodyRaw = "<html>502 Bad Gateway</html>";
  const res = await call();
  assert.equal(res.reason, "UNPARSEABLE_RESPONSE");
  assertFailClosed(res);
});

test("200 with an empty JSON body ⇒ EMPTY_RESPONSE (was an unlabelled MANUAL_REVIEW)", async () => {
  reportBodyRaw = "{}";
  const res = await call();
  assert.equal(res.reason, "EMPTY_RESPONSE");
  assertFailClosed(res);
});

test("200 whose CONTENT carries no DECISION node ⇒ EMPTY_RESPONSE", async () => {
  reportBodyRaw = JSON.stringify({
    RESPONSE: { STATUS: { type: "SUCCESS", action: "DONE" }, CONTENT: { SERVICEDETAILS: {} } },
  });
  const res = await call();
  assert.equal(res.reason, "EMPTY_RESPONSE");
  assertFailClosed(res);
});

test("200 with a DECISION node but no decision code/value ⇒ EMPTY_RESPONSE", async () => {
  reportBodyRaw = JSON.stringify({
    RESPONSE: {
      STATUS: { type: "SUCCESS", action: "DONE" },
      CONTENT: { DECISION: { SCORES: [], REASONS: [] } },
    },
  });
  const res = await call();
  assert.equal(res.reason, "EMPTY_RESPONSE");
  assertFailClosed(res);
});

test("blank decision code/value ⇒ EMPTY_RESPONSE (not an unlabelled review)", async () => {
  reportBodyRaw = JSON.stringify({
    RESPONSE: {
      STATUS: { type: "SUCCESS", action: "DONE" },
      CONTENT: { DECISION: { decision: { code: "", Value: "  " } } },
    },
  });
  const res = await call();
  assert.equal(res.reason, "EMPTY_RESPONSE");
  assertFailClosed(res);
});

// A response can omit the DECISION while still carrying screening results.
// Classifying it as a provider failure must NOT discard those — dropping a
// sanctions hit back to "indeterminate" would lose the OFAC gate's hard signal
// and its ops alert on the way out.
test("EMPTY_RESPONSE still carries a positive OFAC hit through to the gates", async () => {
  reportBodyRaw = JSON.stringify({
    RESPONSE: {
      STATUS: { type: "SUCCESS", action: "DONE" },
      CONTENT: {
        SERVICEDETAILS: {
          IDV: { OFACAlert: "Y", deceasedIndicator: "Y", score: "42", fraudWarning: "F" },
        },
      },
    },
  });
  const res = await call();
  assert.equal(res.reason, "EMPTY_RESPONSE", "still recorded as a provider failure");
  assert.equal(res.decision, PreQualDecision.MANUAL_REVIEW, "still fail-closed");
  assert.equal(res.maxOtdAmountCents, 0, "still no budget");
  assert.equal(res.ofacFlagged, true, "a sanctions hit must survive the provider-failure path");
  assert.equal(res.deceasedFlag, true, "risk signals that DID arrive are preserved");
  assert.equal(res.fraudWarning, "F");
  assert.equal(res.idvScore, 42);
});

test("non-2xx GetReport ⇒ HTTP_<status> (the shape production is actually producing)", async () => {
  reportStatus = 401;
  reportBodyRaw = JSON.stringify({ error: "unauthorized" });
  const res = await call();
  assert.equal(res.reason, "HTTP_401");
  assertFailClosed(res);
});

test("a genuine provider decision carries NO provider-error reason", async () => {
  reportBodyRaw = JSON.stringify({
    RESPONSE: {
      STATUS: { type: "SUCCESS", action: "DONE" },
      CONTENT: {
        DECISION: {
          decision: { code: "A", Value: "APPROVED" },
          recommendedLoanAmount: "42000.00",
          maxLoanAmount: "50000.00",
          SCORES: [{ Value: "712" }],
          REASONS: [],
        },
        SERVICEDETAILS: {
          IDV: { score: "95", fraudWarning: "N", deceasedIndicator: "N", OFACAlert: "N" },
        },
      },
    },
  });
  const res = await call();
  const { isProviderErrorReason } = await import("@/lib/services/prequal/microbilt.service");
  assert.equal(
    isProviderErrorReason(res.reason),
    false,
    "a real decision must never be classified as a provider failure",
  );
  assert.equal(res.decision, PreQualDecision.APPROVED);
  assert.equal(res.creditScore, 712);
});

test("isProviderErrorReason classifies every provider-failure reason, and nothing else", async () => {
  const { isProviderErrorReason } = await import("@/lib/services/prequal/microbilt.service");
  for (const r of [
    "TIMEOUT",
    "NETWORK_ERROR",
    "OAUTH_FAILED",
    "IPREDICT_ERROR",
    "CONFIG_ERROR",
    "CONFIG_MISMATCH",
    "URL_NOT_CONFIGURED",
    "EMPTY_RESPONSE",
    "UNPARSEABLE_RESPONSE",
    "HTTP_401",
    "HTTP_500",
  ]) {
    assert.equal(isProviderErrorReason(r), true, `${r} must be a provider failure`);
  }
  // A business decline is NOT a provider failure — it is a real decision.
  assert.equal(isProviderErrorReason("INCOME_BELOW_MINIMUM"), false);
  assert.equal(isProviderErrorReason(undefined), false);
});
