// Observability proof for the prequal orchestrator: a MicroBilt PROVIDER
// FAILURE must be recorded and alerted DISTINCTLY from a genuine risk-triggered
// manual review — while the fail-closed decision itself stays exactly as it is.
//
// Regression target: for ~8 weeks every real buyer prequal landed as a plain
// MANUAL_REVIEW because MicroBilt returned no usable data. A provider outage and
// a compliance hold were the same row, the same buyer email, and the same admin
// queue entry, so nothing ever signalled that the integration was down — the
// only alert was a fire-and-forget email that is silently skipped when
// ADMIN_NOTIFICATION_EMAIL is unset, leaving no durable record anywhere.
//
// What is asserted here:
//   1. provider failure  ⇒ a PREQUAL_PROVIDER_FAILURE compliance event AND an
//      operational alert on the existing PlatformAlert rail;
//   2. risk manual review ⇒ NEITHER (an operator must not be paged for a
//      buyer who is legitimately held for compliance review);
//   3. approval          ⇒ NEITHER, and the approval path is untouched;
//   4. fail-closed is preserved on every provider-failure path;
//   5. no credit/identity PII leaves the prequal row in the event or alert.
//
// Run: pnpm test   (globs lib/services/prequal/__tests__/*.test.ts)

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PreQualDecision, PreQualTier } from "@prisma/client";
// Imported BEFORE mock.module below, so the orchestrator is exercised against
// the REAL reason classifier rather than a test-local restatement of it.
import {
  isProviderErrorReason,
  classifyProviderFailure,
} from "@/lib/services/prequal/microbilt.service";

// Stands in for the AES-256-GCM consumer-report blob. A distinctive value so
// the privacy assertion below cannot pass by accident on a short substring.
const RAW_REPORT_SENTINEL = "ENCRYPTED_CONSUMER_REPORT_BLOB_SENTINEL";

interface Captured {
  ipredict: Record<string, unknown>;
  upserts: Array<Record<string, unknown>>;
  compliance: Array<Record<string, unknown>>;
  alerts: Array<{ level: string; title: string; body: string; source: string }>;
  adminAlerts: Array<Record<string, unknown>>;
  providerFailureCounts: number;
}

const cap: Captured = {
  ipredict: {},
  upserts: [],
  compliance: [],
  alerts: [],
  adminAlerts: [],
  providerFailureCounts: 0,
};

function ipredictResult(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    decision: PreQualDecision.APPROVED,
    tier: PreQualTier.GOOD,
    maxOtdAmountCents: 4_200_000,
    recommendedLoanAmountCents: 4_200_000,
    maxLoanAmountCents: 5_000_000,
    ofacFlagged: false,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    rawResponse: RAW_REPORT_SENTINEL,
    mocked: false,
    creditScore: 712,
    idvScore: 95,
    mlaCovered: false,
    fraudWarning: null,
    adverseReasonCodes: [],
    deceasedFlag: false,
    bankruptcyFlag: false,
    highRiskAddressFlag: false,
    frontEndDtiBps: 1200,
    backEndDtiBps: 2600,
    benchmarkAprBps: 850,
    totalMonthlyObligationsCents: 0,
    effectiveIncomeCents: 1_500_000,
    ...overrides,
  };
}

// A provider failure as the adapter actually returns it: no scores, no DTI, no
// OFAC answer, zero budget — exactly the all-null row shape seen in production.
function providerFailure(reason: string): Record<string, unknown> {
  return ipredictResult({
    decision: PreQualDecision.MANUAL_REVIEW,
    tier: null,
    maxOtdAmountCents: 0,
    recommendedLoanAmountCents: null,
    maxLoanAmountCents: null,
    ofacFlagged: null,
    reason,
    creditScore: null,
    idvScore: null,
    mlaCovered: null,
    frontEndDtiBps: undefined,
    backEndDtiBps: undefined,
    benchmarkAprBps: undefined,
    effectiveIncomeCents: undefined,
  });
}

mock.module("@/lib/services/prequal/microbilt.service", {
  namedExports: {
    callIPredict: async () => cap.ipredict,
    FCRA_CONSENT_TEXT: "consent",
    isProviderErrorReason,
    classifyProviderFailure,
  },
});

