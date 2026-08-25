// Program 1 — provider-evidence reconciliation invariant.
//
// A PAID deposit linked to a real Stripe PaymentIntent must have provider evidence
// in payment_provider_events. checkDepositProviderEvidence() surfaces the ones that
// don't as an operational exception for reconciliation — and, critically, does it
// TRUTHFULLY: it raises an alert, it NEVER fabricates a PaymentProviderEvent from a
// deposit row. These tests lock that contract.
//
// Run: pnpm test:monitoring

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const state = {
  gapRows: [] as Array<{ id: string; pi: string }>,
  queryThrows: false,
  recentTitles: new Set<string>(),
  createdNotifications: [] as Array<Record<string, unknown>>,
  providerEventWrites: 0, // must stay 0 — reconciliation may never fabricate evidence
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      $queryRaw: async () => {
        if (state.queryThrows) throw new Error("db down");
        return state.gapRows;
      },
      notification: {
        findFirst: async ({ where }: { where: { title: string } }) =>
          state.recentTitles.has(where.title) ? { id: "existing" } : null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          state.createdNotifications.push(data);
          return { id: "n1", ...data };
        },
      },
      // If reconciliation ever tried to fabricate a provider event, this would fire.
      paymentProviderEvent: {
        create: async () => { state.providerEventWrites += 1; return {}; },
        update: async () => { state.providerEventWrites += 1; return {}; },
      },
    },
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

beforeEach(() => {
  state.gapRows = [];
  state.queryThrows = false;
  state.recentTitles = new Set<string>();
  state.createdNotifications = [];
  state.providerEventWrites = 0;
});

test("flags each PAID+pi_ deposit lacking provider evidence with a reconciliation SYSTEM_ALERT", async () => {
  const { checkDepositProviderEvidence } = await import("@/lib/services/monitoring/health.service");
  state.gapRows = [
    { id: "dep_a", pi: "pi_111" },
    { id: "dep_b", pi: "pi_222" },
  ];
  const res = await checkDepositProviderEvidence();
  assert.equal(res.gaps, 2);
  assert.equal(state.createdNotifications.length, 2);
  assert.equal(state.createdNotifications[0].type, "SYSTEM_ALERT");
  assert.match(String(state.createdNotifications[0].title), /dep_a/);
  assert.match(String(state.createdNotifications[0].body), /pi_111/);
  assert.match(String(state.createdNotifications[0].body), /do NOT fabricate a provider event/);
});

test("NEVER fabricates a provider event (evidence, not inference)", async () => {
  const { checkDepositProviderEvidence } = await import("@/lib/services/monitoring/health.service");
  state.gapRows = [{ id: "dep_a", pi: "pi_111" }];
  await checkDepositProviderEvidence();
  assert.equal(state.providerEventWrites, 0, "reconciliation must never write a PaymentProviderEvent");
});

test("idempotent: a deposit already alerted is not re-alerted", async () => {
  const { checkDepositProviderEvidence } = await import("@/lib/services/monitoring/health.service");
  state.gapRows = [{ id: "dep_a", pi: "pi_111" }];
  state.recentTitles = new Set(["Reconcile: PAID deposit lacks Stripe provider evidence: dep_a"]);
  const res = await checkDepositProviderEvidence();
  assert.equal(res.gaps, 1, "still reports the gap count");
  assert.equal(state.createdNotifications.length, 0, "but raises no duplicate alert");
});

test("no gaps → no alerts", async () => {
  const { checkDepositProviderEvidence } = await import("@/lib/services/monitoring/health.service");
  const res = await checkDepositProviderEvidence();
  assert.equal(res.gaps, 0);
  assert.equal(state.createdNotifications.length, 0);
});

test("query failure degrades to zero gaps, never throws", async () => {
  const { checkDepositProviderEvidence } = await import("@/lib/services/monitoring/health.service");
  state.queryThrows = true;
  const res = await checkDepositProviderEvidence();
  assert.equal(res.gaps, 0);
});
