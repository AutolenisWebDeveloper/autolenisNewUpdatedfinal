// Authorization regression: the shadow RBAC layer must NOT be the only gate on
// a consequential admin route.
//
// requirePermission()/requirePermissionActor() are shadow by design — with
// RBAC_ENFORCE unset (the documented default) a role outside the permission's
// allow-list is recorded as RBAC_SHADOW_DENY and then ALLOWED. That is a valid
// rollout stage for reads, but for a route that replays arbitrary dead-lettered
// jobs (ops.replay, SUPER-only) or fans out mass sends (comms.bulk_send, OPS)
// "recorded but allowed" is an authorization defect.
//
// requirePermissionActorStrict() is the hard-enforcing counterpart used by those
// routes. These tests pin its two load-bearing properties:
//   1. it denies an out-of-allow-list role even with RBAC_ENFORCE unset, and
//   2. it distinguishes 401 (not signed in) from 403 (signed in, wrong role),
// while proving the shadow helper's own semantics are left untouched.
//
// Run: pnpm test:auth   (globs lib/auth/__tests__/*.test.ts)

import test, { mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// ── Controllable session + audit-write capture ───────────────────────────────
const state = {
  admin: null as { adminId: string; email: string; role: string } | null,
  auditWrites: [] as Array<Record<string, unknown>>,
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      adminAuditLog: {
        create: async (args: { data: Record<string, unknown> }) => {
          state.auditWrites.push(args.data);
          return { id: "log_1" };
        },
      },
    },
  },
});

mock.module("@/lib/auth/admin-session", {
  namedExports: {
    getAuthenticatedAdmin: async () => state.admin,
  },
});

// requirePermission (the NextRequest variant) is not under test here; stub its
// dependency so the module graph loads without a real request.
mock.module("@/lib/auth/admin-api", {
  namedExports: {
    getAdminFromRequest: async () => state.admin,
  },
});

async function loadPermissions() {
  return import("@/lib/auth/permissions");
}

const SUPER = { adminId: "a_super", email: "super@autolenis.com", role: "SUPER_ADMIN" };
const SUPPORT = { adminId: "a_supp", email: "support@autolenis.com", role: "SUPPORT_ADMIN" };
const OPS = { adminId: "a_ops", email: "ops@autolenis.com", role: "OPERATIONS_ADMIN" };
const FINANCE = { adminId: "a_fin", email: "finance@autolenis.com", role: "FINANCE_ADMIN" };

const originalEnforce = process.env.RBAC_ENFORCE;

beforeEach(() => {
  state.admin = SUPER;
  state.auditWrites = [];
  // The default production posture: the T4 flag is NOT set.
  delete process.env.RBAC_ENFORCE;
});

afterEach(() => {
  if (originalEnforce === undefined) delete process.env.RBAC_ENFORCE;
  else process.env.RBAC_ENFORCE = originalEnforce;
});

// ── The defect this guards against ───────────────────────────────────────────

test("strict: shadow helper ALLOWS an out-of-allow-list role (the defect being fixed)", async () => {
  const { requirePermissionActor } = await loadPermissions();
  state.admin = SUPPORT; // ops.replay is SUPER-only

  const actor = await requirePermissionActor("ops.replay");

  assert.notEqual(actor, null, "shadow mode allows — this is why strict exists");
  assert.equal(state.auditWrites[0]?.action, "RBAC_SHADOW_DENY");
});

test("strict: DENIES the same role with 403 under the same (unset) env", async () => {
  const { requirePermissionActorStrict } = await loadPermissions();
  state.admin = SUPPORT;

  const res = await requirePermissionActorStrict("ops.replay");

  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.status, 403);
});

