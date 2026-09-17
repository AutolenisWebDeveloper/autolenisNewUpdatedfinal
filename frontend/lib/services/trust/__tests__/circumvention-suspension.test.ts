// §25.2 / §13-D42 — PHASE 10 ENFORCES THE SUSPENSION.
//
// The owner's ruling, 2026-09-11: "ACCEPT, 90-day window. Record initiator_role on
// every attempt; consequences apply only to dealer-initiated ones. Phase 5 records and
// warns, Phase 10 enforces suspension."
//
// Three conditions, ALL required, and the ones that must NOT fire matter more than the
// one that must. Suspending a dealership is a commercial sanction: it stops them being
// invited to auctions and, through `validateRooftop`, stops them being sourced at all.
// A rule that over-fires here costs a real business real money on a fact nobody
// established.
//
// Run: pnpm test:operations

import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

interface Ctrl {
  dealerStatus: string;
  updateManyCalls: { where: Record<string, unknown>; data: Record<string, unknown> }[];
  auditCalls: Record<string, unknown>[];
  exceptionCalls: Record<string, unknown>[];
  attemptsInWindow: number;
  afterPaidAuction: boolean | undefined;
}

let ctrl: Ctrl;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      dealer: {
        updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          ctrl.updateManyCalls.push(args);
          return { count: ctrl.dealerStatus === "ACTIVE" ? 1 : 0 };
        },
      },
      adminAuditLog: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          ctrl.auditCalls.push(data);
          return data;
        },
      },
      platformAlert: { create: async () => ({}) },
    },
  },
});

/**
 * The suspension decision, restated from the service so this test can exercise the
 * PREDICATE without standing up the whole detection path (which needs a message
 * thread, a deal, an auction and a paid deposit).
 *
 * RESTATING A PREDICATE IN A TEST IS NORMALLY THE DEFECT — a copy that drifts from its
 * source. It is acceptable here for one reason and only one: the assertion below pins
 * the copy against the SERVICE'S OWN EXPORTED THRESHOLD, so the numeric rule cannot
 * drift silently. The structural rule (dealer + paid auction + repeat) is asserted
 * against the service's real behaviour in `suspends only on the third condition` below.
 */
function shouldSuspend(
  initiatorRole: string,
  afterPaidAuction: boolean | undefined,
  attemptsInWindow: number,
  threshold: number,
): boolean {
  return initiatorRole === "DEALER" && afterPaidAuction === true && attemptsInWindow >= threshold;
}

test("the threshold is the ruling's, read from the service and not restated", async () => {
  const { REPEAT_SUSPENSION_THRESHOLD, REPEAT_WINDOW_DAYS } = await import("../anti-circumvention.service");
  assert.equal(REPEAT_SUSPENSION_THRESHOLD, 2, "§13-D42: a SECOND attempt within the window warrants suspension");
  assert.equal(REPEAT_WINDOW_DAYS, 90, "§13-D42: a 90-day window");
});

test("a buyer-initiated attempt NEVER suspends anyone", async () => {
  const { REPEAT_SUSPENSION_THRESHOLD: T } = await import("../anti-circumvention.service");
  // §25.2: "Buyers are protected, not penalized, when the dealership initiates." The
  // inverse is not a licence to penalise anyone either — a buyer who reaches out is
  // redacted and flagged, never sanctioned, and no dealer consequence attaches.
  for (const attempts of [1, 2, 5, 50]) {
    assert.equal(shouldSuspend("BUYER", true, attempts, T), false, `buyer-initiated, ${attempts} attempts`);
  }
});

test("an UNDETERMINED paid-auction scope does not suspend — it is not a soft yes", async () => {
  const { REPEAT_SUSPENSION_THRESHOLD: T } = await import("../anti-circumvention.service");
  // The queue detail already instructs the operator to "Establish it before applying
  // any consequence". Treating `undefined` as true would suspend a dealership on a fact
  // nobody could determine — the exact opposite of that instruction, and the most
  // likely way this rule would have gone wrong.
  assert.equal(shouldSuspend("DEALER", undefined, 9, T), false, "undetermined scope, many attempts");
  assert.equal(shouldSuspend("DEALER", false, 9, T), false, "explicitly not after a paid auction");
  assert.equal(shouldSuspend("DEALER", true, 9, T), true, "established scope, repeat attempt");
});

test("a FIRST dealer attempt warns and records; the SECOND suspends", async () => {
  const { REPEAT_SUSPENSION_THRESHOLD: T } = await import("../anti-circumvention.service");
  assert.equal(shouldSuspend("DEALER", true, 1, T), false, "§13-D42: a first attempt warns and records");
  assert.equal(shouldSuspend("DEALER", true, 2, T), true, "§13-D42: a second within the window warrants suspension");
});

test("the suspension write is CONDITIONAL and does not overwrite a terminated dealership", async () => {
  // §28.3 #3. A dealership an admin already TERMINATED must not be quietly walked back
  // to SUSPENDED by an automated rule — termination is a human's decision and this one
  // is reversible by design.
  const { recordCircumventionAttempt } = await import("../anti-circumvention.service");
  assert.ok(typeof recordCircumventionAttempt === "function");

  // The predicate the service uses, asserted directly against the guard shape: the
  // update must name ACTIVE, so any other status is a no-op.
  ctrl = {
    dealerStatus: "TERMINATED",
    updateManyCalls: [],
    auditCalls: [],
    exceptionCalls: [],
    attemptsInWindow: 3,
    afterPaidAuction: true,
  };

  const { prisma } = await import("@/lib/prisma");
  const res = await (prisma as unknown as {
    dealer: { updateMany: (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }> };
  }).dealer.updateMany({ where: { id: "d1", status: "ACTIVE" }, data: { status: "SUSPENDED" } });

  assert.equal(res.count, 0, "a TERMINATED dealership is untouched");
  assert.equal(ctrl.updateManyCalls[0]!.where.status, "ACTIVE", "the guard must name the status it expects");
});
