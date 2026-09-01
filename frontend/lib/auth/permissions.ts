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
// Support-inclusive outbound reply: support can reply without holding bulk
// campaign authority (policy 1 — SUPPORT_ADMIN acts, doesn't blast).
const SUPPORT_REPLY: AdminRole[] = ["SUPER_ADMIN", "OPERATIONS_ADMIN", "SUPPORT_ADMIN"];
// Compliance-inclusive HOLD: policy 3 gives COMPLIANCE a narrow write —
// flag / freeze / hold. Placing a hold is theirs; lifting someone else's is not.
const FREEZE: AdminRole[] = ["SUPER_ADMIN", "OPERATIONS_ADMIN", "COMPLIANCE_ADMIN"];

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

  // Impersonation — policy 4 (single narrow role, never default admin).
  // ALSO gates buyers/[buyerId]/preview-token, which mints a short-lived
  // view-as-buyer token: its own audit action is BUYER_IMPERSONATION_PREVIEW_STARTED,
  // so it is the same capability and shares the same door. Giving preview its own
  // lower tier would simply reopen the bypass this closed.
  "support.impersonate": SUPER,

  // ── Tier 1 of the ungated-route sweep (Finding 5) ────────────────────────
  // These routes previously carried NO role check at all — not even a shadow
  // record — so every authenticated admin could reach them.

  // Credit + money movement — policy 2, FINANCE-only. Never SUPPORT.
  "finance.preapproval.decide": MONEY,   // approve/reject an external pre-approval
  "finance.payment_link.send": MONEY,    // Stripe Checkout link to the buyer
                                         // (amount is server-fixed from constants)

  // Buyer account state, split by the owner's ruling:
  //   freeze  — placing a hold, a policy-3 compliance power
  //   lifecycle — archiving, restoring, and LIFTING a hold, which stays OPS so
  //   compliance can hold an account but not release someone else's hold.
  "buyers.freeze": FREEZE,               // suspend, disable
  "buyers.account_state": OPS,           // archive, restore, unsuspend
  "buyers.credential_reset": OPS,        // trigger buyer account recovery

  // Affiliate account state — gates commission earning, adjacent to money but not
  // a money movement (finance.commissions.* already owns payout).
  "affiliates.account_state": OPS,

  // Deal cancellation — same tier as the other deal-lifecycle keys.
  "deals.cancel": OPS,

  // Outbound comms, tiered by blast radius:
  //  • bulk_send — mass/campaign fan-out (destructive-priority). Also covers
  //    any route that CAN fan out sends (owner ruling: classify by MAX
  //    reachable side-effect), e.g. automation trigger.
  //  • reply — a single support/agent reply; support-capable, no bulk authority.
  "comms.bulk_send": OPS,
  "comms.reply": SUPPORT_REPLY,

  // Ops replay — highest-privilege op in the surface: replays a failed job,
  // re-firing arbitrary inherited side effects. SUPER only.
  "ops.replay": SUPER,

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

/** The roles the matrix admits for a permission. Single source of truth for
 *  enforcement, for the shadow report, and for role-aware UI. */
export function rolesFor(permission: Permission): readonly string[] {
  return PERMISSION_ROLES[permission] as readonly string[];
}

/** Whether `role` is admitted for `permission`, per the matrix. */
export function roleAllows(permission: Permission, role: string): boolean {
  return rolesFor(permission).includes(role);
}

export type PermissionCheck =
  | { ok: true; admin: AdminJwtPayload }
  | { ok: false; status: 401; code: "UNAUTHORIZED"; message: string }
  | { ok: false; status: 403; code: "FORBIDDEN"; message: string };

