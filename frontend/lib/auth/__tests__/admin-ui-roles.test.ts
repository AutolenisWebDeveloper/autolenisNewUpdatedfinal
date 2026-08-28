// lib/auth/__tests__/admin-ui-roles.test.ts
//
// The UI role mirror is only useful if it stays true to the server. A stale
// mirror is worse than none: it either hides a control the operator is allowed
// to use, or promises one the server will refuse.
//
// So this suite does not test the mirror against itself. For every mirrored
// capability it READS THE ROUTE FILE that enforces the check and asserts the
// role list in the route matches the list in the mirror, exactly.
//
// It also asserts the two properties that keep this from becoming a security
// control: the mirror fails open on an unknown role, and it never claims a
// capability the route does not actually restrict.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  ADMIN_UI_CAPABILITIES,
  canUse,
  deniedReason,
  type AdminUiCapability,
} from "../admin-ui-roles";

const ALL_ROLES = [
  "SUPER_ADMIN",
  "OPERATIONS_ADMIN",
  "COMPLIANCE_ADMIN",
  "FINANCE_ADMIN",
  "SUPPORT_ADMIN",
] as const;

/**
 * Pull the role names out of whichever hard-enforcement form a route uses:
 *   getAdminWithRole(request, ["SUPER_ADMIN", "FINANCE_ADMIN"])
 *   const ALLOWED_ROLES = new Set(["SUPER_ADMIN", "FINANCE_ADMIN"])
 *   if (!["SUPER_ADMIN", "OPERATIONS_ADMIN"].includes(admin.role))
 *   if (admin.role !== "SUPER_ADMIN")
 * Only these forms deny today; requirePermission() alone is shadow-mode and is
 * deliberately not treated as enforcement.
 */
function enforcedRolesIn(source: string): Set<string> {
  const roles = new Set<string>();

  const arrayForms = [
    /getAdminWithRole\(\s*request\s*,\s*\[([^\]]*)\]/g,
    /ALLOWED_ROLES\s*[:=]\s*new Set\(\s*\[([^\]]*)\]/g,
    /!\[([^\]]*)\]\s*\.includes\(\s*admin\.role\s*\)/g,
  ];
  for (const re of arrayForms) {
    for (const m of source.matchAll(re)) {
      for (const r of m[1].matchAll(/"([A-Z_]+)"/g)) roles.add(r[1]);
    }
  }

  // `admin.role !== "X" && admin.role !== "Y"` — an inequality chain admits
  // every role it names.
  for (const m of source.matchAll(/admin\.role\s*!==\s*"([A-Z_]+)"/g)) roles.add(m[1]);
  // `admin.role !== AdminRole.SUPER_ADMIN`
  for (const m of source.matchAll(/admin\.role\s*!==\s*AdminRole\.([A-Z_]+)/g)) roles.add(m[1]);

  return roles;
}

describe("admin UI role mirror — matches the server, exactly", () => {
  for (const [capability, spec] of Object.entries(ADMIN_UI_CAPABILITIES)) {
    for (const routePath of spec.sourceRoutes) {
      test(`${capability} mirrors ${routePath}`, () => {
        const full = join(process.cwd(), routePath);
        assert.ok(existsSync(full), `${routePath} does not exist — the mirror names a dead route`);
        const source = readFileSync(full, "utf8");

        const enforced = enforcedRolesIn(source);
        assert.ok(
          enforced.size > 0,
          `${routePath} performs no hard role check, so the UI must not gate on it. ` +
            `Only requirePermissionActorStrict() and explicit role checks deny today; ` +
            `requirePermission() alone is shadow-mode and still allows the request.`,
        );

        assert.deepEqual(
          [...enforced].sort(),
          [...spec.roles].sort(),
          `${capability} would hide or offer the wrong controls: ` +
            `the UI mirror says [${[...spec.roles].sort()}] but ${routePath} enforces ` +
            `[${[...enforced].sort()}].`,
        );
      });
    }
  }
});

describe("admin UI role mirror — is not a security boundary", () => {
  test("fails open when the role is unknown", () => {
    for (const capability of Object.keys(ADMIN_UI_CAPABILITIES) as AdminUiCapability[]) {
      assert.equal(
        canUse(capability, undefined),
        true,
        `${capability} must stay visible when the role cannot be determined — ` +
          `the server decides, and hiding it would remove working capability`,
      );
      assert.equal(canUse(capability, null), true);
      assert.equal(canUse(capability, ""), true);
    }
  });

  test("admits exactly the mirrored roles and no others", () => {
    for (const [capability, spec] of Object.entries(ADMIN_UI_CAPABILITIES)) {
      const allowed = spec.roles as readonly string[];
      for (const role of ALL_ROLES) {
        assert.equal(
          canUse(capability as AdminUiCapability, role),
          allowed.includes(role),
          `${capability} for ${role}`,
        );
      }
    }
  });

  test("SUPER_ADMIN can use every mirrored capability", () => {
    for (const capability of Object.keys(ADMIN_UI_CAPABILITIES) as AdminUiCapability[]) {
      assert.ok(canUse(capability, "SUPER_ADMIN"), `${capability} excludes SUPER_ADMIN`);
    }
  });

  test("every capability explains itself when denied", () => {
    for (const capability of Object.keys(ADMIN_UI_CAPABILITIES) as AdminUiCapability[]) {
      const reason = deniedReason(capability);
      assert.match(reason, /Requires /, `${capability} gives no reason`);
      assert.ok(reason.length > 20);
    }
  });
});

describe("admin UI role mirror — scope discipline", () => {
  test("mirrors no capability whose route only shadow-checks", () => {
    // A route that calls requirePermission() but performs no explicit role
    // check still ALLOWS the request while RBAC_ENFORCE is unset. Gating the
    // UI on one would hide a control the server currently permits.
    for (const [capability, spec] of Object.entries(ADMIN_UI_CAPABILITIES)) {
      for (const routePath of spec.sourceRoutes) {
        const source = readFileSync(join(process.cwd(), routePath), "utf8");
        const hasHardCheck =
          enforcedRolesIn(source).size > 0 || source.includes("requirePermissionActorStrict");
        assert.ok(hasHardCheck, `${capability}: ${routePath} is shadow-only`);
      }
    }
  });

  test("impersonation mirrors the route, not the stricter permission policy", () => {
    // Owner ruling 10: server behaviour is unchanged and the disagreement
    // between the route and PERMISSION_ROLES is reported, not resolved here.
    // The UI matches observable behaviour so it never hides a control that
    // actually works today.
    assert.deepEqual([...ADMIN_UI_CAPABILITIES["support.impersonate"].roles].sort(), [
      "SUPER_ADMIN",
      "SUPPORT_ADMIN",
    ]);
    const permissions = readFileSync(join(process.cwd(), "lib/auth/permissions.ts"), "utf8");
    assert.match(
      permissions,
      /"support\.impersonate":\s*SUPER/,
      "if the policy map changed, re-check this deliberate divergence",
    );
  });
});
