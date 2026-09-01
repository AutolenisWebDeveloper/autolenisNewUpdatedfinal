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
import { contractDocumentPathSchema } from "@/lib/services/contract-shield/contract-document-ref";
import { requirePermissionStrict } from "@/lib/auth/permissions";
import { adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { uploadContractForDealByAdmin, DealOwnershipError } from "@/lib/services/dealer/dealer-contract.service";

interface Props { params: Promise<{ dealId: string }> }

// documentUrl is a bare storage path in the private contracts bucket, NOT a URL.
// `.url()` had this exactly backwards: it rejected the only format the system
// produces and accepted absolute URLs, which extract-text then fetches
// server-side with no host restriction (SSRF). See contract-document-ref.
const schema = z.object({ documentUrl: contractDocumentPathSchema });

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const adminCheck = await requirePermissionStrict(request, "deals.esign.void");
  // Enforced directly (not via the shadow flag): this route had no role
  // check at all, so every authenticated admin could reach it.
  if (!adminCheck.ok) return adminError(adminCheck.code, adminCheck.message, adminCheck.status);
  const admin = adminCheck.admin;

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