const prismaMock = {
  preQualification: {
    findUnique: async () => null,
    create: async () => ({ id: "pq_1", decision: "PENDING", updatedAt: new Date() }),
    updateMany: async () => ({ count: 1 }),
    findUniqueOrThrow: async () => ({ id: "pq_1" }),
    upsert: async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
      cap.upserts.push(args.update);
      return { id: "pq_1", updatedAt: new Date(), adverseReasonCodes: [], ...args.update };
    },
  },
  prequalConsent: { create: async () => ({ id: "c_1" }) },
  notification: { create: async () => ({}) },
  complianceEvent: {
    create: async (a: { data: Record<string, unknown> }) => {
      cap.compliance.push(a.data);
      return {};
    },
    count: async () => cap.providerFailureCounts,
  },
  buyer: {
    findUnique: async () => null,
    // Fix 1 — the orchestrator backfills city/state/zip via conditional updateMany.
    updateMany: async () => ({ count: 1 }),
  },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const { prisma } = await import("@/lib/prisma");
    return fn(prisma);
  },
};
mock.module("@/lib/prisma", { namedExports: { prisma: prismaMock } });

mock.module("@/lib/services/email/resend.service", {
  namedExports: {
    sendPrequalApprovedEmail: async () => {},
    sendAdverseActionEmail: async () => ({ outcome: "SENT" as const }),
    sendPrequalUnderReviewEmail: async () => {},
    sendAdminPrequalAlertEmail: async (a: Record<string, unknown>) => {
      cap.adminAlerts.push(a);
    },
  },
});

mock.module("@/lib/services/monitoring/health-alert.service", {
  namedExports: {
    createAlert: async (level: string, title: string, body: string, source: string) => {
      cap.alerts.push({ level, title, body, source });
      return {};
    },
    createAlertOnce: async (level: string, title: string, body: string, source: string) => {
      cap.alerts.push({ level, title, body, source });
      return {};
    },
  },
});

const BUYER = { id: "buyer_1", maxOtdAmountCents: 3_000_000, user: { email: "b@example.com" } };
const INPUT = {
  firstName: "Jane",
  lastName: "Doe",
  dateOfBirth: "01/15/1990",
  address: "123 Main St",
  city: "Austin",
  state: "TX",
  zip: "78701",
  fcraConsent: true,
  monthlyIncomeCents: 1_500_000,
  employmentStatus: "FULL_TIME",
};

const PROVIDER_FAILURE_EVENT = "PREQUAL_PROVIDER_FAILURE";

async function run(result: Record<string, unknown>) {
  cap.ipredict = result;
  const { initiatePrsequal } = await import("@/lib/services/prequal/prequal.service");
  return initiatePrsequal(BUYER, INPUT);
}

function providerFailureEvents() {
  return cap.compliance.filter((c) => c.eventType === PROVIDER_FAILURE_EVENT);
}

beforeEach(() => {
  cap.upserts = [];
  cap.compliance = [];
  cap.alerts = [];
  cap.adminAlerts = [];
  cap.providerFailureCounts = 0;
});

// ── 1. Provider failure is recorded and alerted ──────────────────────────────

for (const reason of [
  "TIMEOUT",
  "HTTP_401",
  "EMPTY_RESPONSE",
  "UNPARSEABLE_RESPONSE",
  "OAUTH_FAILED",
  "CONFIG_ERROR",
]) {
  test(`provider failure (${reason}) ⇒ PREQUAL_PROVIDER_FAILURE event + operational alert`, async () => {
    await run(providerFailure(reason));

    const events = providerFailureEvents();
    assert.equal(events.length, 1, "exactly one provider-failure compliance event is written");
    assert.equal(
      (events[0]!.metadata as Record<string, unknown>).providerReason,
      reason,
      "the event records WHICH provider failure occurred",
    );
    assert.equal(events[0]!.prequalApplicationId, "pq_1", "the event is joined to the prequal row");

    assert.ok(
      cap.alerts.length >= 1,
      "a provider failure raises an operational exception on the PlatformAlert rail",
    );
    assert.ok(
      cap.alerts.every((a) => a.source === "prequal-microbilt"),
      "the alert is attributed to the MicroBilt prequal integration",
    );
  });
}

