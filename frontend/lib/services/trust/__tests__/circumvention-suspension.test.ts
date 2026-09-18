// §25.2 / §13-D42 — PHASE 10 ENFORCES THE SUSPENSION.
//
// Owner ruling, 2026-09-11: "ACCEPT, 90-day window. Record initiator_role on every
// attempt; consequences apply only to dealer-initiated ones. Phase 5 records and warns,
// Phase 10 enforces suspension."
//
// ── THIS FILE'S FIRST VERSION WAS VACUOUS, AND THAT IS WHY IT LOOKS LIKE THIS ──
//
// It declared a local copy of the suspension predicate and asserted against the copy.
// Every case passed whatever `recordCircumventionAttempt` actually did — deleting the
// entire suspension block from the service would have left it green. It also cited a
// test that did not exist in the file.
//
// The cost was not theoretical: the first independent review found a REAL defect the
// file could not have caught. The predicate counted ALL dealer-initiated attempts in the
// window, not just the in-scope ones, so a dealership whose first attempt was outside a
// paid auction (reviewable, explicitly not a breach) and whose second was inside one
// reached "2" and was SUSPENDED on its first in-scope offence.
//
// So this version drives `recordCircumventionAttempt` END TO END against a mocked
// database and asserts the `dealer.updateMany` THE SERVICE issues. A copy of the rule
// asserts nothing about the rule.
//
// Run: pnpm test:operations

import test from "node:test";
import assert from "node:assert/strict";
import { mock, beforeEach } from "node:test";

interface Ctrl {
  /** What `circumventionAttempt.count` returns, keyed by whether the query is in-scope. */
  allDealerAttempts: number;
  inScopeAttempts: number;
  dealerUpdates: { where: Record<string, unknown>; data: Record<string, unknown> }[];
  audits: Record<string, unknown>[];
  exceptions: Record<string, unknown>[];
  countQueries: Record<string, unknown>[];
  /** The scope the SERVICE will resolve — set per test, never passed in. */
  threadHasDeal: boolean;
  depositPaid: boolean;
}

let ctrl: Ctrl;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      circumventionAttempt: {
        create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "att_1", ...data }),
        count: async ({ where }: { where: Record<string, unknown> }) => {
          ctrl.countQueries.push(where);
          // The service issues TWO different counts. Distinguishing them here is what
          // makes the in-scope assertion below meaningful.
          return where.afterPaidAuction === true ? ctrl.inScopeAttempts : ctrl.allDealerAttempts;
        },
      },
      adminAuditLog: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          ctrl.audits.push(data);
          return data;
        },
      },
      platformAlert: { create: async () => ({}) },
      // The scope is RESOLVED BY THE SERVICE from the thread, not taken from the input —
      // which is why the first fixtures did not reach the suspension path at all, and why
      // this mock has to model the real chain: thread → deal → settled deposit. Driving
      // the service for real means supplying what the service actually reads.
      messageThread: {
        findUnique: async () => (ctrl.threadHasDeal ? { dealId: "deal_1", requestId: null } : null),
      },
      deal: {
        findUnique: async () => ({
          deposit: ctrl.depositPaid ? { status: "PAID", refundedAt: null } : { status: "PENDING", refundedAt: null },
        }),
      },
      dealer: {
        findFirst: async () => ({ id: "d1" }),
        updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          ctrl.dealerUpdates.push(args);
          return { count: 1 };
        },
      },
      message: { findUnique: async () => null },
    },
  },
});

mock.module("@/lib/services/operations/queue-item.service", {
  namedExports: {
    raiseException: async (input: Record<string, unknown>) => {
      ctrl.exceptions.push(input);
      return { item: { id: "q1" }, created: true };
    },
  },
});

beforeEach(() => {
  ctrl = {
    allDealerAttempts: 0,
    inScopeAttempts: 0,
    dealerUpdates: [],
    audits: [],
    exceptions: [],
    countQueries: [],
    threadHasDeal: true,
    depositPaid: true,
  };
});

async function svc() {
  return import("../anti-circumvention.service");
}

/** The thresholds come from the service, never restated here. */
async function thresholds() {
  const { REPEAT_SUSPENSION_THRESHOLD, REPEAT_WINDOW_DAYS } = await svc();
  return { REPEAT_SUSPENSION_THRESHOLD, REPEAT_WINDOW_DAYS };
}

test("the ruling's numbers are read from the service, not restated", async () => {
  const { REPEAT_SUSPENSION_THRESHOLD, REPEAT_WINDOW_DAYS } = await thresholds();
  assert.equal(REPEAT_SUSPENSION_THRESHOLD, 2, "§13-D42: a SECOND attempt within the window");
  assert.equal(REPEAT_WINDOW_DAYS, 90);
});

