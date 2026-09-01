// lib/services/ai/action-intent/approval-permissions.ts
//
// Deterministic approver-permission enforcement for consequential ActionIntents.
//
// This mirrors the role groupings in `lib/auth/permissions.ts` (PERMISSION_ROLES)
// for exactly the permissions the ActionIntent catalog references. It is kept
// LOCAL — rather than importing the server permissions module — so the approval
// authorization check stays hermetic (no prisma/next import) and unit-testable,
// AND so the rule is enforced in code rather than living only in catalog
// metadata. `catalog.test.ts` asserts every catalog `approverPermission` has an
// entry here; keep this in sync with lib/auth/permissions.ts.

import type { AuthenticatedRole } from "./types";

const SUPER: readonly AuthenticatedRole[] = ["SUPER_ADMIN"];
const MONEY: readonly AuthenticatedRole[] = ["SUPER_ADMIN", "FINANCE_ADMIN"];
const OPS: readonly AuthenticatedRole[] = ["SUPER_ADMIN", "OPERATIONS_ADMIN"];
const ALL_ADMIN: readonly AuthenticatedRole[] = [
  "SUPER_ADMIN",
  "OPERATIONS_ADMIN",
  "COMPLIANCE_ADMIN",
  "FINANCE_ADMIN",
  "SUPPORT_ADMIN",
];

// The admin roles allowed to APPROVE an intent that declares each permission.
export const APPROVER_PERMISSION_ROLES: Record<string, readonly AuthenticatedRole[]> = {
  "finance.refunds": MONEY,
  "finance.commissions.settle": MONEY,
  "finance.commissions.reverse": MONEY,
  "finance.deposit.override": MONEY,
  "crm.manage": OPS,
  "crm.read": ALL_ADMIN,
  "dealers.terminate": OPS,
  "deals.esign.void": OPS,
  "system.admins.manage": SUPER,
  "ai.use": ALL_ADMIN,
};

/**
 * Deterministic check: does `role` satisfy `permission`?
 * - No permission required → true.
 * - Unknown permission → FALSE (fail closed — an unrecognised permission grants
 *   no one, so a typo can never widen approval authority).
 */
export function approverRoleSatisfies(
  permission: string | undefined,
  role: AuthenticatedRole,
): boolean {
  if (!permission) return true;
  const allowed = APPROVER_PERMISSION_ROLES[permission];
  if (!allowed) return false;
  return allowed.includes(role);
}
