import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import {
  getAdminDealerDetailData,
  updateDealerProfileByAdmin,
} from "@/lib/services/admin/admin-dealer-command-center.service";
import { z } from "zod";

interface Props { params: Promise<{ dealerId: string }> }

const patchSchema = z.object({
  dealershipName: z.string().min(1).optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  licenseNumber: z.string().optional(),
  tier: z.string().optional(),
  reason: z.string().min(5, "Reason must be at least 5 characters"),
});

export async function GET(request: NextRequest, { params }: Props) {
  const { dealerId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  try {
    const data = await getAdminDealerDetailData(dealerId);
    if (!data) return adminError("NOT_FOUND", "Dealer not found", 404);
    return adminSuccess(data);
  } catch (err) {
    return adminError("FETCH_FAILED", err instanceof Error ? err.message : "Failed to fetch dealer", 500);
  }
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { dealerId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  try {
    const result = await updateDealerProfileByAdmin(dealerId, admin.adminId, admin.email, parsed.data);
    return adminSuccess({ id: result.id, status: result.status });
  } catch (err) {
    return adminError("UPDATE_FAILED", err instanceof Error ? err.message : "Update failed", 400);
  }
}
