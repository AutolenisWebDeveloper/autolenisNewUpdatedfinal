// §Stage 16's exit condition, enforced at the scheduling seam: "Nothing is scheduled while any
// item is unmet."
//
// WHY THIS IS ITS OWN FILE. `pickup-coordination.test.ts` mocks the readiness gate OPEN, because
// its subject is turn-taking. A gate that is only ever open in the suite depending on it is
// indistinguishable from no gate at all, so the closed case has to be proven somewhere — and it
// cannot be proven in that file by flipping a flag. node:test module mocks do not observe a later
// mutation of a `let` in the test module: the service read `schedulable: true` while the test had
// already set the flag `false`, and the assertion "an unready deal is refused" passed for the
// wrong reason. That is the §8.1h defect class exactly, reached through a test-harness detail.
//
// AND THE READINESS SERVICE IS NOT MOCKED HERE AT ALL. Mocking it turned out not to reach the
// coordination service's static import in the first place — a direct call from the test got the
// mock while the service kept the real module, so an assertion written that way would have been
// green against an un-gated path. The prisma mock instead returns a deal with `fundingClearedAt`
// null, so the REAL evaluator runs, reports item 5 outstanding, and the REAL guard refuses. That
// is the gate end to end rather than a stand-in for it.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/pickup/__tests__/pickup-readiness-gate.test.ts"

import test, { mock } from "node:test";
import assert from "node:assert/strict";

const PROPOSED_AT = new Date("2026-02-10T18:00:00Z");
const PROPOSED_TIME = new Date("2026-02-14T18:00:00Z");

/** Irreversible acts, in the order they happened. A refusal must add nothing to either list. */
const sideEffects: { upserts: Array<Record<string, unknown>>; revokes: string[] } = { upserts: [], revokes: [] };

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      // One object serving every `findUnique` in the path: coordination's `loadDeal`, the real
      // readiness evaluator's wide select, and the driver's status read. Twelve of the thirteen
      // items are satisfied; `fundingClearedAt` is null, so item 5 is the single outstanding one
      // and the refusal must name it.
      deal: {
        findUnique: async () => ({
          id: "deal_1",
          buyerId: "buyer_1",
          status: "FUNDING_PENDING",
          offer: { dealerId: "dealer_1" },
          vin: "1HGCM82633A004352",
          vehicleYear: 2021,
          vehicleMake: "Honda",
          vehicleModel: "Accord",
          vehicleHoldUntil: new Date("2126-01-01T00:00:00Z"),
          dealerExecutedContractId: "cv_1",
          financingCompletedAt: new Date("2026-02-01T00:00:00Z"),
          fundingClearedAt: null,
          insuranceStatus: "VERIFIED",
          downPaymentCents: 200000,
          holdReason: null,
          frozenAt: null,
          financing: { downPaymentMethod: "CASHIERS_CHECK" },
          tradeInSubmissions: [],
          queueItems: [],
          pickup: {
            dealId: "deal_1",
            status: "PROPOSED",
            proposedAt: PROPOSED_AT,
            proposedTime: PROPOSED_TIME,
            proposedBy: "BUYER",
            counterCount: 0,
            scheduledAt: null,
            vehiclePreparedAt: new Date("2026-02-01T00:00:00Z"),
            dealerReadinessChecklist: { accessoriesPresent: true, deliveryDocumentsReady: true },
            dueBillItems: [],
          },
        }),
      },
      pickup: {
        updateMany: async () => ({ count: 1 }),
        findUnique: async () => ({ dealId: "deal_1", status: "SCHEDULED" }),
        update: async () => ({}),
        // Observed, so "the gate refused" can be told apart from "the gate refused after it had
        // already written the appointment". See the `schedulePickup` test at the end of this file.
        upsert: async (args: Record<string, unknown>) => { sideEffects.upserts.push(args); return { dealId: "deal_1" }; },
      },
      notification: { create: async () => ({}) },
    },
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

