import { requirePermission } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { adminError, adminSuccess } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import {
  settleApprovedCommission,
  CommissionNotClaimableError,
} from "@/lib/services/affiliate/affiliate-payout.service";

interface Props { params: Promise<{ commissionId: string }> }

const schema = z.object({
  paymentMethod:    z.enum(["ACH Transfer","Zelle","PayPal","Check","Venmo","Other"]),
  paymentReference: z.string().min(1, "Reference is required"),
  note:             z.string().max(500).optional(),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { commissionId } = await params;
  const admin = await requirePermission(request, "finance.commissions.settle");
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const commission = await prisma.commission.findUnique({
    where: { id: commissionId },
  });
  if (!commission) return adminError("NOT_FOUND", "Commission not found", 404);
  if (commission.status !== "APPROVED")
    return adminError("INVALID_STATUS", `Commission is ${commission.status}, not APPROVED`, 400);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  // F-002/F-003 — single settlement rail. The service records a REAL
  // AffiliatePayout(PAID) and flips the commission to PAID + links payoutId in
  // ONE transaction via an APPROVED→PAID compare-and-set, so two concurrent
  // settlements (double-click / two admins) can never both succeed. The
  // status check above is a fast, friendly fail; the compare-and-set is the
  // real guard against the concurrent case a plain read cannot see.
  let settlement;
  try {
    settlement = await settleApprovedCommission({
      commissionId,
      paymentMethod: parsed.data.paymentMethod,
      paymentReference: parsed.data.paymentReference,
    });
  } catch (err) {
    if (err instanceof CommissionNotClaimableError) {
      // Lost the race between the read and the claim, or it was settled meanwhile.
      return adminError("CONFLICT", "Commission was already settled or is being settled concurrently", 409);
    }
    throw err;
  }

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId, adminEmail: admin.email,
      action: "COMMISSION_PAID", entityType: "Commission", entityId: commissionId,
      metadata: {
        affiliateId: commission.affiliateId,
        amountCents: commission.amountCents,
        payoutId: settlement.payoutId,
        paymentMethod: parsed.data.paymentMethod,
        paymentReference: parsed.data.paymentReference,
        note: parsed.data.note ?? null,
      },
    },
  }).catch(() => {});

  // Notify the affiliate their payout was processed — best-effort.
  await prisma.notification.create({
    data: {
      affiliateId: commission.affiliateId,
      type: "PAYOUT_PAID",
      channel: "IN_APP",
      title: "Commission paid",
      body: `Your commission of $${(commission.amountCents / 100).toLocaleString()} has been paid via ${parsed.data.paymentMethod} (ref: ${parsed.data.paymentReference}).`,
    },
  }).catch((err) => logger.error("[commissions/mark-paid] affiliate notification failed:", err));

  return adminSuccess({ commissionId, status: "PAID" });
}
