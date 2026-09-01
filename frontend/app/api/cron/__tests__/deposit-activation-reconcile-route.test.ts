// Deposit settlement + activation reconciler cron (/api/cron/deposit-activation-reconcile).
//
// The cron now runs two stages: SETTLEMENT (P0 #2 — a PENDING deposit whose
// Stripe PaymentIntent already succeeded becomes PAID) followed by the original
// ACTIVATION sweep. The ordering matters: settlement is what produces the PAID
// deposits activation converges into auctions, so a deposit paid in the real
// world reaches a live auction within one tick.
//
// These tests pin the composition, not the sweeps themselves (each has its own
// suite). Specifically: with the settlement switch OFF — the default — the cron
// must still be a COMPLETED run that performs activation, and must report the
// skip truthfully rather than presenting zero counters as a completed sweep.
//
// The settlement service is loaded FOR REAL here (only its data access and
// provider client are mocked), so the default-off gate is exercised rather than
// stubbed: any Prisma read or Stripe call while disabled means the gate leaked.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//   "app/api/cron/__tests__/deposit-activation-reconcile-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

let cronOutcome: { name: string; status: "COMPLETED" | "FAILED"; result?: unknown } | null = null;
let depositQueries = 0;
let intentLookups = 0;
let activationRuns = 0;
let activationThrows = false;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deposit: {
        findMany: async () => { depositQueries += 1; return []; },
        updateMany: async () => ({ count: 0 }),
      },
      notification: { findFirst: async () => null, create: async () => ({}) },
    },
  },
});

mock.module("@/lib/services/payment/stripe.service", {
  namedExports: {
    retrievePaymentIntent: async () => { intentLookups += 1; return { status: "succeeded" }; },
  },
});

mock.module("@/lib/services/auction/deposit-activation.service", {
  namedExports: {
    reconcileStuckActivations: async () => {
      activationRuns += 1;
      if (activationThrows) throw new Error("activation blew up");
      return { scanned: 2, outcomes: { created: 1, ok: 1 } };
    },
  },
});

mock.module("@/lib/security/cron-auth", {
  namedExports: { authorizeCronRequest: () => null },
});

mock.module("@/lib/services/monitoring/cron-monitor.service", {
  namedExports: {
    withCronRun: async (name: string, work: () => Promise<unknown>) => {
      try {
        const result = await work();
        cronOutcome = { name, status: "COMPLETED", result };
        return { ok: true, result };
      } catch (error) {
        cronOutcome = { name, status: "FAILED" };
        return { ok: false, error };
      }
    },
  },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

async function load() {
  return (await import("@/app/api/cron/deposit-activation-reconcile/route")).GET;
}

function req() {
  return new NextRequest("https://autolenis.com/api/cron/deposit-activation-reconcile");
}

function env(): Record<string, string | undefined> {
  return process.env as Record<string, string | undefined>;
}

beforeEach(() => {
  cronOutcome = null;
  depositQueries = 0;
  intentLookups = 0;
  activationRuns = 0;
  activationThrows = false;
  delete env().DEPOSIT_SETTLEMENT_RECONCILE_ENABLED;
  assert.equal(env().DEPOSIT_SETTLEMENT_RECONCILE_ENABLED, undefined);
});

test("settlement OFF (default): the run COMPLETES and still performs activation", async () => {
  const GET = await load();
  const res = await GET(req());
  const body = (await res.json()) as { success: boolean; data: Record<string, { skipped?: string; scanned?: number }> };

  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.equal(cronOutcome?.status, "COMPLETED", "a disabled stage is not a failed cron run");
  assert.equal(activationRuns, 1, "activation must not be blocked by settlement being off");
  assert.equal(body.data.activation.scanned, 2);
});

test("settlement OFF: the skip is reported, not disguised as a completed sweep", async () => {
  const GET = await load();
  const res = await GET(req());
  const body = (await res.json()) as { data: { settlement: { skipped?: string; settled: number } } };

  assert.equal(body.data.settlement.skipped, "deposit_settlement_reconciler_disabled");
  assert.equal(body.data.settlement.settled, 0);
});

test("settlement OFF: nothing is read or looked up — the gate does not leak", async () => {
  const GET = await load();
  await GET(req());

  assert.equal(depositQueries, 0, "no deposit query while disabled");
  assert.equal(intentLookups, 0, "no Stripe round-trip while disabled");
});

test("settlement ON: the sweep runs and reports counters instead of a skip", async () => {
  env().DEPOSIT_SETTLEMENT_RECONCILE_ENABLED = "true";

  const GET = await load();
  const res = await GET(req());
  const body = (await res.json()) as { data: { settlement: { skipped?: string; scanned: number } } };

  assert.equal(body.data.settlement.skipped, undefined);
  assert.equal(depositQueries, 1, "the sweep actually queried once it was enabled");
  assert.equal(body.data.settlement.scanned, 0, "no candidates in this fixture, reported honestly");
});

test("an activation failure still surfaces as a failed run", async () => {
  activationThrows = true;

  const GET = await load();
  const res = await GET(req());

  assert.equal(res.status, 500);
  assert.equal(cronOutcome?.status, "FAILED", "a real failure must not be masked by the new composition");
});
