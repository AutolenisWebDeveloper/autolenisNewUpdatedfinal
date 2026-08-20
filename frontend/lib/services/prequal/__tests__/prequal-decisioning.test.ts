// Decisioning + persistence proof for the prequal orchestrator, against a MOCK
// iPredict result (callIPredict is stubbed — NO live pull). Asserts the decision
// gates, the fail-closed OFAC routing, and that the persisted record + side
// effects (approval email, OFAC ops alert) match the decision.
//
// Red-first: the INDETERMINATE-OFAC case asserts an otherwise-APPROVED result
// with `ofacFlagged === null` is NOT persisted as APPROVED — the hard OFAC gate
// is fail-closed on "we don't know", not just on a positive hit.
//
// Run: pnpm test   (globs lib/services/prequal/__tests__/*.test.ts)

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PreQualDecision, PreQualTier } from "@prisma/client";

interface Captured {
  ipredict: Record<string, unknown>;
  upserts: Array<Record<string, unknown>>;
  notifications: Array<Record<string, unknown>>;
  compliance: Array<Record<string, unknown>>;
  approvedEmails: number;
  adverseEmails: number;
  underReviewEmails: number;
  adminAlerts: Array<Record<string, unknown>>;
}

const cap: Captured = {
  ipredict: {},
  upserts: [],
  notifications: [],
  compliance: [],
  approvedEmails: 0,
  adverseEmails: 0,
  underReviewEmails: 0,
  adminAlerts: [],
};

// A complete IPredicResult with sensible defaults; per-test overrides tune the
// fields the gates read (decision / ofacFlagged / tier / risk flags).
function ipredictResult(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    decision: PreQualDecision.APPROVED,
    tier: PreQualTier.GOOD,
    maxOtdAmountCents: 4_200_000,
    recommendedLoanAmountCents: 4_200_000,
    maxLoanAmountCents: 5_000_000,
    ofacFlagged: false,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    rawResponse: "enc",
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

mock.module("@/lib/services/prequal/microbilt.service", {
  namedExports: {
    callIPredict: async () => cap.ipredict,
    FCRA_CONSENT_TEXT: "consent",
  },
});

const prismaMock = {
  preQualification: {
    findUnique: async () => null, // no existing prequal
    create: async () => ({ id: "pq_1", decision: "PENDING", updatedAt: new Date() }),
    updateMany: async () => ({ count: 1 }),
    findUniqueOrThrow: async () => ({ id: "pq_1" }),
    upsert: async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
      cap.upserts.push(args.update);
      return { id: "pq_1", updatedAt: new Date(), adverseReasonCodes: [], ...args.update };
    },
  },
  prequalConsent: { create: async () => ({ id: "c_1" }) },
  notification: { create: async (a: { data: Record<string, unknown> }) => { cap.notifications.push(a.data); return {}; } },
  complianceEvent: { create: async (a: { data: Record<string, unknown> }) => { cap.compliance.push(a.data); return {}; } },
  buyer: { findUnique: async () => null }, // skip CRM sync block
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const { prisma } = await import("@/lib/prisma");
    return fn(prisma);
  },
};
mock.module("@/lib/prisma", { namedExports: { prisma: prismaMock } });

mock.module("@/lib/services/email/resend.service", {
  namedExports: {
    sendPrequalApprovedEmail: async () => { cap.approvedEmails++; },
    sendAdverseActionEmail: async () => { cap.adverseEmails++; return { outcome: "SENT" as const }; },
    sendPrequalUnderReviewEmail: async () => { cap.underReviewEmails++; },
    sendAdminPrequalAlertEmail: async (a: Record<string, unknown>) => { cap.adminAlerts.push(a); },
  },
});

const BUYER = { id: "buyer_1", maxOtdAmountCents: 3_000_000, user: { email: "b@example.com" } };
const INPUT = {
  firstName: "Jane", lastName: "Doe", dateOfBirth: "01/15/1990",
  address: "123 Main St", city: "Austin", state: "TX", zip: "78701",
  fcraConsent: true, monthlyIncomeCents: 1_500_000, employmentStatus: "FULL_TIME",
};

