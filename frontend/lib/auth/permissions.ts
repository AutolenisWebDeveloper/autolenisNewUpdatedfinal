// lib/auth/permissions.ts — admin RBAC permission layer (T4 PREP: SHADOW ONLY).
//
// Encodes the owner-ruled policies (2026-07 gate ruling) as a permission →
// allowed-roles map, enforced via requirePermission(). ROLLOUT STATE: SHADOW —
// requirePermission NEVER blocks; on a would-be denial it writes an
// `rbac.shadow_deny` audit record and allows the request. Flipping
// RBAC_ENFORCE=true is a T4 OPERATOR ACTION gated on the owner's review of the
// shadow-denial report and the full 224-route bucketing — do not enable it
// autonomously.
//
// Ruled policies encoded here:
//   1. SUPPORT_ADMIN: read-only; no money mutation, no PII export, no
//      impersonation grant.
//   2. OPERATIONS on money: maker-checker is the target posture; in the matrix
//      this maps to money-mutation domains being FINANCE (+SUPER) only, with
//      dual-control thresholds implemented at enforcement time.
//   3. COMPLIANCE: broad read, narrow write (flag/freeze/hold); no money
//      movement, no record alteration.
//   4. Impersonation: one narrow role only (SUPER_ADMIN until a dedicated role
//      exists) — never default-admin.
//   5. AI: read + draft only; actions log under the invoking human.

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminFromRequest } from "@/lib/auth/admin-api";
import { getAuthenticatedAdmin } from "@/lib/auth/admin-session";
import type { AdminActor } from "@/lib/auth/admin-actor";
import type { AdminJwtPayload } from "@/lib/admin-auth";
import { logger } from "@/lib/logger";

type AdminRole = "SUPER_ADMIN" | "OPERATIONS_ADMIN" | "COMPLIANCE_ADMIN" | "FINANCE_ADMIN" | "SUPPORT_ADMIN";

const ALL: AdminRole[] = ["SUPER_ADMIN", "OPERATIONS_ADMIN", "COMPLIANCE_ADMIN", "FINANCE_ADMIN", "SUPPORT_ADMIN"];
const SUPER: AdminRole[] = ["SUPER_ADMIN"];
const MONEY: AdminRole[] = ["SUPER_ADMIN", "FINANCE_ADMIN"];
const OPS: AdminRole[] = ["SUPER_ADMIN", "OPERATIONS_ADMIN"];

// Destructive-priority domains first (owner ruling: money + destructive gate
// FIRST). Read-tier and remaining domains are appended as the shadow rollout
// widens; absence from this map means "not yet shadowed", never "denied".
export const PERMISSION_ROLES = {
  // Money movement / correction — policy 2 (FINANCE-only pending maker-checker)
  "finance.commissions.settle": MONEY,   // approve / mark-paid / reject
  "finance.commissions.reverse": MONEY,  // clawback / reverse
  "finance.deposit.override": MONEY,
  "finance.refunds": MONEY,              // already role-gated; shadow confirms parity

  // Irreversible entity actions — policies 1–3
  "buyers.delete": SUPER,
  "dealers.terminate": OPS,
  "deals.esign.void": OPS,

  // Impersonation — policy 4 (single narrow role, never default admin)
  "support.impersonate": SUPER,

  // Bulk external sends — mass-comms blast radius (destructive-priority)
  "comms.bulk_send": OPS,

  // CRM domains (the getAdminActor routes). Reads are open (never deny in
  // shadow — brings them into the layer for the bucketing report); mutations
  // are OPS-tier pending the owner's per-route ruling.
  "crm.read": ALL,
  "crm.manage": OPS,

  // System administration
  "system.admins.manage": SUPER,

  // AI console — policy 5 (all roles may read/draft; actions logged as human)
  "ai.use": ALL,
} as const satisfies Record<string, readonly AdminRole[]>;

export type Permission = keyof typeof PERMISSION_ROLES;

function enforcing(): boolean {
  return process.env.RBAC_ENFORCE === "true"; // T4 operator flag — leave unset
}

/**
 * Shadow-mode permission gate. Drop-in AFTER getAdminFromRequest-style auth:
 * returns the admin context (or null when unauthenticated, same as today).
 * In shadow mode a role outside the permission's allow-list is RECORDED
 * (rbac.shadow_deny) but still allowed; only with RBAC_ENFORCE=true does it
 * return null for denied roles.
 */
export async function requirePermission(
  request: NextRequest,
  permission: Permission,
): Promise<AdminJwtPayload | null> {
  const admin = await getAdminFromRequest(request);
  if (!admin) return null;

  const allowed = (PERMISSION_ROLES[permission] as readonly string[]).includes(admin.role);
  if (allowed) return admin;

  // Would-be denial: durable audit record for the owner's shadow report.
  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "RBAC_SHADOW_DENY",
      entityType: "RBAC",
      entityId: permission,
      metadata: {
        permission,
        role: admin.role,
        path: request.nextUrl.pathname,
        method: request.method,
        enforcing: enforcing(),
      },
    },
  }).catch((err: unknown) => logger.error("[rbac] shadow-deny audit write failed:", err));

  if (enforcing()) {
    logger.error(`[rbac] DENY ${admin.role} → ${permission} (${request.method} ${request.nextUrl.pathname})`);
    return null;
  }
  return admin; // SHADOW: allow, recorded above
}

/**
 * Cookie/actor variant of requirePermission for the CRM routes that use
 * getAdminActor() (no NextRequest argument). Same shadow semantics — records a
 * would-be denial and allows unless RBAC_ENFORCE=true — and returns the
 * AdminActor {adminId, adminEmail} shape those call sites already consume, so
 * it is a drop-in replacement for `getAdminActor()`.
 */
export async function requirePermissionActor(
  permission: Permission,
  ctx: { path?: string; method?: string } = {},
): Promise<AdminActor | null> {
  const admin = await getAuthenticatedAdmin();
  if (!admin) return null;
  const actor: AdminActor = { adminId: admin.adminId, adminEmail: admin.email };

  const allowed = (PERMISSION_ROLES[permission] as readonly string[]).includes(admin.role);
  if (allowed) return actor;

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "RBAC_SHADOW_DENY",
      entityType: "RBAC",
      entityId: permission,
      metadata: {
        permission,
        role: admin.role,
        path: ctx.path ?? null,
        method: ctx.method ?? null,
        enforcing: enforcing(),
      },
    },
  }).catch((err: unknown) => logger.error("[rbac] shadow-deny audit write failed:", err));

  if (enforcing()) {
    logger.error(`[rbac] DENY ${admin.role} → ${permission} (actor)`);
    return null;
  }
  return actor; // SHADOW: allow, recorded above
}