test("provider failure stays fail-closed — never approved, no fabricated budget/tier", async () => {
  await run(providerFailure("HTTP_401"));
  const persisted = cap.upserts[0]!;
  assert.equal(persisted.decision, "MANUAL_REVIEW", "a provider failure must never approve");
  assert.equal(persisted.maxOtdAmountCents, 0, "no budget is fabricated");
  assert.equal(persisted.tier, null, "no tier is fabricated");
  assert.equal(persisted.creditScore, null, "no score is fabricated");
  assert.equal(persisted.checkOfacAlert, false, "a missing OFAC answer is not an OFAC alert");
});

test("a total outage escalates: repeated provider failures raise P0, a single one P1", async () => {
  cap.providerFailureCounts = 0;
  await run(providerFailure("HTTP_401"));
  assert.equal(cap.alerts[0]!.level, "P1", "an isolated failure is P1");

  cap.compliance = [];
  cap.alerts = [];
  cap.providerFailureCounts = 25; // sustained, platform-wide failure
  await run(providerFailure("HTTP_401"));
  assert.equal(cap.alerts[0]!.level, "P0", "a sustained total failure is owner-visible as P0");
});

// ── 2. A genuine risk review is NOT a provider failure ───────────────────────

test("risk-triggered MANUAL_REVIEW (deceased flag) ⇒ NO provider-failure event, NO alert", async () => {
  await run(ipredictResult({ decision: PreQualDecision.APPROVED, ofacFlagged: false, deceasedFlag: true }));
  const persisted = cap.upserts[0]!;
  assert.equal(persisted.decision, "MANUAL_REVIEW", "the risk gate still holds the buyer");
  assert.equal(providerFailureEvents().length, 0, "a compliance hold is not an integration outage");
  assert.equal(cap.alerts.length, 0, "an operator is not paged for a legitimate risk review");
});

test("OFAC hit ⇒ NO provider-failure event (the provider answered; the buyer is flagged)", async () => {
  await run(ipredictResult({ decision: PreQualDecision.APPROVED, ofacFlagged: true }));
  assert.equal(cap.upserts[0]!.decision, "OFAC_REVIEW");
  assert.equal(providerFailureEvents().length, 0);
  assert.equal(cap.alerts.length, 0);
});

test("indeterminate OFAC on an otherwise-approved result ⇒ risk review, not a provider failure", async () => {
  await run(ipredictResult({ decision: PreQualDecision.APPROVED, ofacFlagged: null }));
  assert.notEqual(cap.upserts[0]!.decision, "APPROVED", "fail-closed OFAC gate is preserved");
  assert.equal(
    providerFailureEvents().length,
    0,
    "the provider replied; only the OFAC signal was absent — not an outage",
  );
});

test("business DECLINE below the income minimum is not a provider failure", async () => {
  await run(
    ipredictResult({
      decision: PreQualDecision.DECLINED,
      reason: "INCOME_BELOW_MINIMUM",
      maxOtdAmountCents: 0,
      tier: null,
      adverseReasonCodes: ["038"],
    }),
  );
  assert.equal(cap.upserts[0]!.decision, "DECLINED");
  assert.equal(providerFailureEvents().length, 0, "a real decline is a decision, not an outage");
  assert.equal(cap.alerts.length, 0);
});

// ── 3. Approval path untouched ───────────────────────────────────────────────

test("APPROVED ⇒ no provider-failure event, no alert, budget intact", async () => {
  await run(ipredictResult({ decision: PreQualDecision.APPROVED, ofacFlagged: false }));
  const persisted = cap.upserts[0]!;
  assert.equal(persisted.decision, "APPROVED");
  assert.equal(persisted.maxOtdAmountCents, 4_200_000);
  assert.equal(providerFailureEvents().length, 0);
  assert.equal(cap.alerts.length, 0);
});

// ── 4. Privacy: prequal data is sensitive PII ────────────────────────────────

