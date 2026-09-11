// THE FLIP — §13-D52, end to end, in both positions.
//
// `SOURCING_CASE_REPLACES_AUCTION_LAUNCH` is the one switch in this programme whose default is
// a deliberate refusal to ship the new behaviour, and the flip itself is the owner's. This file
// exists because the flag is only safe if BOTH of its positions are whole:
//
//   OFF (the default, and production today) — settlement still creates the auction and the
//        legacy path still invites dealers, and the sourcing ladder stands down so no deposit
//        can get two auctions.
//   ON  (after the owner flips it) — settlement opens a sourcing case and creates no auction,
//        and the sourcing ladder is what carries the case to a launch.
//
// The failure the flag guards against is specific and silent: flag ON with no Phase 5, and every
// buyer who pays $99 gets an open sourcing case and NO DEALER IS EVER INVITED — no error, no
// exception, no failed job, just silence per buyer until somebody looks
// (`lib/payments/settlement-flags.ts` states it in those terms). So the assertion that matters
// most here is not "the case is opened"; it is that with the flag ON something actually DRIVES
// the case, and with it OFF that driver does nothing. A flip whose driver stands down is the
// silent failure wearing the fix's clothes; a driver that runs before the flip is two auctions
// per deposit against a `@unique` column, on a buyer's paid request.
//
// AND THE CONCIERGE BRANCH IS OUTSIDE THE FLIP, in both positions — owner ruling, §13-D52
// precondition (b), 2026-09-11. A concierge conversion is pre-sourced: the offer already exists,
// curated by staff, and there is nothing to source. That exclusion is pinned here against the
// named guard rather than left as an absence a later reader would read as an oversight.
//
// WHAT IS MOCKED AND WHY: the settlement effect, the sweep and the flag reader are REAL — they
// are what the flip moves. `openSourcingCase` and the ladder step are recorded rather than run,
// because their own behaviour is pinned by the sourcing suites and this file is about the
// switch, not the ladder.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/webhooks/__tests__/stripe-settlement-sourcing-case.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Ctrl {
  /** Requests whose sourcing case was opened by the settlement effect. */
  casesOpened: string[];
  /** Open cases the sweep's own query returns. */
  openCases: Array<{ vehicleRequestId: string }>;
  /** How many times the sweep actually queried for open cases. */
  sweepQueries: number;
  /** Deposit rows the fulfillment-track resolver can read. */
  deposits: Record<string, { stripePaymentIntentId: string | null } | undefined>;
  /** PaymentIntents the Stripe adapter can return. */
  intents: Record<string, { metadata?: { type?: string } } | undefined>;
}
let ctrl: Ctrl;

function env(): Record<string, string | undefined> {
  return process.env as Record<string, string | undefined>;
}

beforeEach(() => {
  ctrl = {
    casesOpened: [],
    openCases: [],
    sweepQueries: 0,
    deposits: {
      dep_concierge: { stripePaymentIntentId: "pi_concierge" },
      dep_standard: { stripePaymentIntentId: "pi_standard" },
    },
    intents: {
      pi_concierge: { metadata: { type: "concierge_deposit" } },
      pi_standard: { metadata: { type: "deposit" } },
    },
  };
  delete env().SOURCING_CASE_REPLACES_AUCTION_LAUNCH;
  // Stated rather than trusted: every test below sets the position it is testing, and a leaked
  // value from a prior test would make the OFF assertions pass for the wrong reason.
  assert.equal(env().SOURCING_CASE_REPLACES_AUCTION_LAUNCH, undefined);
});

mock.module("server-only", { namedExports: {}, defaultExport: {} });
mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deposit: {
        findUnique: async ({ where }: { where: { id: string } }) => ctrl.deposits[where.id] ?? null,
      },
    },
  },
});

// The concierge/standard split reads the PaymentIntent's metadata, not a status. Recorded here
// so the split under test is the real one.
mock.module("@/lib/services/payment/stripe.service", {
  namedExports: {
    retrievePaymentIntent: async (id: string) => ctrl.intents[id] ?? null,
  },
});

