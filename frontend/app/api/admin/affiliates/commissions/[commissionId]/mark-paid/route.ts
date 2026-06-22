import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminError, adminSuccess } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

interface Props { params: Promise<{ commissionId: string }> }

const schema = z.object({
  paymentMethod:    z.enum(["ACH Transfer","Zelle","PayPal","Check","Venmo","Other"]),
  paymentReference: z.string().min(1, "Reference is required"),
  note:             z.string().max(500).optional(),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { commissionId } = await params;
  const admin = await getAdminFromRequest(request);
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

  // F-002/F-003 — single settlement rail. Record a REAL AffiliatePayout(PAID)
  // and flip the commission to PAID + link it (payoutId) in ONE transaction, so
  // status, paidAt, and the money-out record can never diverge. PAID is set
  // only here, on an actual recorded settlement — never speculatively at
  // request time (the old self-serve rail did, and is now disabled).
  const settledAt = new Date();
  await prisma.$transaction(async (tx) => {
    const payout = await tx.affiliatePayout.create({
      data: {
        affiliateId: commission.affiliateId,
        amountCents: commission.amountCents,
        status: "PAID",
        method: parsed.data.paymentMethod,
        reference: parsed.data.paymentReference,
        periodStart: commission.createdAt,
        periodEnd: settledAt,
        processedAt: settledAt,
      },
    });
    await tx.commission.update({
      where: { id: commissionId },
      data: { status: "PAID", paidAt: settledAt, payoutId: payout.id },
    });
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId, adminEmail: admin.email,
      action: "COMMISSION_PAID", entityType: "Commission", entityId: commissionId,
      metadata: {
        affiliateId: commission.affiliateId,
        amountCents: commission.amountCents,
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