test("strict: a hard denial is audited as RBAC_DENY, not RBAC_SHADOW_DENY", async () => {
  const { requirePermissionActorStrict } = await loadPermissions();
  state.admin = SUPPORT;

  await requirePermissionActorStrict("ops.replay", { path: "/api/admin/operations/dlq/1/retry", method: "POST" });

  assert.equal(state.auditWrites.length, 1);
  const row = state.auditWrites[0]!;
  assert.equal(row.action, "RBAC_DENY", "hard denials must not pollute the shadow bucketing report");
  assert.equal(row.entityType, "RBAC");
  assert.equal(row.entityId, "ops.replay");
  assert.equal(row.adminId, SUPPORT.adminId);
});

test("strict: allows the permitted role and returns the actor shape callers consume", async () => {
  const { requirePermissionActorStrict } = await loadPermissions();
  state.admin = SUPER;

  const res = await requirePermissionActorStrict("ops.replay");

  assert.equal(res.ok, true);
  assert.deepEqual(res.ok === true && res.actor, {
    adminId: SUPER.adminId,
    adminEmail: SUPER.email,
  });
  assert.equal(state.auditWrites.length, 0, "an allowed call writes no denial record");
});

test("strict: unauthenticated is 401, distinct from the 403 wrong-role case", async () => {
  const { requirePermissionActorStrict } = await loadPermissions();
  state.admin = null;

  const res = await requirePermissionActorStrict("ops.replay");

  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.status, 401);
  assert.equal(state.auditWrites.length, 0, "no admin to attribute a denial to");
});

// ── Per-permission allow-lists come from PERMISSION_ROLES, not reinvented ────

test("strict: comms.bulk_send is OPS-tier — SUPPORT and FINANCE are denied", async () => {
  const { requirePermissionActorStrict } = await loadPermissions();

  for (const admin of [SUPPORT, FINANCE]) {
    state.admin = admin;
    const res = await requirePermissionActorStrict("comms.bulk_send");
    assert.equal(res.ok, false, `${admin.role} must not fan out sends`);
    assert.equal(res.ok === false && res.status, 403);
  }

  for (const admin of [SUPER, OPS]) {
    state.admin = admin;
    const res = await requirePermissionActorStrict("comms.bulk_send");
    assert.equal(res.ok, true, `${admin.role} must keep bulk-send authority`);
  }
});

test("strict: comms.reply is support-capable — SUPPORT allowed, FINANCE denied", async () => {
  const { requirePermissionActorStrict } = await loadPermissions();

  // Policy 1: SUPPORT_ADMIN acts (replies) without holding bulk authority.
  state.admin = SUPPORT;
  assert.equal((await requirePermissionActorStrict("comms.reply")).ok, true);

  state.admin = FINANCE;
  const denied = await requirePermissionActorStrict("comms.reply");
  assert.equal(denied.ok, false);
  assert.equal(denied.ok === false && denied.status, 403);
});

// ── The shadow layer must be left exactly as it was for every other route ────

test("shadow semantics are unchanged: allowed role passes, no denial record", async () => {
  const { requirePermissionActor } = await loadPermissions();
  state.admin = OPS; // crm.manage is OPS-tier

  const actor = await requirePermissionActor("crm.manage");

  assert.deepEqual(actor, { adminId: OPS.adminId, adminEmail: OPS.email });
  assert.equal(state.auditWrites.length, 0);
});

test("shadow semantics are unchanged: RBAC_ENFORCE=true still hard-denies", async () => {
  const { requirePermissionActor } = await loadPermissions();
  process.env.RBAC_ENFORCE = "true";
  state.admin = SUPPORT;

  const actor = await requirePermissionActor("crm.manage");

  assert.equal(actor, null, "the T4 flag must keep working for the shadow helper");
  assert.equal(state.auditWrites[0]?.action, "RBAC_SHADOW_DENY");
});

test("strict is independent of RBAC_ENFORCE=true (still denies, still allows)", async () => {
  const { requirePermissionActorStrict } = await loadPermissions();
  process.env.RBAC_ENFORCE = "true";

  state.admin = SUPPORT;
  assert.equal((await requirePermissionActorStrict("ops.replay")).ok, false);

  state.admin = SUPER;
  assert.equal((await requirePermissionActorStrict("ops.replay")).ok, true);
});