// The sourcing-case module, with EVERY export the real driver imports from it. A partial mock
// would leave a named import undefined and fail at link time rather than on an assertion, which
// is a test failure that teaches nothing.
mock.module("@/lib/services/sourcing/sourcing-case.service", {
  namedExports: {
    openSourcingCase: async (requestId: string) => {
      ctrl.casesOpened.push(requestId);
      return { caseId: `case_for_${requestId}`, created: true };
    },
    // Null on purpose for the ON-path sweep below: a case the sweep selected and that was
    // closed before the drive read it is a real race, and it gives `driveSourcing` a definite
    // NO_CASE outcome without this file having to simulate a whole ladder step.
    getSourcingCase: async () => null,
    getSourcingCaseById: async () => null,
    transitionCase: async () => ({ moved: false, status: "ACTIVE_SOURCING" }),
    effectiveRadiusMiles: () => 100,
    nextBand: () => null,
    SOURCING_CASE_STATUS: {
      ACTIVE_SOURCING: "ACTIVE_SOURCING",
      READY_TO_LAUNCH: "READY_TO_LAUNCH",
      RADIUS_AUTHORIZATION_REQUIRED: "RADIUS_AUTHORIZATION_REQUIRED",
      LIMITED_PENDING_APPROVAL: "LIMITED_PENDING_APPROVAL",
      THIN_COVERAGE_REVIEW: "THIN_COVERAGE_REVIEW",
      ZERO_COVERAGE_REVIEW: "ZERO_COVERAGE_REVIEW",
      LAUNCHED: "LAUNCHED",
      CLOSED: "CLOSED",
    },
    SOURCING_BAND: { BAND_100: "BAND_100", BAND_150: "BAND_150", BAND_250: "BAND_250", AUTHORIZED: "AUTHORIZED" },
    BAND_OUTER_MILES: { BAND_100: 100, BAND_150: 150, BAND_250: 250, AUTHORIZED: null },
  },
});

mock.module("@/lib/services/buyer/plan-snapshot.service", {
  namedExports: {
    recordRequestPlanElection: async () => ({ snapshot: null, boundSnapshotId: "snap_1" }),
  },
});

mock.module("@/lib/services/vehicle-request/open-request.service", {
  namedExports: {
    OPEN_REQUEST_STATUSES: ["DRAFT", "SUBMITTED", "INTAKE", "PAYMENT_REQUIRED", "ACTIVE_SOURCING"],
  },
});

// The ladder step and the launch are pinned by the sourcing suites; here they must exist but
// must not run, because the sweep is supposed to reach them only in one position of the flag.
mock.module("@/lib/services/sourcing/rooftop-sourcing.service", {
  namedExports: {
    advanceSourcing: async () => {
      throw new Error("the ladder must not be reached in this file");
    },
  },
});
mock.module("@/lib/services/sourcing/launch-readiness.service", {
  namedExports: {
    launchFromCase: async () => {
      throw new Error("the launch must not be reached in this file");
    },
  },
});
mock.module("@/lib/services/operations/queue-item.service", {
  namedExports: { raiseException: async () => ({ queueItemId: "q1", created: true }) },
});
mock.module("@/lib/services/comms/transactional-dispatcher.service", {
  namedExports: { enqueueTransactional: async () => ({ id: "o1" }), cancelByKey: async () => 0 },
});

function tx() {
  return {
    deposit: { updateMany: async () => ({ count: 1 }) },
    buyer: { findUnique: async () => ({ plan: "STANDARD" }) },
    vehicleRequest: {
      findFirst: async () => null,
      updateMany: async () => ({ count: 1 }),
    },
  } as never;
}

/** A db whose only job is to report how the sweep queried it. */
function sweepDb() {
  return {
    sourcingCase: {
      findMany: async () => {
        ctrl.sweepQueries += 1;
        return ctrl.openCases;
      },
    },
  } as never;
}