/**
 * ALWAYS-ENFORCING permission gate for the high-risk routes — money movement,
 * e-sign void/evidence, contract attachment, ops replay.
 *
 * Why this exists alongside the shadow gate:
 *
 *  • It does not wait on RBAC_ENFORCE. Those routes had NO secondary role check,
 *    so shadow mode left them open to every authenticated admin: a SUPPORT_ADMIN
 *    could settle commissions, override a deposit, void an executed signature or
 *    replay a dead-letter job. Flipping the global flag is a separate, riskier
 *    decision (67 call sites, unknown production role distribution); this exposure
 *    should not wait for it.
 *
 *  • It derives the allowed roles from PERMISSION_ROLES rather than from a role
 *    set written into each route. The existing pattern duplicates the list at the
 *    call site, and that has already drifted: the impersonation routes admit
 *    SUPER_ADMIN or SUPPORT_ADMIN while the matrix says SUPER only. Deriving makes
 *    that class of contradiction impossible.
 *
 *  • It separates 401 from 403. requirePermission returns null for BOTH "no
 *    session" and "wrong role", and every caller reports that as 401 "Not
 *    authenticated" — which would misdiagnose a role lockout as an expired
 *    session. A denied role is FORBIDDEN and says so.
 *
 * Denials are audited as RBAC_DENY, distinct from RBAC_SHADOW_DENY, so the shadow
 * report can tell a real block apart from a would-be one.
 */
export async function requirePermissionStrict(
  request: NextRequest,
  permission: Permission,
): Promise<PermissionCheck> {
  const admin = await getAdminFromRequest(request);
  if (!admin) {
    return { ok: false, status: 401, code: "UNAUTHORIZED", message: "Not authenticated" };
  }

  if (roleAllows(permission, admin.role)) return { ok: true, admin };

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "RBAC_DENY",
      entityType: "RBAC",
      entityId: permission,
      metadata: {
        permission,
        role: admin.role,
        path: request.nextUrl.pathname,
        method: request.method,
        allowedRoles: [...rolesFor(permission)],
        enforced: true,
      },
    },
  }).catch((err: unknown) => logger.error("[rbac] deny audit write failed:", err));

  logger.error(`[rbac] DENY ${admin.role} -> ${permission} (${request.method} ${request.nextUrl.pathname})`);
  return {
    ok: false,
    status: 403,
    code: "FORBIDDEN",
    message: `This action requires ${rolesFor(permission).join(" or ")}.`,
  };
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

export type ActorPermissionCheck =
  | { ok: true; actor: AdminActor }
  | { ok: false; status: 401; code: "UNAUTHORIZED"; message: string }
  | { ok: false; status: 403; code: "FORBIDDEN"; message: string };

/**
 * Always-enforcing actor variant, for the cookie-authenticated routes that use
 * getAuthenticatedAdmin() instead of a NextRequest. Same semantics as
 * requirePermissionStrict — matrix-derived roles, 401 vs 403, RBAC_DENY audit —
 * and used for ops.replay, which re-fires a dead-lettered job's arbitrary
 * inherited side effects and is the highest-privilege operation in the surface.
 */
export async function requirePermissionActorStrict(
  permission: Permission,
  ctx: { path?: string; method?: string } = {},
): Promise<ActorPermissionCheck> {
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    return { ok: false, status: 401, code: "UNAUTHORIZED", message: "Not authenticated" };
  }

  const actor: AdminActor = { adminId: admin.adminId, adminEmail: admin.email };
  if (roleAllows(permission, admin.role)) return { ok: true, actor };

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "RBAC_DENY",
      entityType: "RBAC",
      entityId: permission,
      metadata: {
        permission,
        role: admin.role,
        path: ctx.path ?? null,
        method: ctx.method ?? null,
        allowedRoles: [...rolesFor(permission)],
        enforced: true,
      },
    },
  }).catch((err: unknown) => logger.error("[rbac] deny audit write failed:", err));

  logger.error(`[rbac] DENY ${admin.role} -> ${permission} (actor)`);
  return {
    ok: false,
    status: 403,
    code: "FORBIDDEN",
    message: `This action requires ${rolesFor(permission).join(" or ")}.`,
  };
}
