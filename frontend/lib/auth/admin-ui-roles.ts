// lib/auth/admin-ui-roles.ts — role allow-lists mirrored into the admin UI.
//
// ============================================================================
// THIS IS NOT AN AUTHORIZATION BOUNDARY.
// ============================================================================
// Server-side authorization is and remains authoritative. Every list here is a
// COPY of a check the server already performs, kept so an under-privileged
// admin is not shown a control that will 403 the moment they press it. Hiding
// or disabling a control here prevents a wasted click and a confusing error —
// it prevents nothing else. Removing a check from this file must never be able
// to grant access, and adding one must never be relied on to deny it.
//
// WHAT IS MIRRORED, AND WHAT DELIBERATELY IS NOT
// lib/auth/permissions.ts is mostly in SHADOW mode: requirePermission() records
// a would-be denial and ALLOWS the request while RBAC_ENFORCE is unset. Only
// two kinds of check actually deny today:
//   1. requirePermissionActorStrict(...) — hard-denies regardless of the flag.
//   2. an explicit role check in the route — getAdminWithRole(request, [...]),
//      an ALLOWED_ROLES set, or an inline admin.role comparison.
//   3. requireContentCapability(request, "content.x") — a thin wrapper that
//      forwards CONTENT_CAPABILITY_ROLES["content.x"] to getAdminWithRole, so
//      it denies exactly like form 2 with the roles held one indirection away.
// Only those are mirrored. Gating the UI on the full PERMISSION_ROLES map would
// hide controls the server currently permits, which would be a capability
// regression dressed up as a security improvement.
//
// Every entry names the route file that enforces it, and
// lib/auth/__tests__/admin-ui-roles.test.ts reads those files and fails if a
// mirrored list stops matching the server. The mirror cannot silently drift.

export type AdminRoleName =
  | "SUPER_ADMIN"
  | "OPERATIONS_ADMIN"
  | "COMPLIANCE_ADMIN"
  | "FINANCE_ADMIN"
  | "SUPPORT_ADMIN";

/** Money movement and correction. */
const MONEY: readonly AdminRoleName[] = ["SUPER_ADMIN", "FINANCE_ADMIN"];
/** Operational state changes on a deal, auction or pickup. */
const OPS: readonly AdminRoleName[] = ["SUPER_ADMIN", "OPERATIONS_ADMIN"];
/** Super-admin only. */
const SUPER: readonly AdminRoleName[] = ["SUPER_ADMIN"];
/** Content editors — mirrors CONTENT_CAPABILITY_ROLES' EDITORS grouping. */
const EDITORS: readonly AdminRoleName[] = ["SUPER_ADMIN", "OPERATIONS_ADMIN"];
/** Every operational role — mirrors content-permissions' ALL_OPERATIONAL. */
const ALL_OPERATIONAL_ROLES: readonly AdminRoleName[] = [
  "SUPER_ADMIN",
  "OPERATIONS_ADMIN",
  "COMPLIANCE_ADMIN",
  "FINANCE_ADMIN",
  "SUPPORT_ADMIN",
];

/**
 * UI capability → the roles the SERVER actually admits, plus the route files
 * that enforce it. `sourceRoutes` is what the drift test reads.
 */
