// Fulfillment-parity tests for POST /api/admin/buyers/[buyerId]/deposit/override
//
// Lives here (not co-located under the [buyerId] segment) because node:test
// treats "[" as a glob metacharacter, so a path containing the [buyerId] segment
// cannot be passed to the runner. The route is imported via the @/ alias, which
// tsx resolves from tsconfig paths without shell globbing.
//
// This route mints a PAID $99 deposit with no Stripe payment behind it, to
// unblock a buyer manually. Minting PAID and stopping there is exactly the gap
// that stranded paid buyers: the deposit says PAID, and nothing downstream ever
// runs. It must hand off to the SAME canonical fulfillment the Stripe webhook's
// activation reconciler drives — and, because an override has no provider
// evidence, it must never fabricate a PaymentProviderEvent.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/admin/buyers/__tests__/deposit-override-fulfillment-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

const ctrl = {
  reconciled: [] as string[],
  reconcileOutcome: "invited",
  reconcileThrows: false,
  providerEventWrites: 0,
  audits: [] as Array<Record<string, unknown>>,
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      buyer: {
        findUnique: async () => ({
          id: "buyer_1",
          firstName: "Sam",
          user: { email: "buyer@example.com" },
        }),
      },
      deposit: {
        findFirst: async () => null,
        create: async () => ({ id: "dep_1", buyerId: "buyer_1", amountCents: 9900, status: "PAID" }),
      },
      adminAuditLog: {
        create: async ({ data }: { data: Record<string, unknown> }) => { ctrl.audits.push(data); return { id: "log_1" }; },
      },
      notification: { create: async () => ({ id: "notif_1" }) },
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

mock.module("@/lib/services/email/resend.service", {
  namedExports: { sendDepositConfirmationEmail: async () => undefined },
});
mock.module("@/lib/services/admin/buyer-crm-sync", {
  namedExports: { syncBuyerLifecycleToCrm: async () => undefined },
});
mock.module("@/lib/auth/permissions", {
  namedExports: {
    requirePermission: async () => ({
      adminId: "admin_1",
      email: "finance@autolenis.com",
      role: "FINANCE_ADMIN",
      mfaVerified: true,
    }),
  },
});
mock.module("@/lib/auth/admin-api", {
  namedExports: {
    adminSuccess: <T,>(data: T, status = 200) => NextResponse.json({ success: true, data }, { status }),
    adminError: (code: string, message: string, status = 400) =>
      NextResponse.json({ error: { code, message } }, { status }),
  },
});
mock.module("@/lib/logger", {
  namedExports: { logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } },
});

async function call() {
  const mod = await import("@/app/api/admin/buyers/[buyerId]/deposit/override/route");
  const req = new NextRequest("http://localhost/api/admin/buyers/buyer_1/deposit/override", {
    method: "POST",
    body: JSON.stringify({ reason: "Buyer paid by cashier's cheque at pickup" }),
  });
  return mod.POST(req, { params: Promise.resolve({ buyerId: "buyer_1" }) });
}

beforeEach(() => {
  ctrl.reconciled = [];
  ctrl.reconcileOutcome = "invited";
  ctrl.reconcileThrows = false;
  ctrl.providerEventWrites = 0;
  ctrl.audits = [];
});

test("an override deposit runs the canonical fulfillment cascade", async () => {
  const res = await call();
  assert.equal(res.status, 201);
  assert.deepEqual(ctrl.reconciled, ["dep_1"], "the minted deposit must be converged, not left stranded");
});

test("the response reports the real fulfillment outcome", async () => {
  ctrl.reconcileOutcome = "invited";
  let json = await (await call()).json();
  assert.equal(json.data.fulfillment, "invited");
  assert.equal(json.data.auctionUnblocked, true);

  ctrl.reconcileOutcome = "skip";
  json = await (await call()).json();
  assert.equal(json.data.fulfillment, "skip");
  assert.equal(json.data.auctionUnblocked, false);
});

test("a fulfillment failure does not fail the override — the deposit stays recorded", async () => {
  ctrl.reconcileThrows = true;
  const res = await call();
  assert.equal(res.status, 201);
  const json = await res.json();
  assert.equal(json.data.deposit.status, "PAID");
  assert.equal(json.data.auctionUnblocked, false);
});

test("NEVER fabricates a payment provider event for an override", async () => {
  await call();
  assert.equal(ctrl.providerEventWrites, 0);
});

test("the audit marks the override as admin-origin, not provider-confirmed", async () => {
  await call();
  const meta = ctrl.audits[0]?.metadata as Record<string, unknown>;
  assert.equal(ctrl.audits[0]?.action, "DEPOSIT_MANUAL_OVERRIDE");
  assert.equal(meta.override, true);
  assert.equal(meta.providerConfirmed, false);
});
