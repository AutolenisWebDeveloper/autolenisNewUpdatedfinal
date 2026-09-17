// §27.1 — WHAT THE BUYER IS TOLD WHEN THEIR PREQUALIFICATION IS HELD.
//
// A MicroBilt failure and a compliance hold both land at MANUAL_REVIEW — correctly, because
// the decision is fail-closed either way — and until Phase 10 both produced the SAME buyer
// notice: "one of our team is looking at it now". For a provider failure that is false.
// Nobody is looking, because the provider returned nothing to look at, and the buyer was
// given a reassuring account of a state that did not exist.
//
// §27.1 has always carried a separate row for it (`prequal_provider_delay`) and the registry
// has always carried its recheck. Nothing enqueued it. This pins the branch, and pins the
// §26 row that makes each stranded application somebody's work rather than a line in an
// outage alert.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/prequal/__tests__/prequal-provider-delay-notice.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PreQualDecision, PreQualTier } from "@prisma/client";
import { isProviderErrorReason, classifyProviderFailure } from "@/lib/services/prequal/microbilt.service";

type Rec = Record<string, unknown>;

let ipredict: Rec;
let enqueued: Rec[];
let raised: Rec[];

function result(overrides: Rec): Rec {
  return {
    decision: PreQualDecision.APPROVED,
    tier: PreQualTier.GOOD,
    maxOtdAmountCents: 4_200_000,
    recommendedLoanAmountCents: 4_200_000,
    maxLoanAmountCents: 5_000_000,
    ofacFlagged: false,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    rawResponse: "BLOB",
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

/** The adapter's own shape for a provider failure: no scores, no OFAC answer, zero budget. */
const providerFailure = (reason: string): Rec =>
  result({
    decision: PreQualDecision.MANUAL_REVIEW,
    tier: null,
    maxOtdAmountCents: 0,
    recommendedLoanAmountCents: null,
    maxLoanAmountCents: null,
    ofacFlagged: null,
    reason,
    creditScore: null,
    idvScore: null,
  });

/** A genuine compliance hold: the provider ANSWERED and the answer needs a human. */
const riskReview = (): Rec => result({ decision: PreQualDecision.MANUAL_REVIEW, deceasedFlag: true });

mock.module("@/lib/services/prequal/microbilt.service", {
  namedExports: {
    callIPredict: async () => ipredict,
    FCRA_CONSENT_TEXT: "consent",
    isProviderErrorReason,
    classifyProviderFailure,
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      preQualification: {
        findUnique: async () => null,
        create: async () => ({ id: "pq_1", decision: "PENDING", updatedAt: new Date() }),
        updateMany: async () => ({ count: 1 }),
        findUniqueOrThrow: async () => ({ id: "pq_1" }),
        upsert: async (a: { update: Rec }) => ({ id: "pq_1", updatedAt: new Date(), adverseReasonCodes: [], ...a.update }),
      },
      prequalConsent: { create: async () => ({ id: "c_1" }) },
      notification: { create: async () => ({}) },
      complianceEvent: { create: async () => ({}), count: async () => 0 },
      buyer: { findUnique: async () => null, updateMany: async () => ({ count: 1 }) },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const { prisma } = await import("@/lib/prisma");
        return fn(prisma);
      },
    },
  },
});

mock.module("@/lib/services/email/resend.service", {
  namedExports: {
    sendPrequalApprovedEmail: async () => {},
    sendAdverseActionEmail: async () => ({ outcome: "SENT" as const }),
    sendAdminPrequalAlertEmail: async () => {},
  },
});
mock.module("@/lib/services/monitoring/health-alert.service", {
  namedExports: { createAlert: async () => ({}), createAlertOnce: async () => ({}) },
});
mock.module("@/lib/services/comms/transactional-dispatcher.service", {
  namedExports: {
    enqueueTransactional: async (input: Rec) => { enqueued.push(input); return { enqueued: true }; },
  },
});
mock.module("@/lib/services/operations/queue-item.service", {
  namedExports: { raiseException: async (input: Rec) => { raised.push(input); return { created: true }; } },
});
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

const BUYER = { id: "buyer_1", maxOtdAmountCents: 3_000_000, user: { email: "b@example.invalid" } };
const INPUT = {
  firstName: "Jane", lastName: "Doe", dateOfBirth: "01/15/1990",
  address: "123 Main St", city: "Austin", state: "TX", zip: "78701",
  fcraConsent: true, monthlyIncomeCents: 1_500_000, employmentStatus: "FULL_TIME",
};

beforeEach(() => { enqueued = []; raised = []; });

async function run(r: Rec) {
  ipredict = r;
  const { initiatePrsequal } = await import("@/lib/services/prequal/prequal.service");
  return initiatePrsequal(BUYER, INPUT);
}

const buyerNotices = () =>
  enqueued.filter((e) => e.recipientKind === "buyer").map((e) => e.templateKey as string);

test("a PROVIDER FAILURE sends the delay notice, not the under-review notice", async () => {
  await run(providerFailure("TIMEOUT"));

  assert.deepEqual(
    buyerNotices(),
    ["prequal_provider_delay"],
    'the buyer is told their application is still processing — NOT that "one of our team is looking at it"',
  );
});

test("a RISK review still sends the under-review notice — a person really is looking", async () => {
  await run(riskReview());
  assert.deepEqual(buyerNotices(), ["prequal_under_review"]);
});

test("ONE notice, never both — they describe opposite states", async () => {
  await run(providerFailure("HTTP_401"));
  assert.equal(
    buyerNotices().length,
    1,
    "telling the same buyer in the same minute that a person is reviewing their file and that nobody " +
      "has looked at it yet is worse than either message alone",
  );
});

test("each stranded application gets its own §26 row, keyed on the application", async () => {
  await run(providerFailure("EMPTY_RESPONSE"));

  const delay = raised.find((r) => r.code === "PREQUAL_PROVIDER_DELAY");
  assert.ok(delay, "the outage alert is a page about an integration; this is the row for THIS application");
  assert.equal(delay!.buyerId, "buyer_1");
  assert.equal(delay!.idempotencyKey, "PREQUAL_PROVIDER_DELAY:pq_1");
});

test("PRIVACY — the §26 row carries no consumer-report data", async () => {
  await run(providerFailure("UNPARSEABLE_RESPONSE"));
  const delay = raised.find((r) => r.code === "PREQUAL_PROVIDER_DELAY")!;
  const blob = JSON.stringify(delay);

  for (const leak of ["Jane", "Doe", "01/15/1990", "123 Main St", "78701", "712", "1500000"]) {
    assert.ok(!blob.includes(leak), `the queue row leaked ${leak} — prequal data is FCRA-protected`);
  }
});

test("a risk review raises the manual-review row and NOT the provider-delay row", async () => {
  await run(riskReview());
  const codes = raised.map((r) => r.code);
  assert.ok(codes.includes("PREQUAL_MANUAL_OR_OFAC_REVIEW"));
  assert.ok(!codes.includes("PREQUAL_PROVIDER_DELAY"), "the provider answered; nothing is delayed");
});

test("an APPROVED decision sends the APPROVAL notice and neither hold notice", async () => {
  await run(result({}));
  assert.deepEqual(
    buyerNotices().filter((k) => k.startsWith("prequal_")),
    ["prequal_approved"],
    "the decision notice IS the outcome — and it is neither a delay nor a review",
  );
  const codes = raised.map((r) => r.code);
  assert.ok(!codes.includes("PREQUAL_PROVIDER_DELAY"));
  assert.ok(!codes.includes("PREQUAL_MANUAL_OR_OFAC_REVIEW"));
});
