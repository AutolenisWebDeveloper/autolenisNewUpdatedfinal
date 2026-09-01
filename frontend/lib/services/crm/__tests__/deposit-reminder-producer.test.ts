// The $99 deposit-reminder PRODUCER.
//
// QStash has been removed from the stack. scheduleLifecycleWorkload routed
// deposit_reminder to QStash whenever the DB feature flag
// `lifecycle_internal_deposit_reminder` was absent — and getFeatureFlag returns
// `flag?.enabled ?? false`, so "absent" is the default. The result: every
// abandoned deposit enqueued into a service that no longer exists, dispatch threw,
// the error was swallowed into a dead-letter row, and the buyer received nothing.
//
// Delivery must not depend on a DB row nobody set. The internal
// lifecycle_touch_schedule plane is now the DEFAULT for this workload — no flag is
// consulted, and the QStash branch is unreachable for it — so a lost, reset or
// never-created flag row cannot silently kill the circle again.
//
// The first-touch delay is pinned too. The owner's cadence is
// immediate → +1h → +6h → +24h → +72h → day-7, and each touch chains the next
// itself, so the producer must enqueue touch 1 with NO delay. It previously
// enqueued at +24h (the QStash job's schedule) and then at +1h (the internal
// chain's first-touch grace); the grace is overruled — touch 1 is a "here's your
// link back", not a chase.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/crm/__tests__/deposit-reminder-producer.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Enqueued { sequence: string; entityId: string; baseKey: string; runAt?: Date }

let enqueued: Enqueued[] = [];
let dispatched: Array<{ path: string; delaySeconds?: number }> = [];
let flagValue = false;
let flagReads: string[] = [];
let flagThrows = false;

mock.module("@/lib/services/system/feature-flags.service", {
  namedExports: {
    isEnabled: async (flag: string) => {
      flagReads.push(flag);
      if (flagThrows) throw new Error("feature_flags table unreachable");
      return flagValue;
    },
    FLAGS: {
      LIFECYCLE_INTERNAL_DEPOSIT_REMINDER: "lifecycle_internal_deposit_reminder",
      LIFECYCLE_INTERNAL_AUCTION: "lifecycle_internal_auction",
      LIFECYCLE_INTERNAL_DEALER_INVITED: "lifecycle_internal_dealer_invited",
      LIFECYCLE_INTERNAL_OFFER: "lifecycle_internal_offer",
      LIFECYCLE_INTERNAL_DEAL_COMPLETE: "lifecycle_internal_deal_complete",
      LIFECYCLE_INTERNAL_FORM_SUBMITTED: "lifecycle_internal_form_submitted",
    },
  },
});

mock.module("@/lib/services/crm/lifecycle-touch-drain.service", {
  namedExports: {
    enqueueLifecycleTouch: async (input: Enqueued) => { enqueued.push(input); },
  },
});

mock.module("@/lib/qstash/dispatch", {
  namedExports: {
    dispatch: async (opts: { path: string; delaySeconds?: number }) => { dispatched.push(opts); },
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

async function load() { return import("@/lib/services/crm/lifecycle-scheduler"); }

const DEPOSIT = {
  workload: "deposit_reminder" as const,
  buyerId: "buyer_1",
  firstName: "Sam",
  email: "buyer@example.com",
  phone: "+15551230000",
};

beforeEach(() => {
  enqueued = [];
  dispatched = [];
  flagValue = false;   // production default: no feature_flag row exists
  flagReads = [];
  flagThrows = false;
});

test("with NO flag row, deposit_reminder still enqueues INTERNALLY — never QStash", async () => {
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload(DEPOSIT);

  assert.equal(enqueued.length, 1, "the internal plane is the producer, flag or no flag");
  assert.deepEqual(dispatched, [], "QStash is removed — dispatching there delivers nothing");
  assert.equal(enqueued[0]!.sequence, "deposit_reminder_1");
  assert.equal(enqueued[0]!.entityId, "buyer_1");
  assert.equal(enqueued[0]!.baseKey, "deposit-reminder:buyer_1");
});

test("no feature flag is consulted for deposit_reminder at all", async () => {
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload(DEPOSIT);

  assert.ok(
    !flagReads.includes("lifecycle_internal_deposit_reminder"),
    "consulting the flag is what let a missing row kill the circle — the workload must not read it",
  );
});

test("a feature-flag lookup FAILURE cannot divert the workload to the removed service", async () => {
  // internalEnabled() catches a flag-read error and falls back to QStash. For a
  // workload whose QStash target no longer exists, that fallback is a silent drop.
  flagThrows = true;
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload(DEPOSIT);

  assert.equal(enqueued.length, 1, "an unreadable flag table must not stop deposit reminders");
  assert.deepEqual(dispatched, []);
});

test("touch 1 is enqueued IMMEDIATELY — no first-touch grace", async () => {
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload(DEPOSIT);

  // runAt is left undefined so enqueueLifecycleTouch defaults it to now; the row
  // is therefore due on the drain's next pass. The chain then carries
  // +1h/+6h/+24h/+72h/day-7 itself.
  assert.equal(
    enqueued[0]!.runAt,
    undefined,
    "the owner's cadence leads with an immediate touch; any delay here shifts all six",
  );
});

test("the buyer's contact details are carried onto the touch row", async () => {
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload(DEPOSIT);

  const row = enqueued[0]! as unknown as Record<string, unknown>;
  assert.equal(row.email, "buyer@example.com");
  assert.equal(row.firstName, "Sam");
  assert.equal(row.phone, "+15551230000", "the SMS leg needs the phone; the TCPA gate decides whether it sends");
});

// ── The flip must be scoped to this workload only ──────────────────────────
// Other lifecycle workloads keep their flag-gated cutover; silently flipping all
// of them would be a far larger behavioural change than this finding authorises.

test("other workloads STILL respect their own flag (no accidental global flip)", async () => {
  flagValue = false;
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload({
    workload: "auction_active",
    buyerId: "buyer_1",
    auctionId: "auction_1",
    firstName: "Sam",
    email: "buyer@example.com",
  });

  assert.deepEqual(enqueued, [], "auction_active is not part of this change");
  assert.equal(dispatched.length, 1, "it keeps its existing flag-gated routing");
  assert.ok(flagReads.includes("lifecycle_internal_auction"), "and it still reads its flag");
});

test("another workload with its flag ON still routes internally (unchanged)", async () => {
  flagValue = true;
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload({
    workload: "auction_active",
    buyerId: "buyer_1",
    auctionId: "auction_1",
    firstName: "Sam",
    email: "buyer@example.com",
  });

  assert.equal(enqueued.length, 1);
  assert.deepEqual(dispatched, []);
});
