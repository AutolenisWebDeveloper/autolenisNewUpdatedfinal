// Config-guard and request-payload proof for the MicroBilt iPredict adapter —
// NO live call.
//
// Three regression targets:
//
//  1. `getReportUrl()` returns the env value VERBATIM (no path concatenation),
//     so a report URL that does not end in `/GetReport` silently POSTs the
//     consumer report request to the wrong path. That was a `logger.warn` only;
//     it is now a hard, fail-closed config error.
//
//  2. `RefNum` was minted with the GLOBAL `crypto.randomUUID()`. `globalThis
//     .crypto` is only available unflagged from Node 19, while package.json
//     declares `node >=18.18` — on the declared floor the call throws OUTSIDE
//     the adapter's try/catch and escapes unhandled. It now comes from
//     `node:crypto`.
//
//  3. The MsgRqHdr identity fields (ProductID / MemberId / MemberPwd /
//     UserName) are plumbed but NOT yet committed to: they appear ONLY when the
//     matching env var is set, and the request must be byte-identical to
//     today's when they are not. MicroBilt has not yet confirmed the payload
//     contract, so an unset var must change nothing.
//
// Run: pnpm test   (globs lib/services/prequal/__tests__/*.test.ts)

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PreQualDecision } from "@prisma/client";

process.env.PREQUAL_ENCRYPTION_KEY ??= "b".repeat(64);
process.env.MICROBILT_SANDBOX = "false";
process.env.MICROBILT_CLIENT_ID = "test-client-id";
process.env.MICROBILT_CLIENT_SECRET = "test-client-secret";

const GOOD_REPORT_URL = "https://api.microbilt.example/iPredict/GetReport";
const GOOD_OAUTH_URL = "https://api.microbilt.example/OAuth/Token";

const BUYER = {
  firstName: "Jane",
  lastName: "Doe",
  dateOfBirth: "01/15/1990",
  address: "123 Main St",
  city: "Austin",
  state: "TX",
  zip: "78701",
};

// A successful, decision-bearing response so the happy path completes and we
// can inspect the request we actually sent.
const OK_BODY = JSON.stringify({
  RESPONSE: {
    STATUS: { type: "SUCCESS", action: "DONE" },
    CONTENT: {
      DECISION: {
        decision: { code: "A", Value: "APPROVED" },
        recommendedLoanAmount: "42000.00",
        maxLoanAmount: "50000.00",
        SCORES: [{ Value: "712" }],
      },
      SERVICEDETAILS: { IDV: { OFACAlert: "N" } },
    },
  },
});

// Fixture value for MsgRqHdr.MemberPwd. NOT a credential — a `test-` prefixed
// placeholder, matching the MICROBILT_CLIENT_SECRET fixture above, so a secret
// scanner does not read it as a real password. Production's MICROBILT_MEMBER_PWD
// IS a real secret, which is precisely why the hygiene test at the bottom of
// this file exists.
const TEST_MEMBER_PWD = "test-member-pwd";

const IDENTITY_ENV = [
  "MICROBILT_PRODUCT_ID",
  "MICROBILT_MEMBER_ID",
  "MICROBILT_MEMBER_PWD",
  "MICROBILT_USERNAME",
] as const;

let lastReportBody: string | null = null;
let reportCallCount = 0;
const originalFetch = global.fetch;