const settlement = { depositId: "dep_1", buyerId: "buyer_1", vehicleRequestId: "vr_1" };

// ─────────────────────────────────────────────────────────────────────────────
// Position OFF — the default, and production at the time of writing
// ─────────────────────────────────────────────────────────────────────────────

test("flag OFF: settlement opens the case AND hands the legacy auction path back to the caller", async () => {
  // Both halves matter. The case is opened either way (Phase 3's §5d atomic list), but with the
  // flag off the webhook must still create the auction and invite — otherwise the flag's "off"
  // position is the silent failure instead of the protection against it.
  const { applySettlementEffects } = await import("@/lib/services/payment/settlement-effects.service");
  const res = await applySettlementEffects(settlement, tx());

  assert.equal(res.runLegacyAuctionPath, true, "the caller was not told to create the auction");
  assert.deepEqual(ctrl.casesOpened, ["vr_1"]);
  assert.equal(res.sourcingCaseId, "case_for_vr_1");
});

test("flag OFF: the ladder stands down without even querying, so no deposit gets two auctions", async () => {
  // `Auction.depositId` is @unique. If the sweep ran while the legacy path was still creating
  // auctions, the second create would fail loudly on a buyer's paid request — so standing down
  // is not politeness, it is the constraint. And it stands down VISIBLY: FLAG_OFF in the
  // outcome map, because an operator reading the cron log needs to see the sweep ran and
  // deliberately did nothing rather than wonder why no case moved.
  const { sweepSourcingCases } = await import("@/lib/services/sourcing/sourcing-driver.service");
  ctrl.openCases = [{ vehicleRequestId: "vr_1" }];

  const res = await sweepSourcingCases(sweepDb(), new Date("2026-09-11T00:00:00Z"));

  assert.deepEqual(res.outcomes, { FLAG_OFF: 1 });
  assert.equal(res.casesConsidered, 0);
  assert.equal(ctrl.sweepQueries, 0, "the sweep queried for open cases before checking the flag");
});

// ─────────────────────────────────────────────────────────────────────────────
// Position ON — what the owner's flip actually changes
// ─────────────────────────────────────────────────────────────────────────────

test("flag ON: settlement opens the case and creates NO auction", async () => {
  env().SOURCING_CASE_REPLACES_AUCTION_LAUNCH = "true";
  const { applySettlementEffects } = await import("@/lib/services/payment/settlement-effects.service");
  const res = await applySettlementEffects(settlement, tx());

  assert.equal(res.runLegacyAuctionPath, false, "the legacy auction path ran with the flag on");
  assert.deepEqual(ctrl.casesOpened, ["vr_1"]);
  assert.equal(res.unlocked, true, "the request was not unlocked, so nothing would source it");
});

test("flag ON: the ladder picks the case up — this is what stops the silent no-dealer failure", async () => {
  // The half the flag's own warning is about. With the flip on, the legacy path no longer
  // invites anyone, so if this sweep did not reach the case the buyer would have paid for an
  // auction that never happens. `driveSourcing` is real here; the case it looks up is gone (the
  // selected-then-closed race), which gives a definite NO_CASE rather than a simulated ladder.
  env().SOURCING_CASE_REPLACES_AUCTION_LAUNCH = "true";
  const { sweepSourcingCases } = await import("@/lib/services/sourcing/sourcing-driver.service");
  ctrl.openCases = [{ vehicleRequestId: "vr_1" }, { vehicleRequestId: "vr_2" }];

  const res = await sweepSourcingCases(sweepDb(), new Date("2026-09-11T00:00:00Z"));

  assert.equal(ctrl.sweepQueries, 1, "the sweep never queried for open cases");
  assert.equal(res.casesConsidered, 2);
  assert.deepEqual(res.outcomes, { NO_CASE: 2 });
  assert.deepEqual(res.errors, [], "a case failing must not be swallowed, and none should have failed");
});