async function run(resultOverrides: Record<string, unknown>) {
  cap.ipredict = ipredictResult(resultOverrides);
  const { initiatePrsequal } = await import("@/lib/services/prequal/prequal.service");
  return initiatePrsequal(BUYER, INPUT);
}

beforeEach(() => {
  cap.upserts = [];
  cap.notifications = [];
  cap.compliance = [];
  cap.approvedEmails = 0;
  cap.adverseEmails = 0;
  cap.underReviewEmails = 0;
  cap.adminAlerts = [];
});

test("APPROVED + OFAC cleared ⇒ persists APPROVED, sets budget, sends approval email", async () => {
  await run({ decision: PreQualDecision.APPROVED, ofacFlagged: false });
  const persisted = cap.upserts[0]!;
  assert.equal(persisted.decision, "APPROVED");
  assert.equal(persisted.maxOtdAmountCents, 4_200_000);
  assert.equal(persisted.checkOfacAlert, false);
  assert.equal(cap.approvedEmails, 1);
});

test("INDETERMINATE OFAC (null) on an APPROVED result ⇒ NEVER persisted APPROVED (fail-closed)", async () => {
  await run({ decision: PreQualDecision.APPROVED, ofacFlagged: null });
  const persisted = cap.upserts[0]!;
  assert.notEqual(persisted.decision, "APPROVED", "an approval must never be issued without an affirmative OFAC clear");
  assert.equal(persisted.maxOtdAmountCents, 0, "no budget granted under indeterminate OFAC");
  assert.equal(cap.approvedEmails, 0, "no approval email under indeterminate OFAC");
});

test("OFAC hit (true) ⇒ OFAC_REVIEW + ops notification, no budget", async () => {
  await run({ decision: PreQualDecision.APPROVED, ofacFlagged: true });
  const persisted = cap.upserts[0]!;
  assert.equal(persisted.decision, "OFAC_REVIEW");
  assert.equal(persisted.checkOfacAlert, true);
  assert.equal(persisted.maxOtdAmountCents, 0);
  assert.ok(
    cap.notifications.some((n) => String(n.title).includes("OFAC")),
    "an OFAC ops alert notification is created",
  );
});

test("DECLINED ⇒ persists DECLINED, sends adverse-action email, logs compliance event", async () => {
  await run({ decision: PreQualDecision.DECLINED, ofacFlagged: false, maxOtdAmountCents: 0, tier: null, adverseReasonCodes: ["038"] });
  const persisted = cap.upserts[0]!;
  assert.equal(persisted.decision, "DECLINED");
  assert.equal(cap.adverseEmails, 1);
  assert.ok(cap.compliance.some((c) => String(c.eventType).startsWith("ADVERSE_ACTION_NOTICE")));
});

test("Deceased indicator ⇒ MANUAL_REVIEW + under-review email + admin alert", async () => {
  await run({ decision: PreQualDecision.APPROVED, ofacFlagged: false, deceasedFlag: true });
  const persisted = cap.upserts[0]!;
  assert.equal(persisted.decision, "MANUAL_REVIEW");
  assert.equal(cap.underReviewEmails, 1);
});

test("MLA covered borrower ⇒ MANUAL_REVIEW", async () => {
  await run({ decision: PreQualDecision.APPROVED, ofacFlagged: false, mlaCovered: true });
  assert.equal(cap.upserts[0]!.decision, "MANUAL_REVIEW");
});

test("Credit-DECLINED with INDETERMINATE OFAC ⇒ stays DECLINED (Gate 1b is scoped to APPROVED)", async () => {
  await run({ decision: PreQualDecision.DECLINED, ofacFlagged: null, maxOtdAmountCents: 0, tier: null, adverseReasonCodes: ["038"] });
  const persisted = cap.upserts[0]!;
  assert.equal(persisted.decision, "DECLINED", "an indeterminate OFAC must not silently upgrade a decline");
  assert.equal(cap.adverseEmails, 1);
});

test("Provider error result (reason set) ⇒ admin PROVIDER_ERROR alert fires", async () => {
  await run({ decision: PreQualDecision.MANUAL_REVIEW, ofacFlagged: null, reason: "TIMEOUT", maxOtdAmountCents: 0, tier: null });
  assert.ok(cap.adminAlerts.some((a) => a.kind === "PROVIDER_ERROR"), "provider error routes an admin alert");
});
