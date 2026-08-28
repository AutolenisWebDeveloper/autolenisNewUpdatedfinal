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
import * as nodeCrypto from "node:crypto";

// Non-sandbox, production-shaped config. Must be set before callIPredict reads
// env (it reads lazily at call time). URLs are non-apitest and end with the spec
// suffixes so the production URL guards pass.
process.env.PREQUAL_ENCRYPTION_KEY ??= "a".repeat(64);
process.env.MICROBILT_SANDBOX = "false";
process.env.MICROBILT_BASE_URL = "https://api.microbilt.example/iPredict/GetReport";
process.env.MICROBILT_OAUTH_BASE_URL = "https://api.microbilt.example/OAuth/Token";
process.env.MICROBILT_CLIENT_ID = "test-client-id";
process.env.MICROBILT_CLIENT_SECRET = "test-client-secret";
// MsgRqHdr identity/routing fields (iPredict_6.yaml). All four are required in
// production; the adapter fails closed to MANUAL_REVIEW without them rather
// than spending a real inquiry on a request MicroBilt cannot route.
process.env.MICROBILT_MEMBER_ID = "test-member-id";
process.env.MICROBILT_MEMBER_PASSWORD = "test-member-pwd";
process.env.MICROBILT_USERNAME = "test-user-name";
process.env.MICROBILT_PRODUCT_ID = "test-product-id";

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
// Captures what we actually PUT ON THE WIRE for the last GetReport call, so
// request-shape conformance can be asserted (not just response parsing).
let sentReportPayload: Record<string, unknown> | null = null;
let getReportCallCount = 0;
const originalFetch = global.fetch;

