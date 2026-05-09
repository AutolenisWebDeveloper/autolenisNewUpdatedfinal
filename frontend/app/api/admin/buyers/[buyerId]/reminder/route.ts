// POST /api/admin/buyers/[buyerId]/reminder
// Send an in-app reminder/message to a buyer from admin.
// Creates Notification record. Logs to AdminAuditLog.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { triggerBuyerReminder } from "@/lib/services/admin/admin-buyer-command-center.service";

interface Props { params: Promise<{ buyerId: string }> }

const schema = z.object({
  message: z.string().min(1, "Message is required").max(500, "Message must be 500 chars or less"),
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

  const result = await triggerBuyerReminder(
    buyerId,
    admin.adminId,
    admin.email,
    parsed.data.message,
    parsed.data.reason
  );

  return adminSuccess(result);
}
