// Authorization contract tests for POST /api/admin/buyers/[buyerId]/deposit/override
//
// Lives here (not co-located under the [buyerId] segment) because node:test
// treats "[" as a glob metacharacter, so a path containing the [buyerId] segment
// cannot be passed to the runner. The route is imported via the @/ alias, which
// tsx resolves from tsconfig paths without shell globbing.
//
// Regression target (admin authz audit, batch 1): this route gated only on
// requirePermission("finance.deposit.override"), which is SHADOW-ONLY — under
// the default runtime (RBAC_ENFORCE unset) a role outside the permission's
// allow-list is recorded as RBAC_SHADOW_DENY and then ALLOWED. Any authenticated
// admin, including a read-only SUPPORT_ADMIN, could mint a PAID $99 deposit with
// no Stripe payment behind it and unblock an auction launch.
//
// The same consequential action reached through the payments surface —
// POST /api/admin/payments/deposit/[depositId]/mark-paid — hard-enforces
// ["SUPER_ADMIN", "FINANCE_ADMIN"] via getAdminWithRole, as do every other
// payments/deposit/* route. These tests pin that identical hard gate here.

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

// ── Controllable caller role + mutation spy ──────────────────────────────────
let callerRole = "FINANCE_ADMIN";
let depositCreateCalls = 0;

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
        // No pre-existing unconsumed PAID deposit — the override precondition passes.
        findFirst: async () => null,
        create: async () => {
          depositCreateCalls += 1;
          return { id: "dep_1", buyerId: "buyer_1", amountCents: 9900, status: "PAID" };
        },
      },
      adminAuditLog: { create: async () => ({ id: "log_1" }) },
      notification: { create: async () => ({ id: "notif_1" }) },
    },
  },
});

mock.module("@/lib/services/email/resend.service", {
  namedExports: { sendDepositConfirmationEmail: async () => undefined },
});

mock.module("@/lib/services/admin/buyer-crm-sync", {
  namedExports: { syncBuyerLifecycleToCrm: async () => undefined },
});

// requirePermission is SHADOW-ONLY by design: it returns the authenticated admin
// even when the role is outside the permission's allow-list. Mocking that real
// behaviour is the point — it proves the route's own hard check is what blocks.
mock.module("@/lib/auth/permissions", {
  namedExports: {
    requirePermission: async () => ({
      adminId: "admin_1",
      email: "caller@autolenis.com",
      role: callerRole,
      mfaVerified: true,
    }),
  },
});

mock.module("@/lib/auth/admin-api", {
  namedExports: {
    adminSuccess: (data: unknown, status = 200) =>
      NextResponse.json({ success: true, data }, { status }),
    adminError: (code: string, message: string, status = 400) =>
      NextResponse.json({ error: { code, message }, correlationId: "test-corr-id" }, { status }),
  },
});

async function loadPOST() {
  const mod = await import("@/app/api/admin/buyers/[buyerId]/deposit/override/route");
  return mod.POST;
}

function req(body: unknown = { reason: "Buyer paid by wire outside Stripe." }) {
  return new NextRequest("http://localhost/api/admin/buyers/buyer_1/deposit/override", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ buyerId: "buyer_1" }) };

// Roles that must NOT be able to mint a PAID deposit, per the FINANCE-only
// policy already hard-enforced across payments/deposit/*.
const UNDER_PRIVILEGED = ["SUPPORT_ADMIN", "OPERATIONS_ADMIN", "COMPLIANCE_ADMIN"] as const;

beforeEach(() => {
  callerRole = "FINANCE_ADMIN";
  depositCreateCalls = 0;
});

for (const role of UNDER_PRIVILEGED) {
  test(`${role} → 403 and NO deposit is created`, async () => {
    callerRole = role;

    const POST = await loadPOST();
    const res = await POST(req(), params);

    assert.equal(res.status, 403);
    const body = JSON.parse((await res.text()).trim());
    assert.equal(body.error.code, "FORBIDDEN");
    assert.equal(depositCreateCalls, 0, `${role} must not mint a PAID deposit`);
  });
}

test("FINANCE_ADMIN still creates the override deposit (no regression)", async () => {
  callerRole = "FINANCE_ADMIN";

  const POST = await loadPOST();
  const res = await POST(req(), params);

  assert.equal(res.status, 201);
  assert.equal(depositCreateCalls, 1);
});

test("SUPER_ADMIN still creates the override deposit (no regression)", async () => {
  callerRole = "SUPER_ADMIN";

  const POST = await loadPOST();
  const res = await POST(req(), params);

  assert.equal(res.status, 201);
  assert.equal(depositCreateCalls, 1);
});

// The authorization gate must precede the buyer lookup and body parsing, so an
// under-privileged caller cannot use this endpoint to probe buyer existence.
test("authorization is checked BEFORE the buyer lookup and body validation", async () => {
  callerRole = "SUPPORT_ADMIN";

  const POST = await loadPOST();
  // Invalid body (missing reason) would otherwise yield VALIDATION_ERROR (400).
  const res = await POST(req({}), params);

  assert.equal(res.status, 403, "role check must short-circuit ahead of validation");
  const body = JSON.parse((await res.text()).trim());
  assert.equal(body.error.code, "FORBIDDEN");
  assert.equal(depositCreateCalls, 0);
});
