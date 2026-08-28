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
//  3. The MsgRqHdr identity fields (MemberId / MemberPwd / UserName /
//     ProductID) are REQUIRED: the spec's security scheme is `oauth: []` only,
//     so the Bearer token identifies the caller but selects neither the member
//     account nor the product. A missing one fails closed BEFORE the call
//     rather than spending a real inquiry on an unroutable request.
//     (This file originally asserted the opposite — an opt-in shape that left
//     the request byte-identical when unset. That was deliberate caution while
//     the contract was unconfirmed; it is superseded here.)
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
// scanner does not read it as a real password. Production's
// MICROBILT_MEMBER_PASSWORD IS a real secret, which is precisely why the hygiene
// test at the bottom of this file exists.
const TEST_MEMBER_PWD = "test-member-pwd";

// The four MsgRqHdr identity vars and the values these tests configure them
// with. Every test that must REACH the provider needs all four set, because the
// adapter now refuses to call GetReport without them.
const IDENTITY_FIXTURE = {
  MICROBILT_MEMBER_ID: "29922",
  MICROBILT_MEMBER_PASSWORD: TEST_MEMBER_PWD,
  MICROBILT_USERNAME: "autolenis_api",
  MICROBILT_PRODUCT_ID: "IPREDICT_ADV",
} as const;

const IDENTITY_ENV = Object.keys(IDENTITY_FIXTURE) as Array<keyof typeof IDENTITY_FIXTURE>;

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
  for (const k of IDENTITY_ENV) process.env[k] = IDENTITY_FIXTURE[k];
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

// ─── 3. MsgRqHdr identity fields are REQUIRED ───────────────────────────────

// The exact request this code sends, with RefNum and the income-derived amount
// normalised. Any change to this string is a change to the wire contract with
// MicroBilt and must be deliberate. Field ORDER is part of the snapshot: the
// identity fields lead MsgRqHdr per the spec's field order.
const EXPECTED_REQUEST = JSON.stringify({
  MsgRqHdr: {
    MemberId: "29922",
    MemberPwd: TEST_MEMBER_PWD,
    UserName: "autolenis_api",
    ProductID: "IPREDICT_ADV",
    RequestType: "N",
    ReasonCode: "3",
    RefNum: "<uuid>",
  },
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

test("the full request we put on the wire matches the expected contract exactly", async () => {
  await call();
  assert.equal(
    normalise(lastReportBody!),
    EXPECTED_REQUEST,
    "the wire contract changed — if that is intended, update EXPECTED_REQUEST deliberately",
  );
});

test("a missing identity var fails closed BEFORE the call, never spending an inquiry", async () => {
  // Per-field coverage (each var individually required, whitespace treated as
  // unset, and the ops log naming the missing vars) lives in
  // microbilt-parse.test.ts. What this file adds is the interaction with the
  // URL guards above: identity is checked AFTER them, so a deployment with
  // several faults reports the most specific cause first.
  delete process.env.MICROBILT_PRODUCT_ID;
  const res = await call();
  assert.equal(res.reason, "IDENTITY_NOT_CONFIGURED");
  assertFailClosed(res);
  assert.equal(reportCallCount, 0, "must not spend a real inquiry on an unroutable request");
});

test("a URL fault is reported ahead of a missing identity (most specific cause wins)", async () => {
  process.env.MICROBILT_BASE_URL = "https://api.microbilt.example/iPredict";
  delete process.env.MICROBILT_MEMBER_ID;
  const res = await call();
  assert.equal(
    res.reason,
    "REPORT_URL_INVALID",
    "the URL guard runs first — an operator fixing config needs the nearest cause",
  );
  assert.equal(reportCallCount, 0);
});

test("the payload envelope and ContactInfo arity are deliberately unchanged", async () => {
  // Explicit guard on the payload questions that remain UNCONFIRMED (MBCLVRq
  // envelope, ContactInfo object-vs-array, X-CAID/X-Product headers). The
  // MsgRqHdr identity fields are no longer among them — they are now sent and
  // required. Changing several remaining unknowns at once would make the next
  // failure uninterpretable, so these still await MicroBilt's example.
  await call();
  const p = JSON.parse(lastReportBody!) as Record<string, unknown> & {
    PersonInfo: { ContactInfo: unknown };
  };
  assert.ok(!("MBCLVRq" in p), "the MBCLVRq envelope is NOT added in this change");
  assert.equal(Array.isArray(p.PersonInfo.ContactInfo), false, "ContactInfo stays an object");
});

// ─── Secret hygiene ─────────────────────────────────────────────────────────

test("the member password is never exposed by the admin config snapshot", async () => {
  const { getMicroBiltConfigStatus } = await import("@/lib/services/prequal/microbilt.service");
  const snapshot = JSON.stringify(getMicroBiltConfigStatus());
  assert.ok(
    !snapshot.includes(TEST_MEMBER_PWD),
    "MICROBILT_MEMBER_PASSWORD must never leave the adapter",
  );
  assert.ok(!snapshot.includes("test-client-secret"), "the OAuth secret must never leave the adapter");
});
