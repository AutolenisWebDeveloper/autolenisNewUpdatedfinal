// The FIRST tests for the admin RBAC permission layer.
//
// Until now lib/auth/permissions.ts had NO test coverage at all, while gating 67
// call sites across 53 admin routes — and it never blocks: RBAC_ENFORCE is unset,
// so a role outside a permission's allow-list is recorded as RBAC_SHADOW_DENY and
// the request PROCEEDS (permissions.ts:125-129). These tests pin both modes so the
// eventual flag flip is a measured change rather than a leap.
//
// They also pin requirePermissionStrict — the always-enforcing sibling used by the
// high-risk money / e-sign / ops-replay routes. Two things make it different from
// bolting a hardcoded role set onto each route (the existing pattern):
//
//   • It derives the allowed roles from PERMISSION_ROLES, so a route's enforcement
//     cannot drift from the matrix. That drift is not hypothetical — the
//     impersonation routes allow SUPER_ADMIN or SUPPORT_ADMIN while the matrix says
//     SUPER only, so the two disagree today.
//   • It distinguishes "not signed in" (401) from "signed in, wrong role" (403).
//     Every requirePermission caller answers 401 "Not authenticated" for both,
//     which would misreport a role lockout as a session problem.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks "lib/auth/__tests__/permissions.test.ts"

import test, { mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

interface AuditRow { action: string; adminId: string; entityId: string; metadata: Record<string, unknown> }

let audits: AuditRow[] = [];
let currentAdmin: { adminId: string; email: string; role: string } | null = null;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      adminAuditLog: {
        create: async ({ data }: { data: AuditRow }) => {
          audits.push(data);
          return data;
        },
      },
    },
  },
});

mock.module("@/lib/auth/admin-api", {
  namedExports: { getAdminFromRequest: async () => currentAdmin },
});

mock.module("@/lib/auth/admin-session", {
  namedExports: { getAuthenticatedAdmin: async () => currentAdmin },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

const request = {
  method: "POST",
  nextUrl: { pathname: "/api/admin/affiliates/commissions/c1/approve" },
} as unknown as Parameters<
  Awaited<ReturnType<typeof loadModule>>["requirePermission"]
>[0];

async function loadModule() {
  return import("@/lib/auth/permissions");
}

const ORIGINAL_ENFORCE = process.env.RBAC_ENFORCE;

beforeEach(() => {
  audits = [];
  currentAdmin = { adminId: "admin_1", email: "support@autolenis.com", role: "SUPPORT_ADMIN" };
  delete process.env.RBAC_ENFORCE;
});

afterEach(() => {
  if (ORIGINAL_ENFORCE === undefined) delete process.env.RBAC_ENFORCE;
  else process.env.RBAC_ENFORCE = ORIGINAL_ENFORCE;
});

// ── requirePermission: SHADOW mode (production today) ────────────────────────

test("SHADOW: a denied role is audited and STILL ALLOWED — this is production today", async () => {
  const { requirePermission } = await loadModule();
  // SUPPORT_ADMIN is not in MONEY (SUPER_ADMIN, FINANCE_ADMIN).
  const admin = await requirePermission(request, "finance.commissions.settle");

  assert.notEqual(admin, null, "shadow mode must not block — that is the defect being measured");
  assert.equal(admin!.role, "SUPPORT_ADMIN");
  assert.equal(audits.length, 1, "the would-be denial must leave a durable record");
  assert.equal(audits[0]!.action, "RBAC_SHADOW_DENY");
  assert.equal(audits[0]!.entityId, "finance.commissions.settle");
  assert.equal(audits[0]!.metadata.role, "SUPPORT_ADMIN");
  assert.equal(audits[0]!.metadata.enforcing, false);
});

test("SHADOW: an allowed role passes with no audit noise", async () => {
  currentAdmin = { adminId: "admin_2", email: "finance@autolenis.com", role: "FINANCE_ADMIN" };
  const { requirePermission } = await loadModule();

  const admin = await requirePermission(request, "finance.commissions.settle");
  assert.equal(admin!.role, "FINANCE_ADMIN");
  assert.deepEqual(audits, [], "an allowed request must not write a shadow-deny record");
});

test("SHADOW: an unauthenticated caller is still refused", async () => {
  currentAdmin = null;
  const { requirePermission } = await loadModule();
  assert.equal(await requirePermission(request, "finance.commissions.settle"), null);
  assert.deepEqual(audits, [], "there is no admin to attribute a denial to");
});

// ── requirePermission: ENFORCING mode (what the flag would do) ───────────────

test("ENFORCING: RBAC_ENFORCE=true turns the same shadow denial into a real block", async () => {
  process.env.RBAC_ENFORCE = "true";
  const { requirePermission } = await loadModule();

  const admin = await requirePermission(request, "finance.commissions.settle");
  assert.equal(admin, null, "with the flag on, a denied role must be blocked");
  assert.equal(audits.length, 1);
  assert.equal(audits[0]!.metadata.enforcing, true, "the record must show which mode produced it");
});

test("ENFORCING: only the literal string \"true\" enables it", async () => {
  const { requirePermission } = await loadModule();
  for (const value of ["1", "TRUE", "yes", "on", ""]) {
    process.env.RBAC_ENFORCE = value;
    audits = [];
    const admin = await requirePermission(request, "finance.commissions.settle");
    assert.notEqual(admin, null, `RBAC_ENFORCE=${JSON.stringify(value)} must NOT silently enforce`);
  }
});

// ── requirePermissionStrict: always enforcing, 401 vs 403 ───────────────────

test("STRICT: a wrong role is FORBIDDEN (403), never \"not authenticated\"", async () => {
  const { requirePermissionStrict } = await loadModule();
  const result = await requirePermissionStrict(request, "finance.commissions.settle");

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 403, "a signed-in admin with the wrong role is not unauthenticated");
  assert.equal(result.ok === false && result.code, "FORBIDDEN");
  assert.equal(audits.length, 1, "a real denial is audited too");
  assert.equal(audits[0]!.action, "RBAC_DENY", "distinguishable from a shadow record in the report");
});

test("STRICT: an unauthenticated caller is UNAUTHORIZED (401)", async () => {
  currentAdmin = null;
  const { requirePermissionStrict } = await loadModule();
  const result = await requirePermissionStrict(request, "finance.commissions.settle");

  assert.equal(result.ok === false && result.status, 401);
  assert.equal(result.ok === false && result.code, "UNAUTHORIZED");
});

test("STRICT: an allowed role is granted and carries the admin through", async () => {
  currentAdmin = { adminId: "admin_2", email: "finance@autolenis.com", role: "FINANCE_ADMIN" };
  const { requirePermissionStrict } = await loadModule();
  const result = await requirePermissionStrict(request, "finance.commissions.settle");

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.admin.adminId, "admin_2");
  assert.deepEqual(audits, []);
});

