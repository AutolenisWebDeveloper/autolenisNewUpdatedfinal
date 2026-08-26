// Unit tests for the $99 PRE-CHECKOUT enrollment single-authority selector.
//
// Pins: exactly ONE producer fires (never both); default = QStash (legacy,
// unchanged); flag=true = internal lifecycle form_submitted at base_key
// precheckout:{buyerId}; cancel stops the internal chain (the handoff).
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/payment/__tests__/precheckout-enrollment.test.ts"

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
  namedExports: { dispatch: async (d: Record<string, unknown>) => { ctrl.dispatches.push(d); } },
});

mock.module("@/lib/services/crm/lifecycle-touch-drain.service", {
  namedExports: {
    enqueueLifecycleTouch: async (input: Record<string, unknown>) => {
      ctrl.enqueues.push(input);
      return { scheduled: ctrl.enqueueScheduled };
    },
    cancelPreCheckoutTouches: async (buyerId: string, opts: Record<string, unknown>) => {
      ctrl.cancels.push({ buyerId, opts });
      return { canceled: 1, status: "OK" };
    },
    preCheckoutBaseKey: (buyerId: string) => `precheckout:${buyerId}`,
  },
});

async function load() {
  return import("@/lib/services/payment/precheckout-enrollment");
}

const saved = process.env.PRECHECKOUT_CONVERSION_INTERNAL_ENABLED;

beforeEach(() => {
  ctrl = { dispatches: [], enqueues: [], cancels: [], enqueueScheduled: true };
  delete process.env.PRECHECKOUT_CONVERSION_INTERNAL_ENABLED;
});
afterEach(() => {
  if (saved === undefined) delete process.env.PRECHECKOUT_CONVERSION_INTERNAL_ENABLED;
  else process.env.PRECHECKOUT_CONVERSION_INTERNAL_ENABLED = saved;
});

test("DEFAULT authority is QStash — dispatches form-submitted, no internal enqueue", async () => {
  const { enrollPreCheckout, preCheckoutAuthority } = await load();
  assert.equal(preCheckoutAuthority(), "qstash");
  const r = await enrollPreCheckout({ buyerId: "b1", firstName: "Sam", email: "s@x.com", phone: null, campaign: "lp" });
  assert.equal(r.authority, "qstash");
  assert.equal(ctrl.dispatches.length, 1);
  assert.equal(ctrl.enqueues.length, 0, "internal must NOT also fire (never both)");
  assert.equal(ctrl.dispatches[0].path, "/api/jobs/form-submitted");
  assert.equal((ctrl.dispatches[0].body as Record<string, unknown>).buyerId, "b1");
  assert.equal((ctrl.dispatches[0].body as Record<string, unknown>).campaign, "lp");
});

test("INTERNAL authority (flag=true) — enqueues form_submitted at precheckout base_key, no QStash", async () => {
  process.env.PRECHECKOUT_CONVERSION_INTERNAL_ENABLED = "true";
  const { enrollPreCheckout, preCheckoutAuthority } = await load();
  assert.equal(preCheckoutAuthority(), "internal");
  const r = await enrollPreCheckout({ buyerId: "b1", firstName: "Sam", email: "s@x.com" });
  assert.equal(r.authority, "internal");
  assert.equal(ctrl.enqueues.length, 1);
  assert.equal(ctrl.dispatches.length, 0, "QStash must NOT also fire (never both)");
  const e = ctrl.enqueues[0];
  assert.equal(e.sequence, "form_submitted");
  assert.equal(e.baseKey, "precheckout:b1");
  assert.equal(e.entityId, "b1");
});

test("INTERNAL enrollment is idempotent — a conflict reports enrolled:false", async () => {
  process.env.PRECHECKOUT_CONVERSION_INTERNAL_ENABLED = "true";
  ctrl.enqueueScheduled = false;
  const { enrollPreCheckout } = await load();
  const r = await enrollPreCheckout({ buyerId: "b1", firstName: "Sam", email: "s@x.com" });
  assert.equal(r.enrolled, false);
});

test("cancelPreCheckoutEnrollment stops the internal chain (handoff)", async () => {
  const { cancelPreCheckoutEnrollment } = await load();
  await cancelPreCheckoutEnrollment("b1", "checkout_started");
  assert.equal(ctrl.cancels.length, 1);
  assert.equal(ctrl.cancels[0].buyerId, "b1");
  assert.equal(ctrl.cancels[0].opts.reason, "checkout_started");
});
