// POST /api/admin/buyers/[buyerId]/assign
// Assign a buyer to an admin for ownership/support queue.
// Logs to AdminAuditLog. Requires reason.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { assignBuyerToAdmin } from "@/lib/services/admin/admin-buyer-command-center.service";

interface Props { params: Promise<{ buyerId: string }> }

const schema = z.object({
  assignedTo: z.string().min(1, "Assignee email or ID is required"),
  reason: z.string().min(1, "Reason is required"),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, select: { id: true } });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const result = await assignBuyerToAdmin(
    buyerId,
    admin.adminId,
    admin.email,
    parsed.data.assignedTo,
    parsed.data.reason
  );

  return adminSuccess(result);
}
