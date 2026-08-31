// POST /api/admin/deals/[dealId]/contract
//
// Admin/concierge contract attachment. A concierge (vehicle-request) deal has no
// Offer, and VehicleRequestOffer carries no dealer identity, so the dealer upload
// route's ownership gate (assertDealerOwnsDeal → offer.dealerId) can never pass for
// one. That made ContractVersion unreachable for the entire concierge track, which
// in turn made Contract Shield and e-sign unreachable: no ContractVersion → no
// APPROVED version → prepareBuyerSigningEnvelope fails → the deal can never be
// signed or completed.
//
// This route gives AutoLenis staff the same pipeline the dealer has (identical
// versioning, supersede, and fail-closed Contract Shield scan) rather than a
// parallel one. It is OPS-gated and audit-logged.
import { NextRequest } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/permissions";
import { adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { uploadContractForDealByAdmin, DealOwnershipError } from "@/lib/services/dealer/dealer-contract.service";

interface Props { params: Promise<{ dealId: string }> }

const schema = z.object({ documentUrl: z.string().url() });

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const admin = await requirePermission(request, "deals.esign.void");
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  try {
    const cv = await uploadContractForDealByAdmin(dealId, parsed.data.documentUrl, admin.adminId);
    await createAuditLog(admin, request, {
      action: "CONTRACT_VERSION_UPLOADED_BY_ADMIN",
      entityType: "Deal",
      entityId: dealId,
      metadata: { contractVersionId: cv.id, version: cv.version },
    });
    return adminSuccess({ contractVersion: cv }, 201);
  } catch (err) {
    if (err instanceof DealOwnershipError) return adminError("NOT_FOUND", "Deal not found", 404);
    throw err;
  }
}