test("STRICT: enforces regardless of RBAC_ENFORCE — it is not the shadow flag", async () => {
  const { requirePermissionStrict } = await loadModule();
  for (const value of [undefined, "false", "true"]) {
    if (value === undefined) delete process.env.RBAC_ENFORCE;
    else process.env.RBAC_ENFORCE = value;
    const result = await requirePermissionStrict(request, "finance.commissions.settle");
    assert.equal(
      result.ok,
      false,
      `strict must block a denied role with RBAC_ENFORCE=${String(value)} — the live exposure cannot wait on the flag`,
    );
  }
});

test("STRICT: the allowed roles come from the matrix, so a route cannot drift from it", async () => {
  const { requirePermissionStrict, roleAllows, PERMISSION_ROLES } = await loadModule();

  for (const role of PERMISSION_ROLES["finance.commissions.settle"]) {
    currentAdmin = { adminId: "a", email: "a@x.com", role };
    const result = await requirePermissionStrict(request, "finance.commissions.settle");
    assert.equal(result.ok, true, `${role} is in the matrix and must be allowed`);
  }
  assert.equal(roleAllows("finance.commissions.settle", "SUPPORT_ADMIN"), false);
  assert.equal(roleAllows("finance.commissions.settle", "FINANCE_ADMIN"), true);
});

// ── The live exposure this pass closes ──────────────────────────────────────

test("the money and ops permissions do NOT admit SUPPORT_ADMIN", async () => {
  const { roleAllows } = await loadModule();
  const mustExcludeSupport = [
    "finance.commissions.settle",
    "finance.commissions.reverse",
    "finance.deposit.override",
    "finance.refunds",
    "deals.esign.void",
    "ops.replay",
  ] as const;
  for (const permission of mustExcludeSupport) {
    assert.equal(
      roleAllows(permission, "SUPPORT_ADMIN"),
      false,
      `${permission} must never admit read-only support staff (ruled policy 1)`,
    );
  }
});
