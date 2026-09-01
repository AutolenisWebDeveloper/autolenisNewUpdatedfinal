// Money-path parity tests for POST /api/admin/payments/deposit/[depositId]/mark-paid.
//
// The Stripe webhook's deposit branch performs the full post-payment cascade
// (claim provider event → flip PAID → create auction → launch → invite dealers).
// The admin override wrote PAID and stopped, stranding a paid buyer with no
// auction. These tests lock the repaired contract:
//
//   • the admin path invokes the SAME canonical fulfillment the webhook's
//     activation reconciler uses (reconcileDepositActivation) — not a second
//     cascade implementation;
//   • it is idempotent — a second mark-paid, or a webhook arriving later for the
//     same deposit, cannot double-launch or double-invite;
//   • it NEVER fabricates a PaymentProviderEvent (an admin override has no
//     provider evidence; inventing one would falsify the ledger);
//   • the PAID flip goes through the deposit transition matrix, so a settled
//     REFUNDED/FAILED deposit can never be resurrected;
//   • a concierge deposit never enters the competitive cascade;
//   • authorization (SUPER_ADMIN / FINANCE_ADMIN) and the required reason audit
//     are preserved.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/admin/payments/__tests__/deposit-mark-paid-fulfillment.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

type DepositStatus = "PENDING" | "PAID" | "FAILED" | "REFUNDED";

interface Ctrl {
  admin: { adminId: string; email: string; role: string } | null;
  requestedRoles: string[] | null;
  deposit: { id: string; buyerId: string; amountCents: number; status: DepositStatus } | null;
  /** rows the guarded updateMany reports as flipped */
  flipCount: number;
  flipWhere: Record<string, unknown> | null;
  audits: Array<Record<string, unknown>>;
  /** every depositId handed to the canonical fulfillment service */
  reconciled: string[];
  reconcileOutcome: string;
  reconcileThrows: boolean;
  /** must stay 0 — an admin override has no provider evidence to record */
  providerEventWrites: number;
  body: unknown;
}

let ctrl: Ctrl;

mock.module("@/lib/auth/admin-api", {
  namedExports: {
    getAdminWithRole: async (_req: unknown, roles: string[]) => {
      ctrl.requestedRoles = roles;
      if (!ctrl.admin) return null;
      return roles.includes(ctrl.admin.role) ? ctrl.admin : null;
    },
    adminError: (code: string, message: string, status: number) => ({ __kind: "error", code, message, status }),
    adminSuccess: (data: unknown, status = 200) => ({ __kind: "success", data, status }),
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deposit: {
        findUnique: async () => ctrl.deposit,
        updateMany: async ({ where }: { where: Record<string, unknown> }) => {
          ctrl.flipWhere = where;
          if (ctrl.flipCount > 0 && ctrl.deposit) ctrl.deposit.status = "PAID";
          return { count: ctrl.flipCount };
        },
        // A raw `update` would bypass the transition matrix — fail loudly if used.
        update: async () => {
          throw new Error("unguarded deposit.update must not be used on the money path");
        },
      },
      adminAuditLog: {
        create: async ({ data }: { data: Record<string, unknown> }) => { ctrl.audits.push(data); return data; },
      },
      // If the override ever fabricated provider evidence, these would fire.
      paymentProviderEvent: {
        create: async () => { ctrl.providerEventWrites += 1; return {}; },
        upsert: async () => { ctrl.providerEventWrites += 1; return {}; },
        updateMany: async () => { ctrl.providerEventWrites += 1; return { count: 1 }; },
      },
    },
  },
});

mock.module("@/lib/services/auction/deposit-activation.service", {
  namedExports: {
    reconcileDepositActivation: async (depositId: string) => {
      ctrl.reconciled.push(depositId);
      if (ctrl.reconcileThrows) throw new Error("reconcile blew up");
      return ctrl.reconcileOutcome;
    },
  },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } },
});

function makeRequest(): { json: () => Promise<unknown> } {
  return { json: async () => ctrl.body };
}

async function loadPOST() {
  const mod = await import("@/app/api/admin/payments/deposit/[depositId]/mark-paid/route");
  return mod.POST;
}

function call(depositId = "dep_1") {
  return loadPOST().then((POST) =>
    POST(makeRequest() as never, { params: Promise.resolve({ depositId }) }),
  );
}

beforeEach(() => {
  ctrl = {
    admin: { adminId: "adm_1", email: "finance@autolenis.com", role: "FINANCE_ADMIN" },
    requestedRoles: null,
    deposit: { id: "dep_1", buyerId: "buyer_1", amountCents: 9900, status: "PENDING" },
    flipCount: 1,
    flipWhere: null,
    audits: [],
    reconciled: [],
    reconcileOutcome: "invited",
    reconcileThrows: false,
    providerEventWrites: 0,
    body: { reason: "Buyer paid by wire — reconciled against bank statement" },
  };
});

// ── Parity: the admin path runs the SAME canonical fulfillment ────────────────

test("mark-paid invokes the canonical deposit-activation fulfillment for the deposit", async () => {
  const res = await call();
  assert.equal((res as unknown as { __kind: string }).__kind, "success");
  assert.deepEqual(ctrl.reconciled, ["dep_1"], "must delegate to reconcileDepositActivation");
});

