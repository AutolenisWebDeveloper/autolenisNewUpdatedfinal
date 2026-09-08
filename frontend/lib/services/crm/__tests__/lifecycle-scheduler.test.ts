// Unit tests for the Program 2 lifecycle producer activation-control router.
//
<<<<<<< HEAD
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
=======
// Pins the single-authority-by-construction contract:
//   • flag OFF (default) → the EXISTING QStash dispatch is called with the exact
//     path/body/delay the site used before (behaviour-neutral deploy);
//   • flag ON  → the internal enqueueLifecycleTouch is called with the correct
//     sequence/baseKey/entity/runAt;
//   • never BOTH on one call (no dual authority / double production);
//   • form_submitted without a buyerId cannot use the internal path — it stays on
//     QStash even when the flag is ON (no entity to key on);
//   • a flag-store error fails SAFE to QStash (current authority);
//   • the function never throws into the caller, and does NOT fall back to QStash
//     after an internal-enqueue error (which could double-send).
//
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
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
test("deposit_reminder with the flag OFF still goes INTERNAL — QStash is never used", async () => {
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload({
    workload: "deposit_reminder",
    buyerId: "b1",
    firstName: "Sam",
    email: "b@x.com",
  });
  assert.equal(ctrl.dispatches.length, 0, "the removed service must never be targeted");
  assert.equal(ctrl.enqueues.length, 1);
  const e = ctrl.enqueues[0];
  assert.equal(e.sequence, "deposit_reminder_1");
  assert.equal(e.baseKey, "deposit-reminder:b1");
  assert.equal(e.entityId, "b1");
  // CADENCE CHANGE (owner spec: immediate → +1h → +6h → +24h → +72h → day-7):
  // touch 1 is the "here's your link back", enqueued with NO delay, so runAt is
  // left undefined and enqueueLifecycleTouch defaults it to now. This previously
  // asserted ~now+1h, the grace the owner overruled.
  assert.equal(e.runAt, undefined, "the immediate touch carries no delay");
});

<<<<<<< HEAD
test("auction_active enqueues INTERNALLY, whatever the flag store says", async () => {
=======
test("auction_active OFF → QStash dispatch, immediate", async () => {
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload({
    workload: "auction_active",
    buyerId: "b1",
    auctionId: "a1",
    firstName: "there",
    email: "b@x.com",
  });
<<<<<<< HEAD
  assert.deepEqual(ctrl.dispatches, [], "nothing may reach the decommissioned vendor");
  assert.equal(ctrl.enqueues.length, 1);
  assert.equal(ctrl.enqueues[0].sequence, "auction_active");
  assert.equal(ctrl.enqueues[0].entityId, "b1");
  assert.equal(ctrl.enqueues[0].baseKey, "auction:a1");
});

test("dealer_invited enqueues internally, keyed on the dealer and the auction", async () => {
=======
  assert.equal(ctrl.dispatches.length, 1);
  assert.equal(ctrl.dispatches[0].path, "/api/jobs/auction-active");
  assert.equal(ctrl.dispatches[0].delaySeconds, 0);
  assert.deepEqual(ctrl.dispatches[0].body, {
    buyerId: "b1",
    firstName: "there",
    email: "b@x.com",
    auctionId: "a1",
  });
});

test("dealer_invited OFF → QStash dispatch with expiresAt passthrough", async () => {
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload({
    workload: "dealer_invited",
    dealerId: "d1",
    auctionId: "a1",
    firstName: "Rick's Auto",
    email: "d@x.com",
    expiresAt: "2026-01-01T00:00:00.000Z",
  });
<<<<<<< HEAD
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
=======
  assert.equal(ctrl.dispatches.length, 1);
  assert.deepEqual(ctrl.dispatches[0].body, {
    dealerId: "d1",
    firstName: "Rick's Auto",
    email: "d@x.com",
    auctionId: "a1",
    expiresAt: "2026-01-01T00:00:00.000Z",
  });
});

test("deal_complete OFF → QStash dispatch with dealId", async () => {
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload({
    workload: "deal_complete",
    buyerId: "b1",
    dealId: "deal1",
    firstName: "Sam",
    email: "b@x.com",
  });
<<<<<<< HEAD
  assert.deepEqual(ctrl.dispatches, []);
  assert.equal(ctrl.enqueues.length, 1);
  assert.equal(ctrl.enqueues[0].sequence, "deal_complete");
  assert.equal(ctrl.enqueues[0].baseKey, "deal-complete:deal1");
=======
  assert.equal(ctrl.dispatches.length, 1);
  assert.deepEqual(ctrl.dispatches[0].body, { buyerId: "b1", firstName: "Sam", email: "b@x.com", dealId: "deal1" });
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
});

// ── flag ON → internal enqueue, correct mapping ─────────────────────────────
// UPDATED (QStash removal): the flag is no longer consulted for this workload, so
// setting it ON must be a no-op rather than the thing that enables delivery.
test("deposit_reminder with the flag ON behaves identically — the flag is irrelevant now", async () => {
  ctrl.enabled[MOCK_FLAGS.LIFECYCLE_INTERNAL_DEPOSIT_REMINDER] = true;
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload({
    workload: "deposit_reminder",
    buyerId: "b1",
    firstName: "Sam",
    email: "b@x.com",
  });
  assert.equal(ctrl.dispatches.length, 0);
  assert.equal(ctrl.enqueues.length, 1);
  const e = ctrl.enqueues[0];
  assert.equal(e.sequence, "deposit_reminder_1");
  assert.equal(e.baseKey, "deposit-reminder:b1");
  assert.equal(e.entityId, "b1");
  // CADENCE CHANGE (owner spec: immediate → +1h → +6h → +24h → +72h → day-7):
  // touch 1 is the "here's your link back", enqueued with NO delay, so runAt is
  // left undefined and enqueueLifecycleTouch defaults it to now. This previously
  // asserted ~now+1h, the grace the owner overruled.
  assert.equal(e.runAt, undefined, "the immediate touch carries no delay");
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

<<<<<<< HEAD
test("a flag-store OUTAGE cannot route a touch into the dead vendor", async () => {
  // This is the reason the flags were flipped. `internalEnabled` fails SAFE to
  // QStash by design — a sound rule while QStash was the authority, and a silent
  // drop once it was decommissioned. The flag is no longer consulted, so a
  // flag-store outage is not a routing decision at all.
  ctrl.flagThrows = true;
  ctrl.enabled[MOCK_FLAGS.LIFECYCLE_INTERNAL_AUCTION] = true;
=======
test("flag-store error fails SAFE to QStash (current authority)", async () => {
  ctrl.flagThrows = true;
  ctrl.enabled[MOCK_FLAGS.LIFECYCLE_INTERNAL_AUCTION] = true; // would be ON, but read throws
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload({
    workload: "auction_active",
    buyerId: "b1",
    auctionId: "a1",
    firstName: "there",
    email: "b@x.com",
  });
<<<<<<< HEAD
  assert.equal(ctrl.enqueues.length, 1, "the touch is still delivered");
  assert.deepEqual(ctrl.dispatches, [], "and never to a vendor that no longer answers");
=======
  assert.equal(ctrl.enqueues.length, 0);
  assert.equal(ctrl.dispatches.length, 1);
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
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
