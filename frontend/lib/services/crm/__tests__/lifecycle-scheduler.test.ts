// Unit tests for the Program 2 lifecycle producer activation-control router.
//
// PHASE 2 REWRITE — the rule changed, so the assertions did. §8.2 "QStash
// neutralisation (no replacement vendor)" makes every lifecycle workload
// internal-by-default (`flag: null`); the flag is no longer read for any of them.
// §13-D17 is the acknowledgement pattern for exactly this: a test that encodes a
// rule the spec replaces is REWRITTEN in the phase that changes the rule, never
// weakened, and the rewrite is called out in that phase's report.
//
// What still holds, and is still pinned here:
//   • never BOTH dispatch and enqueue on one call (no dual authority);
//   • form_submitted without a buyerId cannot use the internal path — there is no
//     entity to key on, so it remains a LEGACY_PATH_WRITE-counted producer;
//   • the function never throws into the caller, and does NOT fall back to QStash
//     after an internal-enqueue error (which could double-send).
//
// What is inverted:
//   • flag OFF used to mean "dispatch to QStash". There is no OFF any more — the
//     vendor is decommissioned (§13-D23), `dispatch` throws into a dead endpoint,
//     the error is swallowed into `jobs_dead_letter`, and the drain terminalises
//     any `qstash:%` event as "TERMINAL — no internal owner". A flag-store hiccup
//     used to route a buyer's touch into that. Delivery must not hinge on a DB row
//     nobody set.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/crm/__tests__/lifecycle-scheduler.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Mirror of the real FLAGS values the SUT references (feature-flags.service.ts).
const MOCK_FLAGS = {
  LIFECYCLE_INTERNAL_DEPOSIT_REMINDER: "lifecycle_internal_deposit_reminder",
  LIFECYCLE_INTERNAL_AUCTION: "lifecycle_internal_auction",
  LIFECYCLE_INTERNAL_DEALER_INVITED: "lifecycle_internal_dealer_invited",
  LIFECYCLE_INTERNAL_OFFER: "lifecycle_internal_offer",
  LIFECYCLE_INTERNAL_DEAL_COMPLETE: "lifecycle_internal_deal_complete",
  LIFECYCLE_INTERNAL_FORM_SUBMITTED: "lifecycle_internal_form_submitted",
} as const;

interface Ctrl {
  enabled: Record<string, boolean>;
  flagThrows: boolean;
  enqueueThrows: boolean;
  enqueues: Array<Record<string, unknown>>;
  dispatches: Array<Record<string, unknown>>;
}

let ctrl: Ctrl;

function freshCtrl(): Ctrl {
  return { enabled: {}, flagThrows: false, enqueueThrows: false, enqueues: [], dispatches: [] };
}

mock.module("@/lib/services/system/feature-flags.service", {
  namedExports: {
    FLAGS: MOCK_FLAGS,
    isEnabled: async (flag: string) => {
      if (ctrl.flagThrows) throw new Error("flag store boom");
      return ctrl.enabled[flag] ?? false;
    },
  },
});

mock.module("@/lib/services/crm/lifecycle-touch-drain.service", {
  namedExports: {
    enqueueLifecycleTouch: async (input: Record<string, unknown>) => {
      if (ctrl.enqueueThrows) throw new Error("enqueue boom");
      ctrl.enqueues.push(input);
      return { scheduled: true };
    },
  },
});