before(() => {
  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u =
      typeof url === "string" ? url : url instanceof URL ? url.toString() : (url as Request).url;
    if (u.includes("/OAuth/Token")) {
      return new Response(JSON.stringify({ access_token: "tok_test", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    reportCallCount += 1;
    lastReportBody = typeof init?.body === "string" ? init.body : null;
    return new Response(OK_BODY, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});

beforeEach(() => {
  lastReportBody = null;
  reportCallCount = 0;
  process.env.MICROBILT_SANDBOX = "false";
  process.env.MICROBILT_BASE_URL = GOOD_REPORT_URL;
  process.env.MICROBILT_OAUTH_BASE_URL = GOOD_OAUTH_URL;
  delete process.env.IPREDICT_GET_REPORT_URL;
  delete process.env.MICROBILT_OAUTH_TOKEN_URL;
  for (const k of IDENTITY_ENV) delete process.env[k];
});

after(() => {
  global.fetch = originalFetch;
});

async function call() {
  const { callIPredict } = await import("@/lib/services/prequal/microbilt.service");
  return callIPredict({
    buyer: BUYER,
    monthlyIncomeCents: 1_500_000,
    employmentStatus: "FULL_TIME",
    lengthOfEmployment: "3_PLUS_YEARS",
    statedBudgetCents: 4_000_000,
    monthlyHousingPaymentCents: 200_000,
    monthlyOtherDebtCents: 50_000,
  });
}

function assertFailClosed(res: Awaited<ReturnType<typeof call>>) {
  assert.equal(res.decision, PreQualDecision.MANUAL_REVIEW, "a config fault never approves");
  assert.equal(res.maxOtdAmountCents, 0, "no budget is fabricated");
  assert.equal(res.tier, null);
  assert.equal(res.ofacFlagged, null, "OFAC is indeterminate — never asserted clear");
}

// ─── 1. /GetReport suffix must fail CLOSED, not warn ─────────────────────────

test("a report URL missing the /GetReport suffix is a hard config error, not a warning", async () => {
  process.env.MICROBILT_BASE_URL = "https://api.microbilt.example/iPredict";
  const res = await call();
  assert.equal(res.reason, "REPORT_URL_INVALID");
  assertFailClosed(res);
  assert.equal(reportCallCount, 0, "must not POST the consumer report to the wrong path");
});

test("a trailing slash after /GetReport is still rejected (the URL is used verbatim)", async () => {
  process.env.MICROBILT_BASE_URL = "https://api.microbilt.example/iPredict/GetReport/";
  const res = await call();
  assert.equal(res.reason, "REPORT_URL_INVALID");
  assert.equal(reportCallCount, 0);
});

test("a MISSING report URL is URL_NOT_CONFIGURED, not REPORT_URL_INVALID", async () => {
  // Ordering proof: the missing-URL guard must be evaluated BEFORE the suffix
  // guard, or an unset var reports the wrong root cause to the operator.
  delete process.env.MICROBILT_BASE_URL;
  const res = await call();
  assert.equal(res.reason, "URL_NOT_CONFIGURED");
  assertFailClosed(res);
  assert.equal(reportCallCount, 0);
});

test("a missing OAuth URL is URL_NOT_CONFIGURED even when the report URL is valid", async () => {
  delete process.env.MICROBILT_OAUTH_BASE_URL;
  const res = await call();
  assert.equal(res.reason, "URL_NOT_CONFIGURED");
  assert.equal(reportCallCount, 0);
});

test("the legacy IPREDICT_GET_REPORT_URL fallback is held to the same suffix rule", async () => {
  delete process.env.MICROBILT_BASE_URL;
  process.env.IPREDICT_GET_REPORT_URL = "https://api.microbilt.example/iPredict";
  const res = await call();
  assert.equal(res.reason, "REPORT_URL_INVALID");
  assert.equal(reportCallCount, 0);
});

test("a correctly suffixed report URL still reaches the provider", async () => {
  const res = await call();
  assert.equal(res.decision, PreQualDecision.APPROVED);
  assert.equal(reportCallCount, 1);
});

// ─── 2. Node floor: RefNum must not need the global WebCrypto object ─────────

test("the request is built without globalThis.crypto (Node 18.18 floor)", async () => {
  const savedDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  // Node <19 has no unflagged global `crypto`; simulate that floor exactly.
  delete (globalThis as { crypto?: unknown }).crypto;
  try {
    assert.equal(
      (globalThis as { crypto?: unknown }).crypto,
      undefined,
      "precondition: the global crypto object is gone",
    );
    const res = await call();
    assert.equal(res.decision, PreQualDecision.APPROVED, "the call must complete on the Node floor");
    const payload = JSON.parse(lastReportBody!) as { MsgRqHdr: { RefNum: string } };
    assert.match(
      payload.MsgRqHdr.RefNum,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      "RefNum is still a real UUID",
    );
  } finally {
    if (savedDescriptor) Object.defineProperty(globalThis, "crypto", savedDescriptor);
  }
});

// ─── 3. MsgRqHdr identity fields: opt-in only, no-op when unset ──────────────

// The exact request today's code sends, with RefNum normalised. Any change to
// this string is a change to the wire contract with MicroBilt and must be
// deliberate — the payload shape is NOT settled and is awaiting a confirmed
// example from MicroBilt support.
const EXPECTED_BASELINE_REQUEST = JSON.stringify({
  MsgRqHdr: { RequestType: "N", ReasonCode: "3", RefNum: "<uuid>" },
  RequestedAmt: { Amt: "<amt>", CurCode: "USD" },
  PersonInfo: {
    PersonName: { FirstName: "JANE", LastName: "DOE" },
    ContactInfo: {
      PostAddr: { Addr1: "123 MAIN ST", City: "AUSTIN", StateProv: "TX", PostalCode: "78701" },
    },
    BirthDt: "1990-01-15",
  },
});

function normalise(body: string): string {
  const p = JSON.parse(body) as {
    MsgRqHdr: { RefNum: string };
    RequestedAmt: { Amt: string };
  };
  p.MsgRqHdr.RefNum = "<uuid>";
  p.RequestedAmt.Amt = "<amt>";
  return JSON.stringify(p);
}

test("with the identity env UNSET the request is byte-identical to today's", async () => {
  await call();
  assert.equal(
    normalise(lastReportBody!),
    EXPECTED_BASELINE_REQUEST,
    "an unset identity var must change nothing about the request we send today",
  );
});

test("identity fields appear in MsgRqHdr only when their env vars are set", async () => {
  process.env.MICROBILT_PRODUCT_ID = "IPREDICT_ADV";
  process.env.MICROBILT_MEMBER_ID = "29922";
  process.env.MICROBILT_MEMBER_PWD = TEST_MEMBER_PWD;
  process.env.MICROBILT_USERNAME = "autolenis_api";
  await call();
  const hdr = (JSON.parse(lastReportBody!) as { MsgRqHdr: Record<string, string> }).MsgRqHdr;
  assert.equal(hdr.ProductID, "IPREDICT_ADV");
  assert.equal(hdr.MemberId, "29922");
  assert.equal(hdr.MemberPwd, TEST_MEMBER_PWD);
  assert.equal(hdr.UserName, "autolenis_api");
  // The pre-existing fields are untouched.
  assert.equal(hdr.RequestType, "N");
  assert.equal(hdr.ReasonCode, "3");
  assert.ok(hdr.RefNum);
});

test("a partially configured identity adds only the vars that are set", async () => {
  process.env.MICROBILT_MEMBER_ID = "29922";
  await call();
  const hdr = (JSON.parse(lastReportBody!) as { MsgRqHdr: Record<string, string> }).MsgRqHdr;
  assert.equal(hdr.MemberId, "29922");
  assert.ok(!("ProductID" in hdr), "an unset var must not appear at all — not even as empty");
  assert.ok(!("MemberPwd" in hdr));
  assert.ok(!("UserName" in hdr));
});

test("a blank identity env var is treated as unset (no empty field on the wire)", async () => {
  process.env.MICROBILT_PRODUCT_ID = "   ";
  await call();
  const hdr = (JSON.parse(lastReportBody!) as { MsgRqHdr: Record<string, string> }).MsgRqHdr;
  assert.ok(!("ProductID" in hdr), "a blank var must not send an empty ProductID");
});

test("the payload envelope and ContactInfo arity are deliberately unchanged", async () => {
  // Explicit guard on the three deferred payload questions (MBCLVRq envelope,
  // ContactInfo object-vs-array, X-CAID/X-Product headers). Changing several
  // unknowns at once makes the next failure uninterpretable — these await
  // MicroBilt's confirmed request example.
  await call();
  const p = JSON.parse(lastReportBody!) as Record<string, unknown> & {
    PersonInfo: { ContactInfo: unknown };
  };
  assert.ok(!("MBCLVRq" in p), "the MBCLVRq envelope is NOT added in this change");
  assert.equal(Array.isArray(p.PersonInfo.ContactInfo), false, "ContactInfo stays an object");
});

// ─── Secret hygiene ─────────────────────────────────────────────────────────

test("the member password is never exposed by the admin config snapshot", async () => {
  process.env.MICROBILT_MEMBER_PWD = TEST_MEMBER_PWD;
  process.env.MICROBILT_MEMBER_ID = "29922";
  const { getMicroBiltConfigStatus } = await import("@/lib/services/prequal/microbilt.service");
  const snapshot = JSON.stringify(getMicroBiltConfigStatus());
  assert.ok(
    !snapshot.includes(TEST_MEMBER_PWD),
    "MICROBILT_MEMBER_PWD must never leave the adapter",
  );
  assert.ok(!snapshot.includes("test-client-secret"), "the OAuth secret must never leave the adapter");
});
