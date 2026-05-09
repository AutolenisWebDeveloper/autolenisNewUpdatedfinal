// POST /api/admin/affiliates/[affiliateId]/commissions
// Manually adds a commission for an affiliate.
// Body: { dealId: string; level: 1|2|3; amountCents: number; reason: string }
// Server validates: amountCents > 0 and <= 100000 (cap at $1,000 for safety)
// Creates Commission record with status: APPROVED (manual commissions skip PENDING)
// Writes AuditLog: COMMISSION_MANUALLY_ADDED
// Requires reason (min 10 chars)
// FINANCE_ADMIN or SUPER_ADMIN only

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { COMMISSION_RATES } from "@/lib/constants";

interface Props { params: Promise<{ affiliateId: string }> }

const schema = z.object({
  dealId: z.string().min(1, "Deal ID is required"),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  amountCents: z.number().int().positive().max(100000, "Amount cannot exceed $1,000"),
  reason: z.string().min(10, "Reason must be at least 10 characters"),
});

const ALLOWED_ROLES = new Set(["SUPER_ADMIN", "FINANCE_ADMIN"]);

const COMMISSION_RATE_MAP: Record<number, number> = {
  1: COMMISSION_RATES.LEVEL_1,
  2: COMMISSION_RATES.LEVEL_2,
  3: COMMISSION_RATES.LEVEL_3,
};

export async function POST(request: NextRequest, { params }: Props) {
  const { affiliateId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!ALLOWED_ROLES.has(admin.role)) return adminError("FORBIDDEN", "SUPER_ADMIN or FINANCE_ADMIN required", 403);

  const affiliate = await prisma.affiliate.findUnique({ where: { id: affiliateId } });
  if (!affiliate) return adminError("NOT_FOUND", "Affiliate not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { dealId, level, amountCents, reason } = parsed.data;

  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { id: true } });
  if (!deal) return adminError("NOT_FOUND", "Deal not found", 404);

  const commission = await prisma.commission.create({
    data: {
      affiliateId,
      dealId,
      level,
      rate: COMMISSION_RATE_MAP[level],
      amountCents,
      status: "APPROVED",
      qualifyingEventId: `admin-manual-${affiliateId}-${dealId}-${Date.now()}`,
    },
  });

  const ipAddress = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined;

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "COMMISSION_MANUALLY_ADDED",
      entityType: "Commission",
      entityId: commission.id,
      reason,
      ipAddress: ipAddress ?? null,
      metadata: { affiliateId, dealId, level, amountCents },
    },
  });

  return adminSuccess({ commission }, 201);
}