mock.module("@/lib/qstash/dispatch", {
  namedExports: {
    dispatch: async (input: Record<string, unknown>) => {
      ctrl.dispatches.push(input);
    },
  },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

async function load() {
  return import("@/lib/services/crm/lifecycle-scheduler");
}

beforeEach(() => {
  ctrl = freshCtrl();
});

// ── flag OFF → QStash, byte-for-byte ────────────────────────────────────────
// UPDATED (QStash removal): this used to assert the opposite — that with the flag
// OFF the workload dispatched to QStash at +24h. QStash has since been removed from
// the stack, so that route enqueued into nothing: dispatch threw, the error was
// swallowed into a dead-letter row, and no buyer was ever reminded. deposit_reminder
// is now owned outright by the internal plane, with no flag consulted, so a missing
// or reset flag row cannot silently kill the circle. The +1h delay is the internal
// chain's own documented first-touch grace (the 86400 above mirrored the QStash
// job's schedule, which no longer runs).
// PHASE 3 — deposit_reminder no longer routes anywhere from here.
//
// This asserted that the workload reached the internal lifecycle plane rather than the
// removed QStash service. It now reaches NEITHER: §8.2 moved the $99 series to
// `comms_outbox`, keyed to the Vehicle Request and drained every minute, and checkout
// calls `enrollDepositReminders` directly. Leaving both rails able to enrol would send
// a buyer all six touches twice, so the adapter stands down here and counts the
// attempt — the counter is what makes a forgotten caller visible.
//
// The stand-down and its counter are pinned in `deposit-reminder-producer.test.ts`;
// the new rail's cadence and guards in
// `lib/services/payment/__tests__/deposit-reminder-outbox.test.ts`.
test("deposit_reminder routes NOWHERE from the scheduler — the $99 series moved rails", async () => {
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload({
    workload: "deposit_reminder",
    buyerId: "b1",
    firstName: "Sam",
    email: "b@x.com",
  });
  assert.equal(ctrl.dispatches.length, 0, "the removed service must never be targeted");
  assert.equal(ctrl.enqueues.length, 0, "and the lifecycle rail must not enrol a second copy");
});

test("auction_active enqueues INTERNALLY, whatever the flag store says", async () => {
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload({
    workload: "auction_active",
    buyerId: "b1",
    auctionId: "a1",
    firstName: "there",
    email: "b@x.com",
  });
  assert.deepEqual(ctrl.dispatches, [], "nothing may reach the decommissioned vendor");
  assert.equal(ctrl.enqueues.length, 1);
  assert.equal(ctrl.enqueues[0].sequence, "auction_active");
  assert.equal(ctrl.enqueues[0].entityId, "b1");
  assert.equal(ctrl.enqueues[0].baseKey, "auction:a1");
});

test("dealer_invited enqueues internally, keyed on the dealer and the auction", async () => {
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload({
    workload: "dealer_invited",
    dealerId: "d1",
    auctionId: "a1",
    firstName: "Rick's Auto",
    email: "d@x.com",
    expiresAt: "2026-01-01T00:00:00.000Z",
  });
  assert.deepEqual(ctrl.dispatches, []);
  assert.equal(ctrl.enqueues.length, 1);
  assert.equal(ctrl.enqueues[0].sequence, "dealer_invited");
  assert.equal(ctrl.enqueues[0].entityId, "d1");
  assert.equal(ctrl.enqueues[0].baseKey, "dealer-invited:a1:d1");
  // BEHAVIOUR DELTA, declared rather than assumed neutral: the internal
  // `dealer_invited` does NOT chain a bid reminder. The endsAt-driven idempotent
  // `cron/dealer-invitation-reminder` owns that chase, so QStash's
  // `dealer-bid-reminder` is retired, not ported (§8.2 Phase 2 AS BUILT).
});

test("deal_complete enqueues internally, keyed on the deal", async () => {
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload({
    workload: "deal_complete",
    buyerId: "b1",
    dealId: "deal1",
    firstName: "Sam",
    email: "b@x.com",
  });
  assert.deepEqual(ctrl.dispatches, []);
  assert.equal(ctrl.enqueues.length, 1);
  assert.equal(ctrl.enqueues[0].sequence, "deal_complete");
  assert.equal(ctrl.enqueues[0].baseKey, "deal-complete:deal1");
});

// ── flag ON → internal enqueue, correct mapping ─────────────────────────────
// UPDATED (QStash removal): the flag is no longer consulted for this workload, so
// setting it ON must be a no-op rather than the thing that enables delivery.
test("the flag cannot bring the retired rail back for deposit_reminder", async () => {
  ctrl.enabled[MOCK_FLAGS.LIFECYCLE_INTERNAL_DEPOSIT_REMINDER] = true;
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload({
    workload: "deposit_reminder",
    buyerId: "b1",
    firstName: "Sam",
    email: "b@x.com",
  });
  assert.equal(ctrl.dispatches.length, 0);
  assert.equal(ctrl.enqueues.length, 0, "the stand-down happens before the routing decision is even made");
});

test("auction_active ON → internal enqueue keyed on auction, immediate (runAt undefined)", async () => {
  ctrl.enabled[MOCK_FLAGS.LIFECYCLE_INTERNAL_AUCTION] = true;
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload({
    workload: "auction_active",
    buyerId: "b1",
    auctionId: "a1",
    firstName: "there",
    email: "b@x.com",
  });
  assert.equal(ctrl.dispatches.length, 0);
  assert.equal(ctrl.enqueues.length, 1);
  assert.equal(ctrl.enqueues[0].sequence, "auction_active");
  assert.equal(ctrl.enqueues[0].baseKey, "auction:a1");
  assert.equal(ctrl.enqueues[0].entityId, "b1");
  assert.equal(ctrl.enqueues[0].runAt, undefined);
});

test("offer_received ON → internal enqueue keyed per-auction, entity is the buyer", async () => {
  ctrl.enabled[MOCK_FLAGS.LIFECYCLE_INTERNAL_OFFER] = true;
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload({
    workload: "offer_received",
    buyerId: "b1",
    auctionId: "a1",
    offerId: "o1",
    firstName: "there",
    email: "b@x.com",
  });
  assert.equal(ctrl.enqueues.length, 1);
  assert.equal(ctrl.enqueues[0].sequence, "offer_received");
  assert.equal(ctrl.enqueues[0].baseKey, "offer-received:a1");
  assert.equal(ctrl.enqueues[0].entityId, "b1");
});

test("dealer_invited ON → internal enqueue keyed auction:dealer, entity is the dealer", async () => {
  ctrl.enabled[MOCK_FLAGS.LIFECYCLE_INTERNAL_DEALER_INVITED] = true;
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload({
    workload: "dealer_invited",
    dealerId: "d1",
    auctionId: "a1",
    firstName: "Rick's Auto",
    email: "d@x.com",
  });
  assert.equal(ctrl.enqueues.length, 1);
  assert.equal(ctrl.enqueues[0].sequence, "dealer_invited");
  assert.equal(ctrl.enqueues[0].baseKey, "dealer-invited:a1:d1");
  assert.equal(ctrl.enqueues[0].entityId, "d1");
});

test("form_submitted ON (with buyerId) → internal enqueue", async () => {
  ctrl.enabled[MOCK_FLAGS.LIFECYCLE_INTERNAL_FORM_SUBMITTED] = true;
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload({
    workload: "form_submitted",
    buyerId: "b1",
    firstName: "Sam",
    email: "b@x.com",
    phone: "+15550001111",
    campaign: "organic",
  });
  assert.equal(ctrl.dispatches.length, 0);
  assert.equal(ctrl.enqueues.length, 1);
  assert.equal(ctrl.enqueues[0].sequence, "form_submitted");
  assert.equal(ctrl.enqueues[0].baseKey, "form-submitted:b1");
  assert.equal(ctrl.enqueues[0].phone, "+15550001111");
});

// ── edge cases ──────────────────────────────────────────────────────────────
test("form_submitted ON but NO buyerId → stays on QStash (cannot key the internal path)", async () => {
  ctrl.enabled[MOCK_FLAGS.LIFECYCLE_INTERNAL_FORM_SUBMITTED] = true;
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload({
    workload: "form_submitted",
    firstName: "Sam",
    email: "b@x.com",
    phone: "+15550001111",
    campaign: "phone-voice-partial",
  });
  assert.equal(ctrl.enqueues.length, 0);
  assert.equal(ctrl.dispatches.length, 1);
  assert.equal(ctrl.dispatches[0].path, "/api/jobs/form-submitted");
});

test("a flag-store OUTAGE cannot route a touch into the dead vendor", async () => {
  // This is the reason the flags were flipped. `internalEnabled` fails SAFE to
  // QStash by design — a sound rule while QStash was the authority, and a silent
  // drop once it was decommissioned. The flag is no longer consulted, so a
  // flag-store outage is not a routing decision at all.
  ctrl.flagThrows = true;
  ctrl.enabled[MOCK_FLAGS.LIFECYCLE_INTERNAL_AUCTION] = true;
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload({
    workload: "auction_active",
    buyerId: "b1",
    auctionId: "a1",
    firstName: "there",
    email: "b@x.com",
  });
  assert.equal(ctrl.enqueues.length, 1, "the touch is still delivered");
  assert.deepEqual(ctrl.dispatches, [], "and never to a vendor that no longer answers");
});

test("SINGLE AUTHORITY: exactly one of {dispatch, enqueue} fires per call (ON)", async () => {
  ctrl.enabled[MOCK_FLAGS.LIFECYCLE_INTERNAL_DEAL_COMPLETE] = true;
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload({
    workload: "deal_complete",
    buyerId: "b1",
    dealId: "deal1",
    firstName: "Sam",
    email: "b@x.com",
  });
  assert.equal(ctrl.enqueues.length + ctrl.dispatches.length, 1);
  assert.equal(ctrl.enqueues.length, 1);
});

test("internal enqueue error never throws AND never falls back to QStash (no double-send)", async () => {
  ctrl.enabled[MOCK_FLAGS.LIFECYCLE_INTERNAL_AUCTION] = true;
  ctrl.enqueueThrows = true;
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload({
    workload: "auction_active",
    buyerId: "b1",
    auctionId: "a1",
    firstName: "there",
    email: "b@x.com",
  }); // must resolve, not reject
  assert.equal(ctrl.dispatches.length, 0); // NO fallback dispatch after choosing internal
});
