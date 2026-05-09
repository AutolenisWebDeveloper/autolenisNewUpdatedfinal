// POST /api/admin/buyers/[buyerId]/privacy-purge
// Anonymize buyer PII while preserving financial, legal, and audit records.
// Use when hard delete is unsafe due to retention requirements.
// Requires SUPER_ADMIN + reason note + typed confirmation. Audit logged.

import { NextRequest } from "next/server";
import { getAdminWithRole, adminSuccess, adminError, getClientIp } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { privacyPurgeBuyerByAdmin } from "@/lib/services/admin/admin-buyer-command-center.service";

interface Props { params: Promise<{ buyerId: string }> }

const schema = z.object({
  reason: z.string().min(1, "Reason is required"),
  confirmation: z.literal("DELETE", { errorMap: () => ({ message: 'Must type DELETE to confirm' }) }),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;
  const admin = await getAdminWithRole(request, ["SUPER_ADMIN"]);
  if (!admin) return adminError("FORBIDDEN", "Insufficient permissions", 403);

  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, select: { id: true } });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  try {
    const result = await privacyPurgeBuyerByAdmin(buyerId, admin.adminId, admin.email, parsed.data.reason, getClientIp(request));
    return adminSuccess(result);
  } catch (err) {
    return adminError("ACTION_FAILED", err instanceof Error ? err.message : "Privacy purge failed", 400);
  }
}
