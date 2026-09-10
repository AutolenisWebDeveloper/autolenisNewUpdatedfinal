// POST /api/admin/buyers/[buyerId]/plan
// Changes buyer plan (STANDARD or PREMIUM).
// Validates buyer exists, updates plan and planUpgradedAt.
// Writes AuditLog: BUYER_PLAN_CHANGED with previousState/newState.
// Requires reason (min 10 chars).
// SUPER_ADMIN or FINANCE_ADMIN only.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { downgradeToStandard, assignConcierge } from "@/lib/services/plan/plan-change.service";
import { recordRequestPlanElection } from "@/lib/services/buyer/plan-snapshot.service";
import { findOpenRequest } from "@/lib/services/vehicle-request/open-request.service";

interface Props { params: Promise<{ buyerId: string }> }

const schema = z.object({
  plan: z.enum(["STANDARD", "PREMIUM"]),
  reason: z.string().min(10, "Reason must be at least 10 characters"),
  /**
   * §23.2 "On settlement": assign the named concierge and move ownership from the
   * Operations pool to that person. Optional, and only meaningful on an upgrade.
   *
   * There is no concierge ROSTER in this platform — no rotation, no availability, no
   * capacity — so an automatic same-day assignment has nobody to assign. Naming the
   * admin here is the honest shape: a person decides who owns the transaction, and the
   * ownership move is recorded. When a roster exists, the automatic path can call the
   * same service.
   */
  conciergeAdminId: z.string().optional(),
});

const ALLOWED_ROLES = new Set(["SUPER_ADMIN", "FINANCE_ADMIN"]);

export async function POST(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!ALLOWED_ROLES.has(admin.role)) return adminError("FORBIDDEN", "SUPER_ADMIN or FINANCE_ADMIN required", 403);

  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, include: { user: true } });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { plan, reason } = parsed.data;
  const oldPlan = buyer.plan;

  if (oldPlan === plan) return adminError("NO_CHANGE", `Buyer is already on ${plan} plan`, 400);

  // VALIDATE THE CONCIERGE BEFORE ANY WRITE.
  //
  // Found by the second independent review: this is a client-supplied string written to
  // `vehicle_requests.assigned_admin_id`, which is foreign-keyed to `admins`. A typo
  // produced a P2003 AFTER the plan flag had already committed — leaving the buyer
  // changed with no audit row, and unable to be retried, because the very next attempt
  // answers NO_CHANGE. Checked here, where the answer is a 400 and nothing has moved.
  if (parsed.data.conciergeAdminId) {
    const conciergeAdmin = await prisma.admin.findUnique({
      where: { id: parsed.data.conciergeAdminId },
      select: { id: true },
    });
    if (!conciergeAdmin) {
      return adminError("VALIDATION_ERROR", "conciergeAdminId does not name an admin", 400);
    }
  }

  const now = new Date();
  const updated = await prisma.buyer.update({
    where: { id: buyerId },
    data: {
      plan,
      planUpgradedAt: plan === "PREMIUM" ? now : null,
    },
    select: { id: true, plan: true, planUpgradedAt: true },
  });

  const ipAddress = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined;

  // THE AUDIT ROW GOES FIRST, immediately after the flag it records.
  //
  // It used to be written after the plan services below, so a throw in any of them left
  // the buyer's plan changed with NO audit trail at all — and unrecoverable, because the
  // retry answers NO_CHANGE. The audit row is the record that an admin made this
  // decision; it must not be contingent on the work that follows it succeeding.
  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "BUYER_PLAN_CHANGED",
      entityType: "Buyer",
      entityId: buyerId,
      reason,
      previousState: { plan: oldPlan },
      newState: { plan },
      ipAddress: ipAddress ?? null,
      metadata: { buyerEmail: buyer.user.email },
    },
  });

  // §23.1 / §23.3 — THE PLAN CHANGE IS RECORDED, AND A DOWNGRADE DOES MORE THAN A FLAG.
  //
  // This route wrote the flag and an audit row and stopped: no `plan_snapshots` row, so
  // the history the table exists to hold had a hole exactly where a post-settlement
  // refund review needs it; no concierge release; no ownership move back to the
  // Operations pool; and, where the $400 had already settled, no Finance review at all
  // — §23.3 makes that a refund REQUEST and it was simply not raised.
  //
  // Both directions bind to the buyer's open request, because §23.1 elects per request.
  // A buyer with no open request still gets the flag change and the audit row: the
  // election has nothing to bind to, and refusing an admin action for that would be
  // worse than recording it at buyer level alone.
  //
  // The service work is reported, not thrown. The flag and the audit row have already
  // committed; failing the whole action here would tell the admin nothing happened when
  // something did, and the retry would answer NO_CHANGE.
  let downgrade: Awaited<ReturnType<typeof downgradeToStandard>> | null = null;
  let planServiceError: string | null = null;
  try {
  const openRequest = await findOpenRequest(buyerId);
  if (openRequest) {
    if (plan === "STANDARD") {
      downgrade = await downgradeToStandard({
        buyerId,
        vehicleRequestId: openRequest.id,
        actor: `admin:${admin.adminId}`,
        reason,
      });
    } else {
      await recordRequestPlanElection({
        buyerId,
        vehicleRequestId: openRequest.id,
        plan: "PREMIUM",
        touchpoint: "admin_override",
        actor: `admin:${admin.adminId}`,
        reason,
      });
      if (parsed.data.conciergeAdminId) {
        await assignConcierge({
          vehicleRequestId: openRequest.id,
          buyerId,
          adminId: parsed.data.conciergeAdminId,
          actor: `admin:${admin.adminId}`,
        });
      }
    }
  }
  } catch (err) {
    planServiceError = err instanceof Error ? err.message : "plan services failed";
    logger.error(`[admin/plan] plan services failed for buyer ${buyerId} after the flag committed:`, err);
  }

  return adminSuccess({
    buyer: { id: updated.id, plan: updated.plan, planUpgradedAt: updated.planUpgradedAt },
    // `REFUND_REVIEW_RAISED` means the $400 had settled and §22.1's manual review is now
    // open. NOTHING was refunded — the admin UI must say so rather than implying money
    // moved.
    downgrade,
    // Non-null when the flag and the audit row landed but the snapshot, the concierge
    // release or the Finance review did not. The admin needs to know the difference.
    planServiceError,
  });
}
