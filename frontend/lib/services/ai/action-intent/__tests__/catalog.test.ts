// Catalog integrity — the structural guarantees that keep enforcement
// deterministic. In particular: every consequential intent MUST require human
// approval and name a real RBAC approver permission, and every intent MUST have
// a registered deterministic policy and command. This is the automated guard
// for "no consequential rule lives only in prose".
//
//   npx tsx --test lib/services/ai/action-intent/__tests__/catalog.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { ACTION_INTENT_CATALOG, allIntentTypes } from "../catalog";
import { POLICIES } from "../policy";
import { COMMANDS } from "../commands";
import { APPROVER_PERMISSION_ROLES } from "../approval-permissions";

// Mirrors the real RBAC permission keys in lib/auth/permissions.ts
// (PERMISSION_ROLES). Kept as a hermetic allowlist so this unit test does not
// pull the server auth graph; the approval route enforces the live map.
const KNOWN_RBAC_PERMISSIONS = new Set<string>([
  "finance.commissions.settle",
  "finance.commissions.reverse",
  "finance.deposit.override",
  "finance.refunds",
  "buyers.delete",
  "dealers.terminate",
  "deals.esign.void",
  "support.impersonate",
  "comms.bulk_send",
  "comms.reply",
  "ops.replay",
  "crm.read",
  "crm.manage",
  "system.admins.manage",
  "ai.use",
]);

test("every intent has a deterministic policy and a command", () => {
  for (const type of allIntentTypes()) {
    assert.ok(POLICIES[type], `missing policy for ${type}`);
    assert.ok(COMMANDS[type], `missing command for ${type}`);
  }
});

test("every CONSEQUENTIAL intent requires human approval + a real RBAC permission", () => {
  for (const def of Object.values(ACTION_INTENT_CATALOG)) {
    if (def.consequence === "CONSEQUENTIAL") {
      assert.equal(def.requiresHumanApproval, true, `${def.type} must require approval`);
      assert.ok(def.approverPermission, `${def.type} must name an approver permission`);
      assert.ok(
        KNOWN_RBAC_PERMISSIONS.has(def.approverPermission as string),
        `${def.type} approverPermission "${def.approverPermission}" is not a real RBAC permission`,
      );
      // And it must be ENFORCEABLE — present in the deterministic approver map
      // that assertApprover consults (not just declared in catalog metadata).
      assert.ok(
        Object.prototype.hasOwnProperty.call(APPROVER_PERMISSION_ROLES, def.approverPermission as string),
        `${def.type} approverPermission "${def.approverPermission}" is not enforced in APPROVER_PERMISSION_ROLES`,
      );
    }
  }
});

test("READ intents never require approval and are side-effect-free", () => {
  for (const def of Object.values(ACTION_INTENT_CATALOG)) {
    if (def.consequence === "READ") {
      assert.equal(def.requiresHumanApproval, false, `${def.type} read must not require approval`);
      assert.equal(def.idempotency, "none");
    }
  }
});

test("activation keys are unique and namespaced by actor", () => {
  const keys = Object.values(ACTION_INTENT_CATALOG).map((d) => d.activationKey);
  assert.equal(new Set(keys).size, keys.length, "activation keys must be unique");
  for (const d of Object.values(ACTION_INTENT_CATALOG)) {
    assert.equal(d.activationKey, `${d.actorType}:${d.type}`);
  }
});

test("no intent is wildcard-permissive: permittedRoles is always explicit and non-empty", () => {
  for (const def of Object.values(ACTION_INTENT_CATALOG)) {
    assert.ok(def.permittedRoles.length > 0, `${def.type} must list permitted roles`);
  }
});

test("money-movement intents map to a MONEY/finance RBAC permission", () => {
  const refund = ACTION_INTENT_CATALOG["admin.trigger_deposit_refund"];
  assert.equal(refund.approverPermission, "finance.refunds");
});
