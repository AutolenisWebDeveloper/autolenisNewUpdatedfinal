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

  await prisma.commission.update({
    where: { id: commissionId },
    data: { status: "PAID", paidAt: new Date() },
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

  return adminSuccess({ commissionId, status: "PAID" });
}