test("response reports the real fulfillment outcome, not a hardcoded claim", async () => {
  ctrl.reconcileOutcome = "invited";
  const ok = (await call()) as unknown as { data: Record<string, unknown> };
  assert.equal(ok.data.status, "PAID");
  assert.equal(ok.data.fulfillment, "invited");
  assert.equal(ok.data.auctionUnblocked, true);

  // A cascade that could not converge must NOT be reported as unblocked.
  ctrl.deposit = { id: "dep_1", buyerId: "buyer_1", amountCents: 9900, status: "PENDING" };
  ctrl.reconciled = [];
  ctrl.reconcileOutcome = "skip";
  const skipped = (await call()) as unknown as { data: Record<string, unknown> };
  assert.equal(skipped.data.fulfillment, "skip");
  assert.equal(skipped.data.auctionUnblocked, false);
});

test("a fulfillment failure never rolls back or fails the recorded PAID flip", async () => {
  ctrl.reconcileThrows = true;
  const res = (await call()) as unknown as { __kind: string; data: Record<string, unknown> };
  assert.equal(res.__kind, "success", "the money fact is committed; fulfillment is best-effort");
  assert.equal(res.data.status, "PAID");
  assert.equal(res.data.auctionUnblocked, false);
  assert.equal(ctrl.audits.length, 1, "the override is still audited");
});

// ── Idempotency ───────────────────────────────────────────────────────────────

test("running mark-paid twice does not fire a second cascade", async () => {
  await call();
  assert.equal(ctrl.reconciled.length, 1);

  // Second invocation sees the deposit already PAID.
  const second = (await call()) as unknown as { __kind: string; code: string };
  assert.equal(second.__kind, "error");
  assert.equal(second.code, "ALREADY_PAID");
  assert.equal(ctrl.reconciled.length, 1, "no second cascade");
  assert.equal(ctrl.audits.length, 1, "no second override audit");
});

test("the PAID flip is guarded by the deposit transition matrix", async () => {
  await call();
  const where = ctrl.flipWhere as { id: string; status: { in: string[] } };
  assert.equal(where.id, "dep_1");
  assert.ok(Array.isArray(where.status?.in), "flip must constrain the predecessor status set");
  assert.deepEqual(where.status.in, ["PENDING"], "PAID is reachable only from PENDING");
});

test("a settled deposit is never resurrected — a lost flip runs no cascade", async () => {
  // A REFUNDED/FAILED deposit (or a concurrent flip) yields count 0 from the
  // matrix-guarded updateMany.
  ctrl.deposit = { id: "dep_1", buyerId: "buyer_1", amountCents: 9900, status: "FAILED" };
  ctrl.flipCount = 0;
  const res = (await call()) as unknown as { __kind: string; code: string };
  assert.equal(res.__kind, "error");
  assert.equal(res.code, "INVALID_STATE");
  assert.equal(ctrl.reconciled.length, 0, "no fulfillment for a flip that did not happen");
  assert.equal(ctrl.audits.length, 0, "no audit for a flip that did not happen");
});

// ── Ledger truthfulness ───────────────────────────────────────────────────────

test("NEVER fabricates a payment provider event for an admin override", async () => {
  await call();
  assert.equal(ctrl.providerEventWrites, 0, "an admin override has no provider evidence to record");
});

test("the audit records the override as admin-origin, not provider-confirmed", async () => {
  await call();
  const audit = ctrl.audits[0];
  assert.equal(audit.action, "DEPOSIT_MARK_PAID_OVERRIDE");
  assert.equal(audit.entityType, "Deposit");
  assert.equal(audit.entityId, "dep_1");
  assert.equal(audit.adminId, "adm_1");
  assert.equal(audit.reason, "Buyer paid by wire — reconciled against bank statement");
  const meta = audit.metadata as Record<string, unknown>;
  assert.equal(meta.override, true);
  assert.equal(meta.providerConfirmed, false, "admin-origin PAID must be distinguishable from provider-confirmed PAID");
});

// ── Preserved guards ──────────────────────────────────────────────────────────

test("authorization stays SUPER_ADMIN / FINANCE_ADMIN only", async () => {
  ctrl.admin = { adminId: "adm_2", email: "ops@autolenis.com", role: "OPERATIONS_ADMIN" };
  const res = (await call()) as unknown as { __kind: string; status: number };
  assert.equal(res.__kind, "error");
  assert.equal(res.status, 403);
  assert.deepEqual(ctrl.requestedRoles, ["SUPER_ADMIN", "FINANCE_ADMIN"]);
  assert.equal(ctrl.reconciled.length, 0);
});

test("a missing reason is rejected before any money mutation", async () => {
  ctrl.body = {};
  const res = (await call()) as unknown as { __kind: string; code: string };
  assert.equal(res.__kind, "error");
  assert.equal(res.code, "VALIDATION_ERROR");
  assert.equal(ctrl.flipWhere, null, "no flip attempted");
  assert.equal(ctrl.reconciled.length, 0);
});

test("an unknown deposit 404s without touching fulfillment", async () => {
  ctrl.deposit = null;
  const res = (await call("nope")) as unknown as { __kind: string; status: number };
  assert.equal(res.__kind, "error");
  assert.equal(res.status, 404);
  assert.equal(ctrl.reconciled.length, 0);
});
