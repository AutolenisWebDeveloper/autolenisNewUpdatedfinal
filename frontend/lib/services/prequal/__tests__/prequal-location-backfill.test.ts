// Fix 1 (docs/plans/BUYER-LOCATION-GAP.md) — prequal is the ONLY step in the
// buyer journey that collects a validated city/state/zip, and before this change
// it forwarded them to MicroBilt and discarded them. `buyers.city/state/zip`
// stayed NULL, and dealer-invitation.service fails closed on an unplaceable
// buyer (returns 0 before querying a single dealer), so those buyers' auctions
// produced zero invitations.
//
// These tests pin the two halves of the contract:
//   1. a NULL location field is filled from the validated submission, and
//   2. a field that already has a value is NEVER overwritten.
//
// The never-overwrite half is enforced structurally, not by a read-then-write:
// each field is a conditional `updateMany` guarded on `<field>: null`, so a
// concurrent admin edit cannot be clobbered. The tests therefore assert on the
// WHERE clause, which is where the guarantee actually lives.
//
// Run: pnpm test   (globs lib/services/prequal/__tests__/*.test.ts)

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PreQualDecision, PreQualTier } from "@prisma/client";
import {
  isProviderErrorReason,
  classifyProviderFailure,
} from "@/lib/services/prequal/microbilt.service";

type UpdateManyCall = {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
};

const buyerUpdateManyCalls: UpdateManyCall[] = [];
let existingPrequal: Record<string, unknown> | null = null;
let buyerUpdateManyThrows = false;

mock.module("@/lib/services/prequal/microbilt.service", {
  namedExports: {
    callIPredict: async () => ({
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
    }),
    FCRA_CONSENT_TEXT: "consent",
    isProviderErrorReason,
    classifyProviderFailure,
  },
});

mock.module("@/lib/services/monitoring/health-alert.service", {
  namedExports: { createAlert: async () => ({}), createAlertOnce: async () => ({}) },
});

mock.module("@/lib/services/email/resend.service", {
  namedExports: {
    sendPrequalApprovedEmail: async () => {},
    sendAdverseActionEmail: async () => ({ outcome: "SENT" as const }),
    sendPrequalUnderReviewEmail: async () => {},
    sendAdminPrequalAlertEmail: async () => {},
  },
});

const prismaMock = {
  preQualification: {
    findUnique: async () => existingPrequal,
    create: async () => ({ id: "pq_1", decision: "PENDING", updatedAt: new Date() }),
    updateMany: async () => ({ count: 1 }),
    findUniqueOrThrow: async () => ({ id: "pq_1" }),
    upsert: async (args: { update: Record<string, unknown> }) => ({
      id: "pq_1",
      updatedAt: new Date(),
      adverseReasonCodes: [],
      ...args.update,
    }),
  },
  prequalConsent: { create: async () => ({ id: "c_1" }) },
  notification: { create: async () => ({}) },
  complianceEvent: { create: async () => ({}), count: async () => 0 },
  buyer: {
    findUnique: async () => null, // skips the CRM sync block
    updateMany: async (args: UpdateManyCall) => {
      if (buyerUpdateManyThrows) throw new Error("db down");
      buyerUpdateManyCalls.push(args);
      return { count: 1 };
    },
  },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const { prisma } = await import("@/lib/prisma");
    return fn(prisma);
  },
};
mock.module("@/lib/prisma", { namedExports: { prisma: prismaMock } });

const BUYER = { id: "buyer_1", maxOtdAmountCents: 3_000_000, user: { email: "b@example.com" } };
const INPUT = {
  firstName: "Jane",
  lastName: "Doe",
  dateOfBirth: "01/15/1990",
  address: "123 Main St",
  city: "Austin",
  state: "tx",
  zip: "78701",
  fcraConsent: true,
  monthlyIncomeCents: 1_500_000,
  employmentStatus: "FULL_TIME",
};

async function run(inputOverrides: Record<string, unknown> = {}) {
  const { initiatePrsequal } = await import("@/lib/services/prequal/prequal.service");
  return initiatePrsequal(BUYER, { ...INPUT, ...inputOverrides });
}

/** The conditional update issued for one field, if any. */
function callFor(field: "city" | "state" | "zip"): UpdateManyCall | undefined {
  return buyerUpdateManyCalls.find((c) => field in c.data);
}

beforeEach(() => {
  buyerUpdateManyCalls.length = 0;
  existingPrequal = null;
  buyerUpdateManyThrows = false;
});

test("prequal persists city/state/zip onto the buyer", async () => {
  await run();

  const city = callFor("city");
  const state = callFor("state");
  const zip = callFor("zip");

  assert.ok(city, "expected a conditional update for city");
  assert.ok(state, "expected a conditional update for state");
  assert.ok(zip, "expected a conditional update for zip");

  assert.equal(city.data.city, "Austin");
  assert.equal(zip.data.zip, "78701");
  // State is normalised to the 2-letter uppercase form the geocode tables key on.
  assert.equal(state.data.state, "TX");

  // Every write is scoped to THIS buyer.
  for (const call of buyerUpdateManyCalls) {
    assert.equal(call.where.id, BUYER.id);
  }
});

test("prequal NEVER overwrites an existing value — each write is guarded on NULL", async () => {
  await run();

  // The never-overwrite guarantee is the `<field>: null` predicate. A buyer whose
  // city is already set simply does not match, so the update is a no-op at the
  // database — no read, and no race with a concurrent admin edit.
  assert.equal(callFor("city")?.where.city, null);
  assert.equal(callFor("state")?.where.state, null);
  assert.equal(callFor("zip")?.where.zip, null);

  // Each field is guarded independently: a buyer with a zip but no city/state
  // (3 of the 10 affected production rows) still gets city and state filled.
  for (const field of ["city", "state", "zip"] as const) {
    const call = callFor(field);
    assert.ok(call, `expected a conditional update for ${field}`);
    assert.deepEqual(
      Object.keys(call.data),
      [field],
      `${field} must be written by its own guarded update, never bundled with another field`,
    );
  }
});

test("prequal backfills location even when a valid prequal already exists", async () => {
  // The early return for a still-valid APPROVED prequal must not skip the
  // backfill: the submission carries a validated address either way, and this is
  // the re-submission path that can heal an existing NULL row.
  existingPrequal = {
    id: "pq_existing",
    decision: PreQualDecision.APPROVED,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    adverseReasonCodes: [],
  };

  await run();

  assert.ok(callFor("city"), "expected the backfill to run before the valid-prequal early return");
  assert.equal(callFor("city")?.data.city, "Austin");
});

test("a blank location field is skipped rather than written as an empty string", async () => {
  await run({ city: "   ", state: "TX", zip: "78701" });

  assert.equal(callFor("city"), undefined, "a whitespace-only city must not be persisted");
  assert.ok(callFor("state"), "state should still be written");
  assert.ok(callFor("zip"), "zip should still be written");
});

test("a failed location write NEVER fails the credit pull", async () => {
  buyerUpdateManyThrows = true;

  // A soft credit pull costs money and touches the consumer. A location backfill
  // failing must degrade to a logged error, never surface as a prequal failure.
  const result = await run();

  assert.ok(result, "prequal must still return a result when the backfill throws");
  assert.ok(result.prequal, "prequal record must still be produced");
});
