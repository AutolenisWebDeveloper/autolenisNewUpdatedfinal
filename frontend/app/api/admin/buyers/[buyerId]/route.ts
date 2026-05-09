import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { z } from "zod";
import { AdminRole } from "@prisma/client";
import {
  getAdminBuyerDetailData,
  updateBuyerProfileByAdmin,
  deleteBuyerByAdmin,
} from "@/lib/services/admin/admin-buyer-command-center.service";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ buyerId: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const data = await getAdminBuyerDetailData(buyerId);
  if (!data) return adminError("NOT_FOUND", "Buyer not found", 404);
  return adminSuccess(data);
}

const patchSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  employmentStatus: z.string().optional(),
  incomeRange: z.string().optional(),
  reason: z.string().min(1, "Reason is required for profile updates"),
});

export async function PATCH(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  try {
    await updateBuyerProfileByAdmin(buyerId, admin.adminId, admin.email, parsed.data);
    return adminSuccess({ updated: true });
  } catch {
    return adminError("NOT_FOUND", "Buyer not found", 404);
  }
}

const deleteSchema = z.object({
  reason: z.string().min(1, "Reason is required for permanent deletion"),
  confirmation: z.literal("DELETE", { errorMap: () => ({ message: 'Must type DELETE to confirm' }) }),
});

export async function DELETE(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  // Only SUPER_ADMIN may permanently delete buyers
  if (admin.role !== AdminRole.SUPER_ADMIN) {
    return adminError("FORBIDDEN", "Insufficient permissions", 403);
  }

  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, select: { id: true } });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  try {
    const result = await deleteBuyerByAdmin(buyerId, admin.adminId, admin.email, parsed.data.reason);
    return adminSuccess(result);
  } catch (err) {
    return adminError("ACTION_FAILED", err instanceof Error ? err.message : "Delete failed", 400);
  }
}
