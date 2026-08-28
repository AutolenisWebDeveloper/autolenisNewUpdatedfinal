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
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
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

  test("impersonation agrees with the ruled permission policy", () => {
    // This capability once diverged: the routes admitted SUPPORT_ADMIN while
    // PERMISSION_ROLES and ruled policies 1 and 4 said SUPER-only, and because
    // requirePermission() is shadow-mode the ROUTE was what governed — so the
    // grant the owner had explicitly withheld was live. The owner ruled to
    // enforce the policy; mirror, routes and policy map now agree.
    assert.deepEqual(
      [...ADMIN_UI_CAPABILITIES["support.impersonate"].roles],
      ["SUPER_ADMIN"],
      "the UI must not offer impersonation to a role the server refuses",
    );
    const permissions = readFileSync(join(process.cwd(), "lib/auth/permissions.ts"), "utf8");
    assert.match(
      permissions,
      /"support\.impersonate":\s*SUPER/,
      "PERMISSION_ROLES must stay SUPER-only — it is the ruled policy",
    );
  });

  // UI capability -> the ruled Permission that governs the same action. Only
  // the pairs that genuinely correspond; the rest of the mirror has no named
  // Permission and is governed by its route alone.
  const CAPABILITY_TO_PERMISSION: Record<string, string> = {
    "payments.mutate": "finance.refunds",
    "affiliate.commission.settle": "finance.commissions.settle",
    "deal.esign.void": "deals.esign.void",
    "dealer.terminate": "dealers.terminate",
    "support.impersonate": "support.impersonate",
  };

  test("no mirrored capability is LOOSER than the ruled permission policy", () => {
    // The impersonation defect in one sentence: the route admitted a role the
    // ruled policy withheld, and because requirePermission() is shadow-mode the
    // ROUTE governed — so the withheld grant was live, and nothing compared the
    // two. This does.
    //
    // The invariant is SUBSET, not equality. A route stricter than the policy is
    // safe and intentional (dealer.terminate is SUPER-only in the route while
    // the policy allows OPS). A route LOOSER than the policy grants access the
    // owner ruled against — always a defect.
    const permissions = readFileSync(join(process.cwd(), "lib/auth/permissions.ts"), "utf8");

    /** Resolve `"perm": NAME` or `"perm": ["A","B"]` to role names. */
    function ruledRoles(permission: string): string[] {
      const esc = permission.replace(/\./g, "\\.");
      const m = permissions.match(new RegExp(`"${esc}":\\s*(\\[[^\\]]*\\]|[A-Z_]+)`));
      assert.ok(m, `PERMISSION_ROLES has no entry for "${permission}" — fix the map above`);
      const named = m![1];
      const source = named.startsWith("[")
        ? named
        : (() => {
            const c = permissions.match(
              new RegExp(`const ${named}:\\s*AdminRole\\[\\]\\s*=\\s*(\\[[^\\]]*\\])`),
            );
            assert.ok(c, `could not resolve the role constant ${named}`);
            return c![1];
          })();
      const roles = [...source.matchAll(/"([A-Z_]+)"/g)].map((r) => r[1]);
      assert.ok(roles.length > 0, `resolved no roles for "${permission}"`);
      return roles;
    }

    const looser: string[] = [];
    for (const [capability, permission] of Object.entries(CAPABILITY_TO_PERMISSION)) {
      const spec = ADMIN_UI_CAPABILITIES[capability as AdminUiCapability];
      assert.ok(spec, `${capability} is not a mirrored capability — fix the map above`);
      const ruled = new Set(ruledRoles(permission));
      const extra = (spec.roles as readonly string[]).filter((r) => !ruled.has(r));
      if (extra.length > 0) {
        looser.push(
          `${capability} admits [${extra}] which "${permission}" does not admit: ` +
            `route/UI [${[...spec.roles].sort()}] vs policy [${[...ruled].sort()}]`,
        );
      }
    }
    assert.deepEqual(
      looser,
      [],
      "a route grants access the ruled policy withholds:\n" + looser.join("\n"),
    );

    assert.equal(
      Object.keys(CAPABILITY_TO_PERMISSION).length,
      5,
      "the capability->permission map changed size — re-check the correspondences",
    );
  });
});

