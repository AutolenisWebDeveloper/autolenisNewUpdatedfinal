// The high-risk admin routes must REFUSE a wrong role — today, not when a flag flips.
//
// These routes were gated only by requirePermission, which is in shadow mode:
// RBAC_ENFORCE is unset, so a role outside the allow-list is recorded and the
// request PROCEEDS. None of them carried a secondary role check. The live effect,
// measured across app/api/admin: a SUPPORT_ADMIN could settle affiliate
// commissions, override a buyer's deposit, void an executed e-signature, attach a
// contract to a deal, and replay a dead-letter job — every one outside the ruled
// policy for that role.
//
// Flipping RBAC_ENFORCE globally is not the remedy (67 call sites, a known
// matrix/route contradiction on impersonation, 401-not-403 lockouts, no shadow
// report and no prod role distribution). These routes are enforced DIRECTLY via
// requirePermissionStrict, which derives its roles from the same PERMISSION_ROLES
// matrix — so route and matrix cannot drift — and answers 403 for a wrong role
// rather than "not authenticated".
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/admin/__tests__/high-risk-route-enforcement.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

// Some of these routes transitively import a "server-only" module, which throws
// outside a Next server runtime. Stub it so the route module can load at all.
mock.module("server-only", { namedExports: {}, defaultExport: {} });

let currentAdmin: { adminId: string; email: string; role: string } | null = null;
let businessLogicRan = false;

// Real permissions.ts runs; only the identity it reads is controlled.
mock.module("@/lib/auth/admin-api", {
  namedExports: {
    getAdminFromRequest: async () => currentAdmin,
    getAdminWithRole: async () => currentAdmin,
    adminSuccess: (data: unknown, status = 200) => NextResponse.json({ success: true, data }, { status }),
    adminError: (code: string, message: string, status = 400) =>
      NextResponse.json({ error: { code, message } }, { status }),
    createAuditLog: async () => undefined,
    getClientIp: () => "127.0.0.1",
  },
});

mock.module("@/lib/auth/admin-session", { namedExports: { getAuthenticatedAdmin: async () => currentAdmin } });
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

// Any DB touch past the gate is a failure: the gate must short-circuit first.
const spyModel = () => new Proxy({}, {
  get: () => async () => { businessLogicRan = true; return null; },
});
mock.module("@/lib/prisma", {
  namedExports: {
    prisma: new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => {
        // The RBAC audit write is expected and is not "business logic".
        if (prop === "adminAuditLog") return { create: async () => ({}) };
        if (prop === "$transaction") return async () => { businessLogicRan = true; return null; };
        return spyModel();
      },
    }),
  },
});

// Service layers behind these routes — reaching any of them is the defect.
const forbiddenService = () => { businessLogicRan = true; throw new Error("business logic must not run for a denied role"); };
mock.module("@/lib/services/dealer/dealer-contract.service", {
  namedExports: {
    uploadContractForDealByAdmin: async () => forbiddenService(),
    DealOwnershipError: class extends Error {},
  },
});
mock.module("@/lib/supabase", {
  namedExports: { createServiceSupabaseClient: () => forbiddenService() },
});

interface Case {
  name: string;
  module: string;
  method: "POST" | "GET";
  params?: Record<string, string>;
  body?: unknown;
  /** A role the matrix DOES allow, to prove the route still works. */
  allowedRole: string;
}

