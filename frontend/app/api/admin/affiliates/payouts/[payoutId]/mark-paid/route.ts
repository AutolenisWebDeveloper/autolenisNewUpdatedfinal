// POST /api/admin/affiliates/payouts/[payoutId]/mark-paid
// Decision 3 — settles a self-serve payout REQUEST: the payout flips
// PENDING→PAID and every commission it claimed flips APPROVED→PAID, all in
// one compare-and-set transaction (settleRequestedPayout). Recorded-only —
// no real money movement until a processor is integrated (F-049).
// FINANCE_ADMIN or SUPER_ADMIN only (same hard gate as the commission rail).

import { requirePermission } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { adminError, adminSuccess } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import {
  settleRequestedPayout,
  CommissionNotClaimableError,
} from "@/lib/services/affiliate/affiliate-payout.service";

interface Props { params: Promise<{ payoutId: string }> }

const schema = z.object({
  paymentMethod:    z.enum(["ACH Transfer", "Zelle", "PayPal", "Check", "Venmo", "Other"]),
  paymentReference: z.string().min(1, "Reference is required"),
  note:             z.string().max(500).optional(),
});

// requirePermission is shadow-only; the hard role check is the real gate.
const ALLOWED_ROLES = new Set(["SUPER_ADMIN", "FINANCE_ADMIN"]);

export async function POST(request: NextRequest, { params }: Props) {
  const { payoutId } = await params;
  const admin = await requirePermission(request, "finance.commissions.settle");
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!ALLOWED_ROLES.has(admin.role)) return adminError("FORBIDDEN", "SUPER_ADMIN or FINANCE_ADMIN required", 403);

  const payout = await prisma.affiliatePayout.findUnique({ where: { id: payoutId } });
  if (!payout) return adminError("NOT_FOUND", "Payout not found", 404);
  if (payout.status !== "PENDING")
    return adminError("INVALID_STATUS", `Payout is ${payout.status}, not PENDING`, 400);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  let settlement;
  try {
    settlement = await settleRequestedPayout({
      payoutId,
      paymentMethod: parsed.data.paymentMethod,
      paymentReference: parsed.data.paymentReference,
    });
  } catch (err) {
    if (err instanceof CommissionNotClaimableError) {
      return adminError("CONFLICT", "Payout was already settled or is being settled concurrently", 409);
    }
    throw err;
  }

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId, adminEmail: admin.email,
      action: "PAYOUT_REQUEST_SETTLED", entityType: "AffiliatePayout", entityId: payoutId,
      metadata: {
        affiliateId: settlement.affiliateId,
        amountCents: settlement.amountCents,
        commissionCount: settlement.commissionCount,
        paymentMethod: parsed.data.paymentMethod,
        paymentReference: parsed.data.paymentReference,
        note: parsed.data.note ?? null,
      },
    },
  }).catch((err) => logger.error("[payouts/mark-paid] audit log failed:", err));

  await prisma.notification.create({
    data: {
      affiliateId: settlement.affiliateId,
      type: "PAYOUT_PAID",
      channel: "IN_APP",
      title: "Payout processed",
      body: `Your payout of $${(settlement.amountCents / 100).toLocaleString()} has been paid via ${parsed.data.paymentMethod} (ref: ${parsed.data.paymentReference}).`,
      actionUrl: "/affiliate/portal/finance",
    },
  }).catch((err) => logger.error("[payouts/mark-paid] affiliate notification failed:", err));

  return adminSuccess({ payoutId, status: "PAID", amountCents: settlement.amountCents });
}