test("neither the compliance event nor the alert carries credit/identity PII", async () => {
  await run(providerFailure("HTTP_401"));

  const serialisedEvent = JSON.stringify(providerFailureEvents());
  const serialisedAlerts = JSON.stringify(cap.alerts);

  for (const [label, blob] of [
    ["provider-failure event", serialisedEvent],
    ["operational alert", serialisedAlerts],
  ] as const) {
    for (const forbidden of [
      INPUT.firstName,
      INPUT.lastName,
      INPUT.dateOfBirth,
      INPUT.address,
      INPUT.zip,
      String(INPUT.monthlyIncomeCents),
      RAW_REPORT_SENTINEL, // the consumer report must never be copied out of the row
    ]) {
      assert.ok(
        !blob.includes(forbidden),
        `${label} must not carry consumer PII (found "${forbidden}")`,
      );
    }
  }
  // The buyer's email identifies a consumer credit applicant — the alert body is
  // read by ops tooling, so it must reference the buyer by opaque id only.
  assert.ok(
    !serialisedAlerts.includes(BUYER.user.email),
    "the operational alert must not carry the buyer's email address",
  );
});

// ── 6. "Our request is wrong" vs "their service blipped" ────────────────────
// Both were recorded identically, so an operator paged at 2am could not tell a
// permanently malformed request (which no amount of waiting fixes) from a
// transient provider outage (which needs nobody). MicroBilt's own
// RESPONSE.STATUS.error.type drives the distinction where it gives one.

const FAILURE_CLASS_CASES: Array<[string, string]> = [
  ["HTTP_400:APPLICATION:MB1042", "REQUEST_REJECTED"],
  ["IPREDICT_ERROR:APPLICATION:MB2001", "REQUEST_REJECTED"],
  ["REPORT_URL_INVALID", "REQUEST_REJECTED"],
  ["CONFIG_ERROR", "REQUEST_REJECTED"],
  ["IPREDICT_ERROR:SYSTEM:MB9000", "PROVIDER_UNAVAILABLE"],
  ["HTTP_503", "PROVIDER_UNAVAILABLE"],
  ["TIMEOUT", "PROVIDER_UNAVAILABLE"],
  ["OAUTH_FAILED", "UNKNOWN"],
  ["EMPTY_RESPONSE", "UNKNOWN"],
];

for (const [reason, expectedClass] of FAILURE_CLASS_CASES) {
  test(`compliance event records the failure class for ${reason} (${expectedClass})`, async () => {
    await run(providerFailure(reason));
    const metadata = providerFailureEvents()[0]!.metadata as Record<string, unknown>;
    assert.equal(metadata.providerReason, reason, "the exact reason is preserved");
    assert.equal(
      metadata.providerFailureClass,
      expectedClass,
      "ops must be able to tell a malformed request from a transient outage",
    );
  });
}

test("a malformed-request failure says so in the alert an operator actually reads", async () => {
  await run(providerFailure("HTTP_400:APPLICATION:MB1042"));
  const body = cap.alerts.map((a) => a.body).join("\n");
  assert.match(body, /HTTP_400:APPLICATION:MB1042/, "the alert names the exact reason");
  assert.match(
    body,
    /retry/i,
    "the alert states whether retrying can help — that is the operator's first question",
  );
  assert.ok(
    !/JANE|DOE|123 MAIN|712/i.test(body),
    "no consumer PII or credit data reaches the alert body",
  );
});

test("a transient failure is described as retryable, not as a broken request", async () => {
  await run(providerFailure("IPREDICT_ERROR:SYSTEM:MB9000"));
  const body = cap.alerts.map((a) => a.body).join("\n");
  assert.match(body, /IPREDICT_ERROR:SYSTEM:MB9000/);
  assert.ok(
    !/cannot be fixed by retrying/i.test(body),
    "a transient outage must not be reported as a permanent request defect",
  );
});

test("detail-suffixed reasons are still recognised as provider failures end to end", async () => {
  await run(providerFailure("HTTP_400:APPLICATION:MB1042"));
  assert.equal(
    providerFailureEvents().length,
    1,
    "adding a diagnostic suffix must never stop a failure from being recorded",
  );
  assert.ok(cap.alerts.length >= 1, "…nor from raising the operational exception");
});