// Every one of these was reachable by ANY authenticated admin before this change.
const CASES: Case[] = [
  {
    name: "commissions approve (money)",
    module: "@/app/api/admin/affiliates/commissions/[commissionId]/approve/route",
    method: "POST", params: { commissionId: "c1" }, allowedRole: "FINANCE_ADMIN",
  },
  {
    name: "commissions mark-paid (money)",
    module: "@/app/api/admin/affiliates/commissions/[commissionId]/mark-paid/route",
    method: "POST", params: { commissionId: "c1" }, allowedRole: "FINANCE_ADMIN",
  },
  {
    name: "commissions reject (money)",
    module: "@/app/api/admin/affiliates/commissions/[commissionId]/reject/route",
    method: "POST", params: { commissionId: "c1" }, body: { reason: "a sufficiently long reason" }, allowedRole: "FINANCE_ADMIN",
  },
  {
    name: "commissions clawback (money)",
    module: "@/app/api/admin/affiliates/commissions/[commissionId]/clawback/route",
    method: "POST", params: { commissionId: "c1" }, body: { reason: "a sufficiently long reason" }, allowedRole: "FINANCE_ADMIN",
  },
  {
    name: "commissions reverse (money)",
    module: "@/app/api/admin/affiliates/commissions/[commissionId]/reverse/route",
    method: "POST", params: { commissionId: "c1" }, body: { reason: "a sufficiently long reason" }, allowedRole: "FINANCE_ADMIN",
  },
  {
    name: "buyer deposit override (money)",
    module: "@/app/api/admin/buyers/[buyerId]/deposit/override/route",
    method: "POST", params: { buyerId: "b1" }, body: { reason: "a sufficiently long reason" }, allowedRole: "FINANCE_ADMIN",
  },
  {
    name: "DLQ retry (ops.replay — re-fires arbitrary side effects)",
    module: "@/app/api/admin/operations/dlq/[id]/retry/route",
    method: "POST", params: { id: "d1" }, allowedRole: "SUPER_ADMIN",
  },
  {
    name: "e-sign void",
    module: "@/app/api/admin/deals/[dealId]/esign/void/route",
    method: "POST", params: { dealId: "deal_1" }, body: { reason: "a sufficiently long reason" }, allowedRole: "OPERATIONS_ADMIN",
  },
  {
    name: "e-sign evidence (signing PII)",
    module: "@/app/api/admin/deals/[dealId]/esign/evidence/route",
    method: "GET", params: { dealId: "deal_1" }, allowedRole: "OPERATIONS_ADMIN",
  },
  {
    name: "concierge contract attach",
    module: "@/app/api/admin/deals/[dealId]/contract/route",
    method: "POST", params: { dealId: "deal_1" }, body: { documentUrl: "admin/deal_1/c.pdf" }, allowedRole: "OPERATIONS_ADMIN",
  },
  {
    name: "concierge contract upload-file",
    module: "@/app/api/admin/deals/[dealId]/contract/upload-file/route",
    method: "POST", params: { dealId: "deal_1" }, allowedRole: "OPERATIONS_ADMIN",
  },
];

function makeRequest(c: Case) {
  const init: { method: string; body?: string; headers?: Record<string, string> } = { method: c.method };
  if (c.body !== undefined) {
    init.body = JSON.stringify(c.body);
    init.headers = { "content-type": "application/json" };
  }
  return new NextRequest(`http://localhost/api/admin/x`, init as ConstructorParameters<typeof NextRequest>[1]);
}

/** These routes use two response envelopes: the admin one ({error:{code}}) and the
 *  ops one ({error:"CODE"}). Read the code from whichever this route returns rather
 *  than reshaping a route's existing contract for the test's convenience. */
function errorCode(text: string): string | undefined {
  const body = JSON.parse(text.trim()) as { error?: string | { code?: string } };
  return typeof body.error === "string" ? body.error : body.error?.code;
}

async function invoke(c: Case) {
  const mod = await import(c.module) as Record<string, (...a: unknown[]) => Promise<Response>>;
  const handler = mod[c.method]!;
  return handler(makeRequest(c), { params: Promise.resolve(c.params ?? {}) });
}

beforeEach(() => {
  businessLogicRan = false;
  delete process.env.RBAC_ENFORCE; // shadow mode = production today
});

for (const c of CASES) {
  test(`${c.name}: SUPPORT_ADMIN is refused 403 and no business logic runs`, async () => {
    currentAdmin = { adminId: "admin_1", email: "support@autolenis.com", role: "SUPPORT_ADMIN" };

    const res = await invoke(c);

    assert.equal(res.status, 403, `${c.name} must FORBID a read-only support admin`);
    assert.equal(errorCode(await res.text()), "FORBIDDEN", "a wrong role is forbidden, not unauthenticated");
    assert.equal(businessLogicRan, false, `${c.name} must short-circuit before doing anything`);
  });

  test(`${c.name}: an unauthenticated caller is refused 401`, async () => {
    currentAdmin = null;
    const res = await invoke(c);
    assert.equal(res.status, 401, `${c.name} must distinguish "not signed in" from "wrong role"`);
    assert.equal(businessLogicRan, false);
  });

  test(`${c.name}: a role the matrix allows still gets past the gate (no lockout)`, async () => {
    currentAdmin = { adminId: "admin_2", email: "ok@autolenis.com", role: c.allowedRole };
    const res = await invoke(c).catch(() => null);
    // Past the gate the route hits mocked/absent data and may 404/500 — what
    // matters is that it was NOT refused by authorization.
    if (res) {
      assert.notEqual(res.status, 403, `${c.allowedRole} must not be locked out of ${c.name}`);
      assert.notEqual(res.status, 401, `${c.allowedRole} is authenticated`);
    }
  });
}