export const ADMIN_UI_CAPABILITIES = {
  /** Charge, refund, mark-paid, waive: the Payment Hub and deposit views. */
  "payments.mutate": {
    roles: MONEY,
    sourceRoutes: [
      "app/api/admin/payments/deposit/[depositId]/refund/route.ts",
      "app/api/admin/payments/deposit/[depositId]/mark-paid/route.ts",
      "app/api/admin/payments/deposit/create-intent/route.ts",
      "app/api/admin/payments/concierge-fee/create-intent/route.ts",
      "app/api/admin/payments/concierge-fee/[dealId]/mark-paid/route.ts",
      "app/api/admin/payments/concierge-fee/[dealId]/refund/route.ts",
      // The "Waive Deposit" control posts here.
      "app/api/admin/buyers/[buyerId]/deposit/override/route.ts",
    ],
  },
  /** Record a payout or claw a commission back. */
  "affiliate.commission.settle": {
    roles: MONEY,
    sourceRoutes: [
      "app/api/admin/affiliates/commissions/[commissionId]/mark-paid/route.ts",
      "app/api/admin/affiliates/commissions/[commissionId]/clawback/route.ts",
      "app/api/admin/affiliates/commissions/[commissionId]/approve/route.ts",
      "app/api/admin/affiliates/commissions/[commissionId]/reject/route.ts",
    ],
  },
  /** Pay a referral milestone and edit milestone configuration. */
  "referral.milestone.pay": {
    roles: MONEY,
    sourceRoutes: ["app/api/admin/referral-milestones/[id]/pay/route.ts"],
  },
  /** Approve or reject an affiliate's onboarding submission. */
  "affiliate.onboarding.review": {
    roles: ["SUPER_ADMIN", "COMPLIANCE_ADMIN", "OPERATIONS_ADMIN"] as const,
    sourceRoutes: ["app/api/admin/affiliates/[affiliateId]/onboarding/review/route.ts"],
  },
  /** Void a signing envelope. Resend is NOT gated — its route is auth-only. */
  "deal.esign.void": {
    roles: OPS,
    sourceRoutes: ["app/api/admin/deals/[dealId]/esign/void/route.ts"],
  },
  /** Advance or correct deal state. */
  "deal.action": {
    roles: OPS,
    sourceRoutes: ["app/api/admin/deals/[dealId]/action/route.ts"],
  },
  /** Close, extend or otherwise act on an auction. */
  "auction.action": {
    roles: OPS,
    sourceRoutes: ["app/api/admin/auctions/[auctionId]/action/route.ts"],
  },
  /** Mark a pickup complete. */
  "pickup.complete": {
    roles: OPS,
    sourceRoutes: ["app/api/admin/deals/[dealId]/pickup/complete/route.ts"],
  },
  /** Clear or escalate a sanctions hit. */
  "compliance.ofac.review": {
    roles: ["SUPER_ADMIN", "OPERATIONS_ADMIN", "COMPLIANCE_ADMIN"] as const,
    sourceRoutes: ["app/api/admin/compliance/ofac/[prequalId]/route.ts"],
  },
  /** Terminate a dealer — stricter in the route than in PERMISSION_ROLES. */
  "dealer.terminate": {
    roles: SUPER,
    sourceRoutes: ["app/api/admin/dealers/[dealerId]/terminate/route.ts"],
  },
  /**
   * Start or end an impersonation session.
   *
   * Batch 2 recorded this as an OWNER-GATED disagreement: the routes admitted
   * ["SUPER_ADMIN","SUPPORT_ADMIN"] while PERMISSION_ROLES and ruled policies 1
   * ("SUPPORT_ADMIN: ... no impersonation grant") and 4 ("one narrow role only")
   * said SUPER-only. The owner has since ruled to enforce the policy, so the
   * routes are SUPER-only and all three now agree.
   */
  "support.impersonate": {
    roles: SUPER,
    sourceRoutes: [
      "app/api/admin/support/impersonate/route.ts",
      "app/api/admin/support/impersonation/[id]/end/route.ts",
    ],
  },
  /**
   * Enqueue a content generation / regeneration batch.
   *
   * The route enforces this through requireContentCapability("content.generate"),
   * which resolves to CONTENT_CAPABILITY_ROLES.EDITORS. Mirrored so the Generate
   * control on the Content Engine is disabled-with-a-reason for the three roles
   * the server refuses, instead of 403-ing after the click.
   */
  "content.generate": {
    roles: EDITORS,
    sourceRoutes: ["app/api/admin/content/articles/generate/route.ts"],
  },
  /** Retry / cancel / pause / resume a generation job. */
  "content.manage_jobs": {
    roles: EDITORS,
    sourceRoutes: ["app/api/admin/content/jobs/[id]/route.ts"],
  },
  /**
   * Read the generation job list.
   *
   * Every operational role is admitted, so this gates nothing today — it is
   * mirrored because the route DOES perform a hard role check, and the
   * scope-discipline test requires each hard-denying endpoint a gated component
   * calls to be represented. Recording it as open is the honest entry; omitting
   * it would leave a real check undocumented.
   */
  "content.view": {
    roles: ALL_OPERATIONAL_ROLES,
    sourceRoutes: ["app/api/admin/content/jobs/route.ts"],
  },
} as const satisfies Record<
  string,
  { roles: readonly AdminRoleName[]; sourceRoutes: readonly string[] }
>;

export type AdminUiCapability = keyof typeof ADMIN_UI_CAPABILITIES;

/**
 * Whether the UI should offer a control.
 *
 * Fails OPEN on an unknown role: if the role cannot be determined the control
 * stays visible and the server does its job. Failing closed here would hide
 * working capability from a legitimate admin on nothing more than a plumbing
 * gap — the opposite of what this batch is for.
 */
export function canUse(capability: AdminUiCapability, role?: string | null): boolean {
  if (!role) return true;
  return (ADMIN_UI_CAPABILITIES[capability].roles as readonly string[]).includes(role);
}

/** Explanation for a control left visible but disabled. */
export function deniedReason(capability: AdminUiCapability): string {
  const roles = ADMIN_UI_CAPABILITIES[capability].roles as readonly string[];
  const readable = roles.map((r) => r.replace(/_/g, " ").toLowerCase()).join(" or ");
  return `Your admin role cannot perform this action. Requires ${readable}.`;
}
