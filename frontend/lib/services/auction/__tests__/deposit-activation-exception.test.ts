// W0-A (Program 1) — the ONE human-required outcome of the deposit-activation
// reconciler must become an operational exception, not a buried log line.
//
// When a PAID $99 deposit converges to a no-dealer close, the reconciler raises an
// ops-only SYSTEM_ALERT (no buyerId — the buyer is never told "no dealers"), keyed
// per deposit so repeat sweeps never duplicate it. The $99 is retained; no refund
// is auto-issued. These tests lock that behavior on the close path.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks lib/services/auction/__tests__/deposit-activation-exception.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

const db = {
  deposit: null as Record<string, unknown> | null,
  closeCount: 1,
  existingAlert: false,
  createdNotifications: [] as Array<Record<string, unknown>>,
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deposit: { findUnique: async () => db.deposit },
      auction: {
        updateMany: async ({ data }: { data: Record<string, unknown> }) =>
          // Only the CLOSE write matters here (status → CLOSED).
          data.status === "CLOSED" ? { count: db.closeCount } : { count: 0 },
      },
      notification: {
        findFirst: async () => (db.existingAlert ? { id: "existing" } : null),
        create: async ({ data }: { data: Record<string, unknown> }) => { db.createdNotifications.push(data); return { id: "n1" }; },
      },
    },
  },
});

mock.module("@/lib/services/auction/auction.service", {
  namedExports: { createAuction: async () => {}, launchAuction: async () => {} },
});
mock.module("@/lib/services/auction/dealer-invitation.service", {
  namedExports: { inviteDealersToAuction: async () => 0 },
});
mock.module("@/lib/jobs/idempotency", {
  namedExports: {
    getSupabase: () => ({}),
    acquireIdempotencyGuard: async () => true,
    releaseIdempotencyGuard: async () => {},
  },
});

function strandedDeposit() {
  return {
    buyerId: "buyer_1",
    status: "PAID",
    refundedAt: null,
    // ACTIVE auction, zero invitations/offers, aged past the 120m no-dealer grace.
    auction: {
      id: "auc_1",
      status: "ACTIVE",
      createdAt: new Date(Date.now() - 200 * 60_000),
      _count: { invitations: 0, offers: 0 },
    },
  };
}

beforeEach(() => {
  db.deposit = strandedDeposit();
  db.closeCount = 1;
  db.existingAlert = false;
  db.createdNotifications = [];
});

test("no-dealer close raises an ops-only SYSTEM_ALERT (no buyerId, no auto-refund)", async () => {
  const { reconcileDepositActivation } = await import("@/lib/services/auction/deposit-activation.service");
  const outcome = await reconcileDepositActivation("dep_1");
  assert.equal(outcome, "closed_no_dealers");
  assert.equal(db.createdNotifications.length, 1);
  const n = db.createdNotifications[0]!;
  assert.equal(n.type, "SYSTEM_ALERT");
  assert.equal(n.buyerId, undefined, "ops-only: the buyer must not be notified");
  assert.match(String(n.title), /dep_1/);
  assert.match(String(n.body), /do NOT auto-refund/);
  assert.match(String(n.body), /auc_1/);
});

test("idempotent: a sweep that finds an existing alert raises no duplicate", async () => {
  db.existingAlert = true;
  const { reconcileDepositActivation } = await import("@/lib/services/auction/deposit-activation.service");
  const outcome = await reconcileDepositActivation("dep_1");
  assert.equal(outcome, "closed_no_dealers");
  assert.equal(db.createdNotifications.length, 0);
});

test("no exception is raised when the close claim is lost (another run closed it first)", async () => {
  db.closeCount = 0; // our updateMany matched nothing → someone else closed it
  const { reconcileDepositActivation } = await import("@/lib/services/auction/deposit-activation.service");
  const outcome = await reconcileDepositActivation("dep_1");
  assert.notEqual(outcome, "closed_no_dealers");
  assert.equal(db.createdNotifications.length, 0, "only the run that actually closed raises the exception");
});
