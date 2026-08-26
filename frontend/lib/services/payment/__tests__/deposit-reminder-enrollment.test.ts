// Unit tests for the $99 deposit-reminder ENROLLMENT single-authority selector.
//
// Pins (Sections 3 + 11):
//   • DEFAULT (flag unset/≠"true") → QStash producer, first touch at +1 day
//     (the legacy authority is unchanged until owner cutover);
//   • DEPOSIT_REMINDER_INTERNAL_ENABLED==="true" → internal lifecycle_touch,
//     deposit_reminder_1 at run_at = +1 HOUR (the intentional first-touch grace);
//   • exactly ONE producer fires per enrollment (never both);
//   • idempotent: an internal conflict reports enrolled:false;
//   • cancelDepositReminderEnrollment stops the internal chain.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/payment/__tests__/deposit-reminder-enrollment.test.ts"

import test, { mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

interface Ctrl {
  dispatches: Array<Record<string, unknown>>;
  enqueues: Array<Record<string, unknown>>;
  cancels: Array<{ buyerId: string; opts: Record<string, unknown> }>;
  enqueueScheduled: boolean;
}
let ctrl: Ctrl;

mock.module("@/lib/qstash/dispatch", {
  namedExports: {
    dispatch: async (d: Record<string, unknown>) => { ctrl.dispatches.push(d); },
  },
});

mock.module("@/lib/services/crm/lifecycle-touch-drain.service", {
  namedExports: {
    enqueueLifecycleTouch: async (input: Record<string, unknown>) => {
      ctrl.enqueues.push(input);
      return { scheduled: ctrl.enqueueScheduled };
    },
    cancelDepositReminderTouches: async (buyerId: string, opts: Record<string, unknown>) => {
      ctrl.cancels.push({ buyerId, opts });
      return { canceled: 1, status: "OK" };
    },
    depositReminderBaseKey: (buyerId: string) => `deposit-reminder:${buyerId}`,
  },
});

async function load() {
  return import("@/lib/services/payment/deposit-reminder-enrollment");
}

const HR = 60 * 60 * 1000;
const savedEnv = process.env.DEPOSIT_REMINDER_INTERNAL_ENABLED;

beforeEach(() => {
  ctrl = { dispatches: [], enqueues: [], cancels: [], enqueueScheduled: true };
  delete process.env.DEPOSIT_REMINDER_INTERNAL_ENABLED;
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env.DEPOSIT_REMINDER_INTERNAL_ENABLED;
  else process.env.DEPOSIT_REMINDER_INTERNAL_ENABLED = savedEnv;
});

test("DEFAULT authority is QStash — dispatches touch 1 at +1 day, no internal enqueue", async () => {
  const { enrollDepositReminder, depositReminderAuthority } = await load();
  assert.equal(depositReminderAuthority(), "qstash");
  const r = await enrollDepositReminder({ buyerId: "b1", firstName: "Sam", email: "s@x.com", phone: null });
  assert.equal(r.authority, "qstash");
  assert.equal(r.enrolled, true);
  assert.equal(ctrl.dispatches.length, 1, "exactly one QStash producer");
  assert.equal(ctrl.enqueues.length, 0, "internal producer must NOT also fire (never both)");
  const d = ctrl.dispatches[0];
  assert.equal(d.path, "/api/jobs/deposit-reminder");
  assert.equal((d.body as Record<string, unknown>).touchNumber, 1);
  assert.equal((d.body as Record<string, unknown>).buyerId, "b1");
  assert.equal(d.delaySeconds, 86400);
});

test("INTERNAL authority (flag=true) — enqueues deposit_reminder_1 at +1h, no QStash dispatch", async () => {
  process.env.DEPOSIT_REMINDER_INTERNAL_ENABLED = "true";
  const { enrollDepositReminder, depositReminderAuthority } = await load();
  assert.equal(depositReminderAuthority(), "internal");
  const before = Date.now();
  const r = await enrollDepositReminder({ buyerId: "b1", firstName: "Sam", email: "s@x.com", phone: "+15551234567" });
  assert.equal(r.authority, "internal");
  assert.equal(r.enrolled, true);
  assert.equal(ctrl.enqueues.length, 1, "exactly one internal producer");
  assert.equal(ctrl.dispatches.length, 0, "QStash producer must NOT also fire (never both)");
  const e = ctrl.enqueues[0];
  assert.equal(e.sequence, "deposit_reminder_1");
  assert.equal(e.entityId, "b1");
  assert.equal(e.baseKey, "deposit-reminder:b1");
  assert.equal(e.phone, "+15551234567");
  const runAt = new Date(e.runAt as Date).getTime();
  assert.ok(runAt >= before + HR - 5000 && runAt <= Date.now() + HR + 5000, "first touch ≈ +1h grace");
});

test("INTERNAL enrollment is idempotent — a conflict reports enrolled:false", async () => {
  process.env.DEPOSIT_REMINDER_INTERNAL_ENABLED = "true";
  ctrl.enqueueScheduled = false; // UNIQUE(base_key, sequence) conflict
  const { enrollDepositReminder } = await load();
  const r = await enrollDepositReminder({ buyerId: "b1", firstName: "Sam", email: "s@x.com" });
  assert.equal(r.enrolled, false);
  assert.equal(ctrl.enqueues.length, 1);
});

test("cancelDepositReminderEnrollment cancels the internal chain with a reason", async () => {
  const { cancelDepositReminderEnrollment } = await load();
  await cancelDepositReminderEnrollment("b1", "deposit_paid");
  assert.equal(ctrl.cancels.length, 1);
  assert.equal(ctrl.cancels[0].buyerId, "b1");
  assert.equal(ctrl.cancels[0].opts.reason, "deposit_paid");
});
