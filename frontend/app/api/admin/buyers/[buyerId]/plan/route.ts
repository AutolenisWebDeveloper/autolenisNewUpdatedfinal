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

  const now = new Date();
  const updated = await prisma.buyer.update({
    where: { id: buyerId },
    data: {
      plan,
      planUpgradedAt: plan === "PREMIUM" ? now : null,
    },
    select: { id: true, plan: true, planUpgradedAt: true },
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
  let downgrade: Awaited<ReturnType<typeof downgradeToStandard>> | null = null;
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

  const ipAddress = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined;

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

  return adminSuccess({
    buyer: { id: updated.id, plan: updated.plan, planUpgradedAt: updated.planUpgradedAt },
    // `REFUND_REVIEW_RAISED` means the $400 had settled and §22.1's manual review is now
    // open. NOTHING was refunded — the admin UI must say so rather than implying money
    // moved.
    downgrade,
  });
}
