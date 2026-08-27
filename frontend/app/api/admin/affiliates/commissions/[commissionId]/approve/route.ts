import { requirePermission } from "@/lib/auth/permissions";
import { NextRequest } from "next/server";
import { adminError, adminSuccess } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

interface Props { params: Promise<{ commissionId: string }> }
const schema = z.object({ note: z.string().max(500).optional() });

// requirePermission is shadow-only (it records a would-be denial and allows),
// so approving affiliate money needs this hard check — same gate the reverse/
// and clawback/ siblings already enforce.
const ALLOWED_ROLES = new Set(["SUPER_ADMIN", "FINANCE_ADMIN"]);

export async function POST(request: NextRequest, { params }: Props) {
  const { commissionId } = await params;
  const admin = await requirePermission(request, "finance.commissions.settle");
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!ALLOWED_ROLES.has(admin.role)) return adminError("FORBIDDEN", "SUPER_ADMIN or FINANCE_ADMIN required", 403);

  const commission = await prisma.commission.findUnique({
    where: { id: commissionId },
  });
  if (!commission) return adminError("NOT_FOUND", "Commission not found", 404);
  if (commission.status !== "PENDING")
    return adminError("INVALID_STATUS", `Commission is ${commission.status}, not PENDING`, 400);

  let body: unknown = {};
  try { body = await request.json(); } catch { /* empty body ok */ }
  const parsed = schema.safeParse(body);

  await prisma.commission.update({
    where: { id: commissionId },
    data: { status: "APPROVED" },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId, adminEmail: admin.email,
      action: "COMMISSION_APPROVED", entityType: "Commission", entityId: commissionId,
      reason: parsed.success ? (parsed.data.note ?? null) : null,
      metadata: { affiliateId: commission.affiliateId, amountCents: commission.amountCents },
    },
  }).catch(() => {});

  return adminSuccess({ commissionId, status: "APPROVED" });
}