/**
 * The guard that would have caught the concierge "Refund Fee" miss.
 *
 * The mirror test above proves each MIRRORED allow-list matches its route. It
 * cannot see a control that was never mirrored at all — and that is exactly how
 * two ungated buttons shipped: a string replace matched one button's
 * indentation and silently missed its sibling, and nothing failed.
 *
 * So: for every component that has opted into the mirror, every admin endpoint
 * it calls that HARD-DENIES must be represented in ADMIN_UI_CAPABILITIES. A
 * component that gates one money control and leaves its neighbour open now
 * fails CI instead of reaching a reviewer.
 *
 * Scope is deliberately the opted-in components, not all 73 hard-denying admin
 * routes: this asserts internal consistency of the surfaces Batch 2 gated, and
 * does not silently claim console-wide coverage that does not exist.
 */
describe("admin UI role mirror — opted-in components gate every hard-denying endpoint they call", () => {
  const ROOT = process.cwd();

  function walk(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, acc);
      else if (/\.tsx?$/.test(entry)) acc.push(full);
    }
    return acc;
  }

  /** Route files under app/api/admin, as URL paths. */
  const routeFiles = walk(join(ROOT, "app", "api", "admin")).filter((f) => f.endsWith("route.ts"));
  const routeUrl = (file: string) =>
    "/" + relative(join(ROOT, "app"), dirname(file)).split("\\").join("/");

  function matches(routePath: string, url: string): boolean {
    const rs = routePath.replace(/^\//, "").split("/");
    const us = url.replace(/^\//, "").split("/");
    if (rs.length !== us.length) return false;
    return rs.every((s, i) => s.startsWith("[") || s === us[i]);
  }

  /** Components that imported the mirror — i.e. opted into role-aware UI. */
  const optedIn = [
    ...walk(join(ROOT, "app", "admin")),
    ...walk(join(ROOT, "components", "admin")),
  ].filter((f) => readFileSync(f, "utf8").includes("admin-ui-roles"));

  const mirrored = new Set(
    Object.values(ADMIN_UI_CAPABILITIES).flatMap((c) => c.sourceRoutes as readonly string[]),
  );

  test("there is at least one opted-in component to check", () => {
    assert.ok(optedIn.length > 0, "no component imports admin-ui-roles — the guard would be vacuous");
  });

  test("every hard-denying endpoint called from a gated component is mirrored", () => {
    const gaps: string[] = [];
    for (const file of optedIn) {
      const src = readFileSync(file, "utf8");
      const called = new Set<string>();
      for (const m of src.matchAll(/['"`](\/api\/admin\/[^'"`\s]*)['"`]/g)) {
        called.add(m[1].split("?")[0].replace(/\$\{[^{}]*\}/g, "X").replace(/\/$/, ""));
      }
      for (const url of called) {
        const routeFile = routeFiles.find((rf) => matches(routeUrl(rf), url));
        if (!routeFile) continue;
        const routeSrc = readFileSync(routeFile, "utf8");
        const hardDenies =
          enforcedRolesIn(routeSrc).size > 0 || routeSrc.includes("requirePermissionActorStrict");
        if (!hardDenies) continue;
        const rel = relative(ROOT, routeFile).split("\\").join("/");
        if (!mirrored.has(rel)) {
          gaps.push(`${relative(ROOT, file)} calls ${url} (${rel}) which hard-denies, but no capability mirrors it`);
        }
      }
    }
    assert.deepEqual(
      gaps,
      [],
      `a gated component leaves a hard-denying control ungated:\n${gaps.join("\n")}`,
    );
  });
});
