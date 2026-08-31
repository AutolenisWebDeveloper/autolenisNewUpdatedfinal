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

// Location validation at parity with the buyer-facing prequal route
// (app/api/buyer/prequal/route.ts). This is the path the buyer-location
// backfill runs through, and `dealer-invitation.service` resolves coordinates
// via `lookupZip` (first 5 chars) then `lookupCity` (keyed "city,state"). An
// unvalidated "Texas" or "787" resolves to null there, so the row would look
// backfilled while the auction still invited zero dealers.
const STATE_RE = /^[A-Za-z]{2}$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;

const patchSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  // `""` is permitted and means "not provided / clear this field", matching
  // app/api/buyer/profile/route.ts. The admin edit form seeds itself from
  // `buyer.state ?? ""` and submits every field on each save, so rejecting the
  // empty string would 400 every save for a buyer whose location is NULL —
  // exactly the rows the backfill exists to repair.
  state: z.string().regex(STATE_RE, "State must be a 2-letter code").optional().or(z.literal("")),
  zip: z.string().regex(ZIP_RE, "ZIP must be 5 digits (or ZIP+4)").optional().or(z.literal("")),
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