test("flag ON: only the exact string 'true' flips it — a typo leaves production on the old path", async () => {
  env().SOURCING_CASE_REPLACES_AUCTION_LAUNCH = "TRUE";
  const { applySettlementEffects } = await import("@/lib/services/payment/settlement-effects.service");
  const res = await applySettlementEffects(settlement, tx());
  assert.equal(res.runLegacyAuctionPath, true, "'TRUE' was accepted — a half-flip is the worst state");

  // And the two sides agree on what "on" means. A settlement that took the legacy path while
  // the sweep also drove the case is the two-auctions-per-deposit failure.
  const { sweepSourcingCases } = await import("@/lib/services/sourcing/sourcing-driver.service");
  ctrl.openCases = [{ vehicleRequestId: "vr_1" }];
  const swept = await sweepSourcingCases(sweepDb(), new Date("2026-09-11T00:00:00Z"));
  assert.deepEqual(swept.outcomes, { FLAG_OFF: 1 }, "the two readers of one flag disagreed");
});

test("flag ON: the flip is read at call time, so it can be reverted without a deploy", async () => {
  const { applySettlementEffects } = await import("@/lib/services/payment/settlement-effects.service");

  env().SOURCING_CASE_REPLACES_AUCTION_LAUNCH = "true";
  const on = await applySettlementEffects(settlement, tx());
  assert.equal(on.runLegacyAuctionPath, false);

  delete env().SOURCING_CASE_REPLACES_AUCTION_LAUNCH;
  const off = await applySettlementEffects(settlement, tx());
  assert.equal(off.runLegacyAuctionPath, true, "the flag was captured at module load — a revert would need a deploy");
});

// ─────────────────────────────────────────────────────────────────────────────
// The concierge exclusion — §13-D52 precondition (b), owner ruling 2026-09-11
// ─────────────────────────────────────────────────────────────────────────────

test("the concierge branch is outside the flip, and says so in code rather than by omission", async () => {
  // The ruling: "Explicitly exclude, and fix the statement rather than the code." The named
  // guard is what a future reader trips over; routing the concierge branch through
  // `applySettlementEffects` would make these assertions false.
  const { CONCIERGE_IS_OUTSIDE_SOURCING_CASE_FLAG } = await import(
    "@/lib/services/concierge/concierge-conversion.service"
  );
  assert.equal(CONCIERGE_IS_OUTSIDE_SOURCING_CASE_FLAG.opensSourcingCase, false);
  assert.equal(CONCIERGE_IS_OUTSIDE_SOURCING_CASE_FLAG.writesLegacyPathWrite, false);
  assert.equal(CONCIERGE_IS_OUTSIDE_SOURCING_CASE_FLAG.invitesDealers, false);
  assert.match(
    CONCIERGE_IS_OUTSIDE_SOURCING_CASE_FLAG.reason,
    /NON-CONCIERGE/,
    "the §8.4 removal clock's scope is the point of the exclusion and must be stated",
  );
});

test("the concierge track is separated from the standard one before settlement effects run", async () => {
  // The separation is `resolveDepositFulfillmentTrack`, read from the PaymentIntent's
  // `metadata.type` — not from a status after the fact. A concierge deposit is therefore known
  // to be concierge before anything decides what to do with it, in either position of the flag.
  const { resolveDepositFulfillmentTrack } = await import("@/lib/services/payment/fulfillment-gate");
  assert.equal(await resolveDepositFulfillmentTrack("dep_concierge"), "concierge");
  assert.equal(await resolveDepositFulfillmentTrack("dep_standard"), "standard");
});

test("an indeterminate track is NOT read as standard — the optimistic answer invites dealers", async () => {
  // The fail-closed direction, which is the one with a cost: reading "unknown" as "standard" is
  // what would invite dealers to a concierge deal.
  const { resolveDepositFulfillmentTrack } = await import("@/lib/services/payment/fulfillment-gate");
  ctrl.deposits.dep_odd = { stripePaymentIntentId: "pi_odd" };
  ctrl.intents.pi_odd = { metadata: {} };
  assert.equal(await resolveDepositFulfillmentTrack("dep_odd"), "unknown");
});
