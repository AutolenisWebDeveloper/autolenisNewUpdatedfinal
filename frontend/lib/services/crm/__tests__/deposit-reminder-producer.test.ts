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

let legacyWrites: Array<Record<string, unknown>> = [];
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

mock.module("@/lib/services/comms/legacy-path-write", {
  namedExports: {
    recordLegacyPathWrite: async (input: Record<string, unknown>) => { legacyWrites.push(input); },
  },
});

beforeEach(() => {
  legacyWrites = [];
  enqueued = [];
  dispatched = [];
  flagValue = false;   // production default: no feature_flag row exists
  flagReads = [];
  flagThrows = false;
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3 — THIS PRODUCER NO LONGER PRODUCES THE $99 SERIES.
//
// The four tests that stood here pinned how `deposit_reminder` ROUTED: internal
// rather than QStash, without consulting a feature flag, immediately, carrying the
// buyer's contact details. Every one of them described a path that has moved.
//
// The series now runs on `comms_outbox` — keyed to the Vehicle Request, drained every
// minute, with a state recheck that reads the request as well as the money. The same
// cadence and the same guards are pinned there, in
// `lib/services/payment/__tests__/deposit-reminder-outbox.test.ts`; the legacy rail's
// DRAIN is still pinned in `deposit-reminder-cadence.test.ts`, because production rows
// are still draining through it.
//
// What is worth pinning HERE is the thing that replaced them: the adapter stands down
// and SAYS SO. Both rails enrolling would send a buyer all six touches twice, and the
// failure mode of a forgotten caller is silent — so the stand-down is counted, not
// just logged.
// ─────────────────────────────────────────────────────────────────────────────

test("deposit_reminder enrols NOTHING on the lifecycle rail — both rails would double-send", async () => {
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload(DEPOSIT);

  assert.deepEqual(enqueued, [], "the $99 series moved to comms_outbox in Phase 3");
  assert.deepEqual(dispatched, [], "and certainly not to the removed QStash service");
});

test("the stand-down is COUNTED, so a forgotten caller surfaces as a row and not as duplicate messages", async () => {
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload(DEPOSIT);

  assert.equal(legacyWrites.length, 1);
  assert.equal(legacyWrites[0]!.kind, "LEGACY_LIFECYCLE_ENROLLMENT");
  assert.match(String(legacyWrites[0]!.detail), /buyer_1/);
  assert.match(String(legacyWrites[0]!.detail), /comms_outbox/);
});

test("it does not throw — the callers are best-effort tails that would swallow it", async () => {
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload(DEPOSIT);
  // Reaching here without a rejection IS the assertion; a throw in a `.catch(log)`
  // tail is invisible, which is why the counter above exists instead.
  assert.equal(legacyWrites.length, 1);
});

test("no feature flag is consulted — the workload does not reach the routing decision", async () => {
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload(DEPOSIT);
  assert.deepEqual(flagReads, [], "the stand-down happens before buildPlan");
});

// ── PHASE 2: the flip is now GLOBAL, deliberately ──────────────────────────
//
// This test used to assert the opposite — that `deposit_reminder` was the only
// workload flipped and the others kept their flag-gated cutover, because flipping
// all of them was "a far larger behavioural change than this finding authorises".
// §8.2 Phase 2 ("QStash neutralisation — no replacement vendor") is the change
// that authorises it, so the assertion is inverted rather than deleted: it now
// pins that NO lifecycle workload reaches the dead vendor.
//
// Why it had to move. `internalEnabled` fails SAFE to QStash by design, and QStash
// is decommissioned (§13-D23), so a flag-store hiccup routed a touch into a
// service that no longer answers: `dispatch` throws, the error is swallowed into a
// `jobs_dead_letter` row, and `autoDrainDeadLetterJobs` terminalises any
// `qstash:%` event as "TERMINAL — no internal owner". Delivery must not hinge on a
// DB row nobody set.

test("EVERY lifecycle workload is internal-by-default — none reaches the dead vendor", async () => {
  flagValue = false; // the flag store says OFF, and it no longer matters
  const { scheduleLifecycleWorkload } = await load();
  await scheduleLifecycleWorkload({
    workload: "auction_active",
    buyerId: "buyer_1",
    auctionId: "auction_1",
    firstName: "Sam",
    email: "buyer@example.com",
  });

  assert.equal(enqueued.length, 1, "auction_active now enqueues internally regardless of its flag");
  assert.deepEqual(dispatched, [], "nothing may dispatch into a vendor that no longer answers");
  assert.ok(
    !flagReads.includes("lifecycle_internal_auction"),
    "the flag is not even consulted — routing must not depend on a DB row nobody set"
  );
});

test("a workload whose flag is ON routes internally too — the flag is now irrelevant either way", async () => {
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