mock.module("@/lib/services/pickup/release-token.service", {
  namedExports: {
    revokeReleaseToken: async (dealId: string) => { sideEffects.revokes.push(dealId); return { count: 0 }; },
    TOKEN_MINTABLE_STATUSES: ["PICKUP_SCHEDULED", "PICKUP_READINESS"],
  },
});

let advanceCalls = 0;
mock.module("@/lib/services/deal/deal.service", {
  namedExports: {
    advanceDealStatus: async () => { advanceCalls += 1; return true; },
    INSURANCE_SATISFIED: ["VERIFIED", "POLICY_BOUND"],
  },
});

mock.module("@/lib/services/pickup/availability.service", {
  namedExports: {
    resolveDealerAvailability: async () => ({ timezone: "UTC", timezoneLabel: "UTC", minLeadTimeHours: 0, maxAdvanceDays: 30, openHour: 0, closeHour: 24, days: [0, 1, 2, 3, 4, 5, 6] }),
    isWithinAvailability: () => true,
  },
});

mock.module("@/lib/services/pickup/pickup-notifications.service", {
  namedExports: {
    notifyDealerProposed: async () => {},
    notifyBuyerCountered: async () => {},
    notifyDealerConfirmed: async () => {},
    notifyBuyerConfirmed: async () => {},
    notifyDealerProposalReminder: async () => {},
    notifyBuyerCounterReminder: async () => {},
  },
});

test("an unready deal CANNOT be scheduled, and the refusal names the outstanding item", async () => {
  // Before Phase 9 the confirm path advanced FUNDING_PENDING → PICKUP_SCHEDULED with nothing
  // evaluated at all — §Stage 16 L897: "Current pickup coordination evaluates none of these."
  const { confirmPickup } = await import("@/lib/services/pickup/pickup-coordination.service");
  const res = await confirmPickup("deal_1", "dealer_1", PROPOSED_AT);

  assert.equal(res.ok, false, "a deal with an unmet readiness item must not reach scheduling");
  assert.equal(res.code, "STATE");
  assert.equal(
    String(res.reason).includes("Funding clearance has not been recorded"),
    true,
    "§Stage 16 requires the exact unresolved item, not a generic refusal the buyer cannot act on",
  );
  assert.equal(advanceCalls, 0, "and the Deal must not advance to PICKUP_SCHEDULED");
});

test("schedulePickup REFUSES BEFORE it writes the appointment or retires the buyer's code", async () => {
  // THE OPERATIONS PATH, which §Stage 17 describes as "after two unsuccessful counter rounds,
  // Operations schedules directly". `confirmPickup` above evaluates readiness BEFORE its pickup
  // CAS; `schedulePickup` evaluated it after — the upsert (status SCHEDULED, reminder markers
  // cleared) and `revokeReleaseToken` both committed, and only then did the gate throw.
  //
  // WHAT THAT LEFT BEHIND. `/buyer/pickup` branches on the PICKUP's status, not the deal's, so
  // the buyer saw §Stage 16's "before we can book your pickup" checklist AND a confirmed
  // appointment at the same time, with a live "reveal your code" button that 409s with "your
  // pickup code is available once the dealership has confirmed your time. This pickup is
  // scheduled." — a sentence that contradicts itself. Any code they were already carrying was
  // revoked by the call that failed.
  //
  // A refusal must cost nothing, the same rule the journey wrapper now follows.
  sideEffects.upserts.length = 0;
  sideEffects.revokes.length = 0;

  const { schedulePickup } = await import("@/lib/services/pickup/pickup.service");

  await assert.rejects(
    () => schedulePickup("deal_1", new Date("2026-02-14T18:00:00Z"), "123 Main St"),
    /readiness is incomplete|Funding clearance has not been recorded/i,
    "an unready deal must be refused by the same §Stage 16 gate the coordination path uses",
  );

  assert.deepEqual(sideEffects.upserts, [], "no appointment is written for a scheduling that was refused");
  assert.deepEqual(sideEffects.revokes, [], "and the code the buyer is carrying is not retired by a failed call");
});
