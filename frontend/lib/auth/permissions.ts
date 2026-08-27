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
// EXCEPTION (admin authz audit, batch 1): a shadow gate is not sufficient for a
// route that moves money, fans out sends, or replays arbitrary jobs — there,
// "recorded but allowed" is an authorization defect, not a rollout stage. Those
// specific routes hard-enforce ahead of the T4 flip:
//   • requirePermissionActorStrict() — hard-denies regardless of RBAC_ENFORCE,
//     used by the ops.replay / comms.bulk_send / comms.reply routes.
//   • an inline role check after requirePermission() — the pattern already used
//     by the commission reverse/ and clawback/ routes.
// Both draw their allow-list from PERMISSION_ROLES below, so they enforce the
// roles the owner already ruled and invent no new policy. This is a per-route
// correction; RBAC_ENFORCE stays unset and every other call site stays shadow.
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
 * Durable record of a permission denial. `action` distinguishes a shadow
 * would-be denial (RBAC_SHADOW_DENY — the owner's rollout report) from a real
 * enforced one (RBAC_DENY), so hard denials never pollute the shadow bucketing.
 */
async function recordDenial(
  action: "RBAC_SHADOW_DENY" | "RBAC_DENY",
  admin: { adminId: string; email: string; role: string },
  permission: Permission,
  ctx: { path?: string | null; method?: string | null },
): Promise<void> {
  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action,
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
  }).catch((err: unknown) => logger.error(`[rbac] ${action} audit write failed:`, err));
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
  await recordDenial("RBAC_SHADOW_DENY", admin, permission, {
    path: request.nextUrl.pathname,
    method: request.method,
  });

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

  await recordDenial("RBAC_SHADOW_DENY", admin, permission, ctx);

  if (enforcing()) {
    logger.error(`[rbac] DENY ${admin.role} → ${permission} (actor)`);
    return null;
  }
  return actor; // SHADOW: allow, recorded above
}

/**
 * Result of a strict (hard-enforcing) actor permission check. The two failure
 * modes are distinct on the wire — 401 means "not signed in", 403 means "signed
 * in, wrong role" — so callers can answer with the correct status instead of
 * collapsing both into 401.
 */
export type ActorAuthzResult =
  | { ok: true; actor: AdminActor }
  | { ok: false; status: 401 | 403 };

/**
 * HARD-enforcing counterpart to requirePermissionActor, for routes whose
 * consequence is too large to run behind a shadow gate: a role outside the
 * permission's allow-list is DENIED regardless of RBAC_ENFORCE.
 *
 * This is a per-route correction, not the T4 rollout: RBAC_ENFORCE stays unset
 * and every other requirePermissionActor call site keeps its shadow semantics.
 * The allow-list is still PERMISSION_ROLES — no policy is invented here — so
 * applying it to a route only enforces the roles the owner already ruled for
 * that permission. Denials are audited as RBAC_DENY, keeping them out of the
 * shadow-denial bucketing report.
 */
export async function requirePermissionActorStrict(
  permission: Permission,
  ctx: { path?: string; method?: string } = {},
): Promise<ActorAuthzResult> {
  const admin = await getAuthenticatedAdmin();
  if (!admin) return { ok: false, status: 401 };

  const allowed = (PERMISSION_ROLES[permission] as readonly string[]).includes(admin.role);
  if (allowed) {
    return { ok: true, actor: { adminId: admin.adminId, adminEmail: admin.email } };
  }

  await recordDenial("RBAC_DENY", admin, permission, ctx);
  logger.error(`[rbac] DENY ${admin.role} → ${permission} (actor, strict)`);
  return { ok: false, status: 403 };
}