test("§13-D42: the SUSPENSION count filters on afterPaidAuction; the REPORTING count does not", async () => {
  // THE DEFECT THE FIRST VERSION OF THIS FILE COULD NOT SEE. One out-of-scope attempt
  // plus one in-scope attempt must NOT suspend: the in-scope count is 1, a first offence.
  ctrl.allDealerAttempts = 2; // one pre-auction, one in-auction
  ctrl.inScopeAttempts = 1; // only the second is in §25.2's scope
  const { recordCircumventionAttempt } = await svc();

  await recordCircumventionAttempt({
    threadId: "t1",
    messageId: "m1",
    flag: "CONTACT_ATTEMPT",
    pattern: "phone",
    initiatorRole: "DEALER",
    dealerId: "d1",
    afterPaidAuction: true,
  } as never).catch(() => {
    /* the scope resolver may bail on the mocked thread; the counts are what matter */
  });

  assert.deepEqual(
    ctrl.dealerUpdates,
    [],
    "a dealership whose FIRST in-scope attempt this is must not be suspended — §25.2: an approach " +
      "outside a paid auction is reviewable, not a breach",
  );

  // And the service really did ask both questions.
  const askedInScope = ctrl.countQueries.some((q) => q.afterPaidAuction === true);
  assert.ok(askedInScope, "the suspension must query the IN-SCOPE count, not the reporting one");
});

test("§13-D42: a SECOND in-scope attempt suspends, conditionally and reversibly", async () => {
  ctrl.allDealerAttempts = 5;
  ctrl.inScopeAttempts = 2;
  const { recordCircumventionAttempt } = await svc();

  await recordCircumventionAttempt({
    threadId: "t1",
    messageId: "m1",
    flag: "EXTERNAL_DEAL",
    pattern: "offsite",
    initiatorRole: "DEALER",
    dealerId: "d1",
    afterPaidAuction: true,
  } as never).catch(() => {});

  assert.equal(ctrl.dealerUpdates.length, 1, "the second in-scope attempt suspends");
  // §28.3 #3 — CONDITIONAL. A dealership an admin already TERMINATED must not be walked
  // back to SUSPENDED by an automated rule.
  assert.equal(ctrl.dealerUpdates[0]!.where.status, "ACTIVE");
  assert.equal(ctrl.dealerUpdates[0]!.where.id, "d1");
  assert.equal(ctrl.dealerUpdates[0]!.data.status, "SUSPENDED");
  // And it is audited, because a sanction with no record is not reviewable.
  assert.ok(
    ctrl.audits.some((a) => a.action === "DEALER_SUSPENDED_CIRCUMVENTION"),
    "the suspension must be audited",
  );
});

test("a BUYER-initiated attempt never suspends, whatever the counts say", async () => {
  // §25.2: "Buyers are protected, not penalized, when the dealership initiates." The
  // inverse is not a licence to penalise anyone either.
  ctrl.allDealerAttempts = 99;
  ctrl.inScopeAttempts = 99;
  const { recordCircumventionAttempt } = await svc();

  await recordCircumventionAttempt({
    threadId: "t1",
    messageId: "m1",
    flag: "CONTACT_ATTEMPT",
    pattern: "phone",
    initiatorRole: "BUYER",
    dealerId: "d1",
    afterPaidAuction: true,
  } as never).catch(() => {});

  assert.deepEqual(ctrl.dealerUpdates, [], "no dealer consequence attaches to a buyer-initiated attempt");
});

test("an UNDETERMINED paid-auction scope never suspends — it is not a soft yes", async () => {
  // The queue detail instructs the operator to "Establish it before applying any
  // consequence". Treating NULL as true would suspend on a fact nobody could determine.
  // The thread resolves to nothing, which is how the service produces `null`.
  ctrl.threadHasDeal = false;
  ctrl.allDealerAttempts = 99;
  ctrl.inScopeAttempts = 99;
  const { recordCircumventionAttempt } = await svc();

  await recordCircumventionAttempt({
    threadId: "t1",
    messageId: "m1",
    flag: "CONTACT_ATTEMPT",
    pattern: "phone",
    initiatorRole: "DEALER",
    dealerId: "d1",
  } as never).catch(() => {});

  assert.deepEqual(ctrl.dealerUpdates, [], "an undetermined scope must not produce a commercial sanction");
});

test("the test can actually fail — the suspension path is reachable from these fixtures", async () => {
  // The anti-vacuity floor this file needed and did not have. If no arrangement of the
  // fixtures ever produces a suspension, every assertion above is trivially satisfied.
  ctrl.allDealerAttempts = 2;
  ctrl.inScopeAttempts = 2;
  const { recordCircumventionAttempt } = await svc();
  await recordCircumventionAttempt({
    threadId: "t1",
    messageId: "m1",
    flag: "EXTERNAL_DEAL",
    pattern: "offsite",
    initiatorRole: "DEALER",
    dealerId: "d1",
    afterPaidAuction: true,
  } as never).catch(() => {});
  assert.equal(ctrl.dealerUpdates.length, 1, "the suspension must be reachable, or nothing above means anything");
});
