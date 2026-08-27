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
import { createDecipheriv } from "node:crypto";

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
// When true the report response carries a body stream that never completes.
let stallReportBody = false;
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
    if (stallReportBody) {
      // Headers arrive, the body never does — the shape that hangs a naive read.
      return new Response(
        new ReadableStream({
          start() {
            /* never enqueue, never close */
          },
        }),
        { status: reportStatus },
      );
    }
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
  stallReportBody = false;
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

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostics: the non-2xx body, and APPLICATION vs SYSTEM provider errors.
//
// Regression target: a non-2xx GetReport recorded only `HTTP_<status>` and threw
// MicroBilt's response body away. For a 400 that body names the offending field
// — it is the single artifact that makes the next failure readable. It is stored
// in the SAME AES-256-GCM encrypted `rawResponse` the 200-error path already
// uses, and is never written to an app log in cleartext.
//
// Second target: `RESPONSE.STATUS.error.type` was declared on the response
// interface but never read. APPLICATION means our request is malformed (a retry
// cannot help); SYSTEM means the provider blipped (a retry can). Ops and the
// admin queue must be able to tell those apart.
// ─────────────────────────────────────────────────────────────────────────────


/** Decrypt a stored rawResponse blob with the test key, exactly as the
 *  operator's scripts/decrypt-prequal-error.ts does. */
function decryptRaw(blob: string): unknown {
  const key = Buffer.from(process.env.PREQUAL_ENCRYPTION_KEY!, "hex");
  const buf = Buffer.from(blob, "base64");
  const d = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8"),
  );
}

test("non-2xx keeps MicroBilt's error body in the ENCRYPTED rawResponse", async () => {
  reportStatus = 400;
  reportBodyRaw = JSON.stringify({
    RESPONSE: {
      STATUS: {
        type: "ERROR",
        error: { code: "MB1042", message: "MsgRqHdr.ProductID is required", type: "APPLICATION" },
      },
    },
  });
  const res = await call();
  assertFailClosed(res);

  // The blob must NOT be readable without the key — it is ciphertext, not JSON.
  assert.throws(() => JSON.parse(res.rawResponse), "rawResponse must be encrypted, not plaintext");

  const stored = decryptRaw(res.rawResponse) as {
    referred?: boolean;
    reason?: string;
    response?: { RESPONSE?: { STATUS?: { error?: { message?: string } } } };
  };
  assert.equal(stored.referred, true);
  assert.equal(
    stored.response?.RESPONSE?.STATUS?.error?.message,
    "MsgRqHdr.ProductID is required",
    "the field-level diagnostic MicroBilt returned must survive",
  );
});

test("non-2xx carries MicroBilt's error code + type into the recorded reason", async () => {
  reportStatus = 400;
  reportBodyRaw = JSON.stringify({
    RESPONSE: {
      STATUS: { type: "ERROR", error: { code: "MB1042", type: "APPLICATION" } },
    },
  });
  const res = await call();
  assert.equal(res.reason, "HTTP_400:APPLICATION:MB1042");
  assertFailClosed(res);

  const { isProviderErrorReason, classifyProviderFailure } = await import(
    "@/lib/services/prequal/microbilt.service"
  );
  assert.equal(isProviderErrorReason(res.reason), true, "a suffixed reason is still a provider failure");
  assert.equal(classifyProviderFailure(res.reason), "REQUEST_REJECTED");
});

test("a free-text provider message is NEVER promoted into the plaintext reason", async () => {
  // MicroBilt echoes request data on some errors. The reason travels to
  // ComplianceEvent metadata and the admin alert EMAIL in cleartext, so only a
  // short opaque token may be promoted — free text stays in the encrypted blob.
  reportStatus = 400;
  reportBodyRaw = JSON.stringify({
    RESPONSE: {
      STATUS: {
        type: "ERROR",
        error: { code: "Invalid BirthDt 1990-01-15 for JANE DOE", type: "APPLICATION" },
      },
    },
  });
  const res = await call();
  assert.equal(res.reason, "HTTP_400:APPLICATION", "free text must not reach the reason");
  assert.ok(!/JANE|DOE|1990/.test(res.reason!), "no consumer PII in the plaintext reason");
  // …but it must still be recoverable by an authorized operator.
  const stored = decryptRaw(res.rawResponse) as {
    response?: { RESPONSE?: { STATUS?: { error?: { code?: string } } } };
  };
  assert.match(stored.response?.RESPONSE?.STATUS?.error?.code ?? "", /JANE DOE/);
});

test("non-2xx with a non-JSON body preserves the raw text encrypted", async () => {
  reportStatus = 502;
  reportBodyRaw = "<html><body>Bad Gateway — upstream iPredict</body></html>";
  const res = await call();
  assert.equal(res.reason, "HTTP_502");
  assertFailClosed(res);
  const stored = decryptRaw(res.rawResponse) as { response?: unknown };
  assert.match(String(stored.response), /Bad Gateway/);
});

