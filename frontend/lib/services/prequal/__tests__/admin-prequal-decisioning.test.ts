// Decisioning proof for the ADMIN-initiated iPredict pipeline
// (runAdminIPredictPrequalForBuyer), against a MOCK iPredict result — NO live
// pull. This pipeline is structurally parallel to the buyer path and must apply
// the SAME fail-closed OFAC gate. Red-first: an APPROVED result with indeterminate
// OFAC (ofacFlagged === null) must NEVER persist as APPROVED here either.
//
// Run: pnpm test   (globs lib/services/prequal/__tests__/*.test.ts)

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PreQualDecision, PreQualTier } from "@prisma/client";

const cap = {
  ipredict: {} as Record<string, unknown>,
  upserts: [] as Array<Record<string, unknown>>,
  notifications: [] as Array<Record<string, unknown>>,
  approvedEmails: 0,
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
  namedExports: { callIPredict: async () => cap.ipredict, FCRA_CONSENT_TEXT: "consent" },
});
mock.module("@/lib/services/prequal/prequal.service", {
  namedExports: { isPrequalValid: () => false },
});

const prismaMock = {
  buyer: {
    findUnique: async () => ({
      id: "buyer_1",
      firstName: "Jane",
      user: { email: "b@example.com" },
      preQualification: null,
    }),
  },
  prequalConsent: {
    findFirst: async () => ({ id: "consent_1", buyerId: "buyer_1", acceptedAt: new Date() }),
    create: async () => ({ id: "consent_2" }),
  },
  adminAuditLog: { create: async () => ({ id: "audit_1" }) },
  notification: { create: async (a: { data: Record<string, unknown> }) => { cap.notifications.push(a.data); return {}; } },
  complianceEvent: { create: async () => ({}) },
  preQualification: {
    upsert: async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
      cap.upserts.push(args.update);
      return { id: "pq_1", updatedAt: new Date(), adverseReasonCodes: [], ...args.update };
    },
  },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const { prisma } = await import("@/lib/prisma");
    return fn(prisma);
  },
};
mock.module("@/lib/prisma", { namedExports: { prisma: prismaMock } });

mock.module("@/lib/services/email/resend.service", {
  namedExports: {
    sendPrequalApprovedEmail: async () => { cap.approvedEmails++; },
    sendAdverseActionEmail: async () => ({ outcome: "SENT" as const }),
    sendPrequalUnderReviewEmail: async () => {},
    sendAdminPrequalAlertEmail: async () => {},
  },
});

const ARGS = {
  buyerId: "buyer_1",
  adminId: "admin_1",
  adminEmail: "admin@autolenis.com",
  input: {
    firstName: "Jane", lastName: "Doe", dateOfBirth: "01/15/1990",
    address: "123 Main St", city: "Austin", state: "TX", zip: "78701",
    monthlyIncomeCents: 1_500_000,
  },
  reason: "buyer authorized by phone",
  consentSource: "EXISTING_PREQUAL_CONSENT" as const,
  consentTimestamp: new Date().toISOString(),
  authorizationSummary: "existing in-platform consent",
  adminCertification: true as const,
};

async function run(resultOverrides: Record<string, unknown>) {
  cap.ipredict = ipredictResult(resultOverrides);
  const { runAdminIPredictPrequalForBuyer } = await import("@/lib/services/prequal/admin-prequal.service");
  return runAdminIPredictPrequalForBuyer(ARGS);
}

beforeEach(() => {
  cap.upserts = [];
  cap.notifications = [];
  cap.approvedEmails = 0;
});

test("admin path: APPROVED + OFAC cleared ⇒ persists APPROVED + budget", async () => {
  await run({ decision: PreQualDecision.APPROVED, ofacFlagged: false });
  const persisted = cap.upserts[0]!;
  assert.equal(persisted.decision, "APPROVED");
  assert.equal(persisted.maxOtdAmountCents, 4_200_000);
});

test("admin path: INDETERMINATE OFAC (null) on APPROVED ⇒ NEVER APPROVED (fail-closed, same as buyer path)", async () => {
  await run({ decision: PreQualDecision.APPROVED, ofacFlagged: null });
  const persisted = cap.upserts[0]!;
  assert.notEqual(persisted.decision, "APPROVED", "admin pipeline must also fail closed on unknown OFAC");
  assert.equal(persisted.maxOtdAmountCents, 0, "no budget under indeterminate OFAC");
  assert.equal(persisted.checkOfacAlert, false, "no positive alert flag for missing data");
});

test("admin path: OFAC hit (true) ⇒ OFAC_REVIEW + ops notification, no budget", async () => {
  await run({ decision: PreQualDecision.APPROVED, ofacFlagged: true });
  const persisted = cap.upserts[0]!;
  assert.equal(persisted.decision, "OFAC_REVIEW");
  assert.equal(persisted.maxOtdAmountCents, 0);
  assert.ok(cap.notifications.some((n) => String(n.title).includes("OFAC")));
});

test("admin path: high-risk / suspicious address ⇒ MANUAL_REVIEW (fraud signal used, both pipelines)", async () => {
  await run({ decision: PreQualDecision.APPROVED, ofacFlagged: false, highRiskAddressFlag: true });
  const persisted = cap.upserts[0]!;
  assert.equal(persisted.decision, "MANUAL_REVIEW");
  assert.equal(persisted.maxOtdAmountCents, 0);
});