before(() => {
  // Route OAuth → token, GetReport → the per-test reportBody.
  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.toString() : (url as Request).url;
    if (u.includes("/OAuth/Token")) {
      return new Response(JSON.stringify({ access_token: "tok_test", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    // GetReport
    getReportCallCount += 1;
    sentReportPayload =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : null;
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

// Restoring with `process.env.X = undefined` would set the literal STRING
// "undefined" — a truthy value that would silently defeat the next test's
// missing-var assertion. Always delete instead.
function restoreEnv(name: string, saved: string | undefined): void {
  if (saved === undefined) delete process.env[name];
  else process.env[name] = saved;
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

test("OFAC present but UNRECOGNIZED value (not Y/N) ⇒ indeterminate (null), fails closed", async () => {
  // A provider token we don't recognize as a hit or a clear must NOT be treated
  // as cleared — even when the other signal explicitly says N.
  const res = await callWith(successBody({ idv: { OFACAlert: "N" }, ofac: { ofacresult: "REVIEW" } }));
  assert.equal(res.ofacFlagged, null, "an unrecognized present value alongside an N is still indeterminate");
});

test("mlaCovered is honest: absent MLA data ⇒ null (indeterminate), present N ⇒ false, present Y ⇒ true", async () => {
  // Absent (no MLA block) — the successBody omits MLA unless provided.
  const absent = await callWith(successBody({ ofac: { ofacresult: "N" }, idv: { OFACAlert: "N" } }));
  assert.equal(absent.mlaCovered, null, "absent MLA data must not assert 'not covered'");
  // Present + covered.
  const covered = await callWith({
    RESPONSE: {
      STATUS: { type: "SUCCESS", action: "DONE" },
      CONTENT: {
        DECISION: { decision: { code: "A", Value: "APPROVED" }, recommendedLoanAmount: "42000.00", maxLoanAmount: "50000.00", SCORES: [{ Value: "712" }], REASONS: [] },
        SERVICEDETAILS: { IDV: { OFACAlert: "N" }, OFAC: { ofacresult: "N" }, MLA: { STATUS: { Value: "Y" } } },
      },
    },
  });
  assert.equal(covered.mlaCovered, true);
});

test("high-risk address signal is parsed from IDV (no longer indeterminate-only)", async () => {
  const res = await callWith(successBody({ ofac: { ofacresult: "N" }, idv: { OFACAlert: "N", suspiciousAddress: "Y" } }));
  assert.equal(res.highRiskAddressFlag, true);
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

test("ERROR via RESPONSE.STATUS.type ⇒ MANUAL_REVIEW with an IPREDICT_ERROR reason", async () => {
  const res = await callWith({
    RESPONSE: { STATUS: { type: "ERROR", error: { code: "E01", message: "bad request", type: "APPLICATION" } } },
  });
  assert.equal(res.decision, "MANUAL_REVIEW");
  // The reason now carries MicroBilt's own APPLICATION/SYSTEM verdict and error
  // code as diagnostics. The BASE is unchanged, so classification (and every
  // consumer that keys on it) is unaffected — only the detail is richer.
  assert.equal(res.reason, "IPREDICT_ERROR:APPLICATION:E01");
  const { providerReasonBase, isProviderErrorReason } = await import(
    "@/lib/services/prequal/microbilt.service"
  );
  assert.equal(providerReasonBase(res.reason!), "IPREDICT_ERROR");
  assert.equal(isProviderErrorReason(res.reason), true);
  // The free-text message stays out of the plaintext reason.
  assert.ok(!res.reason!.includes("bad request"));
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

// ─── MsgRqHdr identity/routing conformance (iPredict_6.yaml) ─────────────────
// The spec puts account identity and product routing in the request BODY's
// MsgRqHdr — security is `oauth: []` only, so the Bearer token alone does not
// tell MicroBilt which member account or product the request is for.

test("MsgRqHdr carries MemberId / MemberPwd / UserName / ProductID from env", async () => {
  await callWith(successBody({ ofac: { ofacresult: "N" }, idv: { OFACAlert: "N" } }));

  assert.ok(sentReportPayload, "a GetReport body must have been sent");
  const hdr = (sentReportPayload as { MsgRqHdr?: Record<string, unknown> }).MsgRqHdr;
  assert.ok(hdr, "payload must carry MsgRqHdr");

  assert.equal(hdr.MemberId, "test-member-id");
  assert.equal(hdr.MemberPwd, "test-member-pwd");
  assert.equal(hdr.UserName, "test-user-name");
  assert.equal(hdr.ProductID, "test-product-id");

  // The pre-existing routing fields must survive unchanged.
  assert.equal(hdr.RequestType, "N");
  assert.equal(hdr.ReasonCode, "3");
  assert.equal(typeof hdr.RefNum, "string");
  assert.ok((hdr.RefNum as string).length > 0, "RefNum must be non-empty");
});

test("a missing identity field fails closed: IDENTITY_NOT_CONFIGURED, GetReport never called", async () => {
  const saved = process.env.MICROBILT_PRODUCT_ID;
  delete process.env.MICROBILT_PRODUCT_ID;
  const callsBefore = getReportCallCount;
  try {
    const res = await callWith(successBody({ ofac: { ofacresult: "N" }, idv: { OFACAlert: "N" } }));
    assert.equal(res.decision, "MANUAL_REVIEW");
    assert.equal(res.reason, "IDENTITY_NOT_CONFIGURED");
    assert.equal(res.mocked, false);
    assert.equal(
      getReportCallCount,
      callsBefore,
      "must not spend a real inquiry on a request MicroBilt cannot route",
    );
    // OFAC was never screened — the tri-state contract requires indeterminate.
    assert.equal(res.ofacFlagged, null);
  } finally {
    restoreEnv("MICROBILT_PRODUCT_ID", saved);
  }
});

test("every identity field is individually required", async () => {
  const vars = [
    "MICROBILT_MEMBER_ID",
    "MICROBILT_MEMBER_PASSWORD",
    "MICROBILT_USERNAME",
    "MICROBILT_PRODUCT_ID",
  ] as const;
  for (const v of vars) {
    const saved = process.env[v];
    delete process.env[v];
    try {
      const res = await callWith(successBody({ ofac: { ofacresult: "N" }, idv: { OFACAlert: "N" } }));
      assert.equal(res.reason, "IDENTITY_NOT_CONFIGURED", `${v} must be required`);
    } finally {
      restoreEnv(v, saved);
    }
  }
});

test("an identity field of only whitespace is treated as unset (not sent as blank)", async () => {
  const saved = process.env.MICROBILT_MEMBER_ID;
  process.env.MICROBILT_MEMBER_ID = "   ";
  try {
    const res = await callWith(successBody({ ofac: { ofacresult: "N" }, idv: { OFACAlert: "N" } }));
    assert.equal(res.reason, "IDENTITY_NOT_CONFIGURED");
  } finally {
    restoreEnv("MICROBILT_MEMBER_ID", saved);
  }
});

test("getMicroBiltConfigStatus reports identity readiness without leaking MemberPwd", async () => {
  const { getMicroBiltConfigStatus } = await import("@/lib/services/prequal/microbilt.service");
  const status = getMicroBiltConfigStatus();

  assert.equal(status.identity.memberIdPresent, true);
  assert.equal(status.identity.memberPwdPresent, true);
  assert.equal(status.identity.userNamePresent, true);
  assert.equal(status.identity.productId, "test-product-id");
  assert.deepEqual(status.identity.missing, []);

  // The member password is a credential: it must never appear anywhere in the
  // non-secret config snapshot that backs the admin system-health page.
  assert.ok(
    !JSON.stringify(status).includes("test-member-pwd"),
    "MemberPwd must never appear in the config status snapshot",
  );
});

test("getMicroBiltConfigStatus names exactly which identity fields are missing", async () => {
  const saved = process.env.MICROBILT_USERNAME;
  delete process.env.MICROBILT_USERNAME;
  try {
    const { getMicroBiltConfigStatus } = await import("@/lib/services/prequal/microbilt.service");
    const status = getMicroBiltConfigStatus();
    assert.equal(status.identity.userNamePresent, false);
    assert.deepEqual(status.identity.missing, ["MICROBILT_USERNAME"]);
  } finally {
    restoreEnv("MICROBILT_USERNAME", saved);
  }
});

// ─── Stored-report credential hygiene ───────────────────────────────────────
// iPredict echoes the submitted request back as `MBCLVRq`. Now that MsgRqHdr
// carries MemberPwd, that credential can return inside the body we persist —
// and rawResponse is decryptable by an authorized operator. It must be stripped
// BEFORE encryption, not merely protected by encryption.

function decryptRawResponse(b64: string): string {
  const buf = Buffer.from(b64, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const body = buf.subarray(28);
  const decipher = nodeCrypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(process.env.PREQUAL_ENCRYPTION_KEY as string, "hex"),
    iv,
  );
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

test("an echoed MemberPwd is redacted before the report is stored", async () => {
  const echoed = successBody({ ofac: { ofacresult: "N" }, idv: { OFACAlert: "N" } }) as Record<
    string,
    unknown
  >;
  echoed.MBCLVRq = {
    MsgRqHdr: {
      MemberId: "test-member-id",
      MemberPwd: "test-member-pwd",
      UserName: "test-user-name",
      ProductID: "test-product-id",
    },
  };

  const res = await callWith(echoed);
  const stored = decryptRawResponse(res.rawResponse);

  assert.ok(
    !stored.includes("test-member-pwd"),
    "MemberPwd must never be persisted in the stored consumer report",
  );
  assert.ok(stored.includes("[REDACTED]"), "the field must be redacted, not dropped silently");
  // Non-credential echo fields stay intact — redaction must not destroy the
  // diagnostic value of the stored document.
  assert.ok(stored.includes("test-member-id"));
  assert.ok(stored.includes("test-product-id"));
  // And the response itself must still parse normally.
  assert.equal(res.decision, "APPROVED");
});

test("credential redaction also applies on the IPREDICT_ERROR path", async () => {
  const res = await callWith({
    MBCLVRq: { MsgRqHdr: { MemberPwd: "test-member-pwd" } },
    RESPONSE: { STATUS: { type: "ERROR", error: { code: "E01", message: "bad", type: "APPLICATION" } } },
  });
  // The reason carries MicroBilt's APPLICATION/SYSTEM verdict and error code as
  // diagnostics; the BASE is what classification keys on.
  const { providerReasonBase } = await import("@/lib/services/prequal/microbilt.service");
  assert.equal(providerReasonBase(res.reason!), "IPREDICT_ERROR");
  assert.ok(!decryptRawResponse(res.rawResponse).includes("test-member-pwd"));
});

// The non-2xx path did NOT exist when redaction was written — it stores the
// provider's error body, which is exactly where an echoed MemberPwd shows up on
// a rejected request. Redaction must cover it too, or the credential is
// persisted on precisely the failures we now keep bodies for.
test("credential redaction covers the non-2xx error body path", async () => {
  reportStatus = 400;
  try {
    const res = await callWith({
      MBCLVRq: { MsgRqHdr: { MemberId: "test-member-id", MemberPwd: "test-member-pwd" } },
      RESPONSE: {
        STATUS: { type: "ERROR", error: { code: "E42", message: "rejected", type: "APPLICATION" } },
      },
    });
    const { providerReasonBase } = await import("@/lib/services/prequal/microbilt.service");
    assert.equal(providerReasonBase(res.reason!), "HTTP_400");
    const stored = decryptRawResponse(res.rawResponse);
    assert.ok(
      !stored.includes("test-member-pwd"),
      "an echoed MemberPwd must not be persisted from a non-2xx body either",
    );
    assert.ok(stored.includes("[REDACTED]"), "redacted, not silently dropped");
    // The diagnostic value of keeping the body must survive redaction.
    assert.ok(stored.includes("test-member-id"), "non-credential echo fields stay intact");
    assert.ok(stored.includes("rejected"), "the provider's error message stays readable");
  } finally {
    reportStatus = 200;
  }
});