test("200 error with type APPLICATION ⇒ distinct reason, classified as our-request-is-wrong", async () => {
  reportBodyRaw = JSON.stringify({
    RESPONSE: {
      STATUS: {
        type: "ERROR",
        error: { code: "MB2001", message: "MemberId missing", type: "APPLICATION" },
      },
    },
  });
  const res = await call();
  assert.equal(res.reason, "IPREDICT_ERROR:APPLICATION:MB2001");
  assertFailClosed(res);
  const { classifyProviderFailure, isProviderErrorReason } = await import(
    "@/lib/services/prequal/microbilt.service"
  );
  assert.equal(classifyProviderFailure(res.reason), "REQUEST_REJECTED");
  assert.equal(isProviderErrorReason(res.reason), true);
});

test("200 error with type SYSTEM ⇒ distinct reason, classified as transient", async () => {
  reportBodyRaw = JSON.stringify({
    RESPONSE: {
      STATUS: { type: "ERROR", error: { code: "MB9000", type: "SYSTEM" } },
    },
  });
  const res = await call();
  assert.equal(res.reason, "IPREDICT_ERROR:SYSTEM:MB9000");
  assertFailClosed(res);
  const { classifyProviderFailure } = await import("@/lib/services/prequal/microbilt.service");
  assert.equal(classifyProviderFailure(res.reason), "PROVIDER_UNAVAILABLE");
});

test("a 200 error with no error.type keeps the unqualified reason", async () => {
  reportBodyRaw = JSON.stringify({
    RESPONSE: { STATUS: { type: "ERROR", action: "RESEND" } },
  });
  const res = await call();
  assert.equal(res.reason, "IPREDICT_ERROR");
  const { classifyProviderFailure } = await import("@/lib/services/prequal/microbilt.service");
  assert.equal(
    classifyProviderFailure(res.reason),
    "UNKNOWN",
    "we must not claim to know whether an untyped provider error is retryable",
  );
});

test("classifyProviderFailure separates config faults from transient outages", async () => {
  const { classifyProviderFailure } = await import("@/lib/services/prequal/microbilt.service");
  for (const r of ["CONFIG_ERROR", "CONFIG_MISMATCH", "URL_NOT_CONFIGURED", "REPORT_URL_INVALID", "HTTP_400", "HTTP_401"]) {
    assert.equal(classifyProviderFailure(r), "REQUEST_REJECTED", `${r} is not retryable`);
  }
  for (const r of ["TIMEOUT", "NETWORK_ERROR", "HTTP_429", "HTTP_500", "HTTP_503"]) {
    assert.equal(classifyProviderFailure(r), "PROVIDER_UNAVAILABLE", `${r} is retryable`);
  }
  for (const r of ["OAUTH_FAILED", "EMPTY_RESPONSE", "UNPARSEABLE_RESPONSE", "IPREDICT_ERROR"]) {
    assert.equal(classifyProviderFailure(r), "UNKNOWN", `${r} is not confidently classifiable`);
  }
  assert.equal(classifyProviderFailure("INCOME_BELOW_MINIMUM"), "UNKNOWN");
  assert.equal(classifyProviderFailure(undefined), "UNKNOWN");
});

test("REPORT_URL_INVALID is part of the single provider-failure taxonomy", async () => {
  const { isProviderErrorReason } = await import("@/lib/services/prequal/microbilt.service");
  assert.equal(isProviderErrorReason("REPORT_URL_INVALID"), true);
  assert.equal(isProviderErrorReason("IPREDICT_ERROR:SYSTEM:MB9000"), true);
  assert.equal(isProviderErrorReason("HTTP_400:APPLICATION:MB1042"), true);
});

test("a non-2xx whose body never arrives cannot hang the buyer's request", async () => {
  // The fetch AbortController's timer is cleared as soon as the response HEADERS
  // arrive, so reading the error body afterwards is not covered by it. A stalled
  // body would otherwise hold the buyer's prequal request open indefinitely.
  reportStatus = 500;
  stallReportBody = true;
  const startedAt = Date.now();
  const res = await call();
  const elapsed = Date.now() - startedAt;
  assert.equal(res.reason, "HTTP_500", "the failure is still classified");
  assertFailClosed(res);
  assert.ok(elapsed < 9_000, `the body read must be bounded — took ${elapsed}ms`);
});

test("a provider error code can never carry markup into the reason", async () => {
  // The reason reaches lib/services/email/templates/admin-prequal-alert.tsx,
  // which interpolates `providerReason` into an HTML table cell WITHOUT
  // escaping. Now that provider-controlled text can reach that field, the
  // sanitizer's charset is the escaping boundary — it must reject anything
  // containing HTML metacharacters, quotes, or whitespace.
  for (const hostile of [
    '<script>alert(1)</script>',
    '"><img src=x onerror=alert(1)>',
    "A&B",
    "'; DROP TABLE prequals;--",
  ]) {
    reportStatus = 400;
    reportBodyRaw = JSON.stringify({
      RESPONSE: { STATUS: { type: "ERROR", error: { code: hostile } } },
    });
    const res = await call();
    assert.equal(
      res.reason,
      "HTTP_400",
      `a hostile provider code must be dropped, not promoted: ${hostile}`,
    );
    assert.ok(
      !/[<>&"'\s]/.test(res.reason!),
      "the reason must never contain markup, quotes, or whitespace",
    );
  }
});
