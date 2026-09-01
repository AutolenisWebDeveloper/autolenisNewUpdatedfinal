// POST /api/admin/deals/[dealId]/contract/upload-file
//
// Admin/concierge contract attachment — the admin mirror of
// app/api/dealer/contracts/upload-file. Accepts multipart/form-data: file (PDF).
// Stores the PDF in the private bucket "dealer-contracts" AND creates the
// ContractVersion, which starts the fail-closed Contract Shield scan.
//
// Why this route exists: the concierge (vehicle-request) track could not obtain a
// ContractVersion at all. The only writer of that bucket was the dealer route,
// gated by assertDealerOwnsDeal → offer.dealerId, and a concierge deal is created
// with vehicleRequestOfferId and NO offerId — so the gate can never pass. Its
// storage key was also `${dealer.id}/...`, a value a concierge deal does not have.
// With no ContractVersion there is no scan, no APPROVED version and no signing
// envelope, so a concierge deal parked at CONTRACT_PENDING permanently.
//
// This is the SAME pipeline the dealer path uses (identical versioning, supersede
// and fail-closed scan) with admin authorization and a dealer-independent key,
// rather than a parallel one. Audit-logged.
//
// AUTHORIZATION DEPENDENCY: requirePermission is in SHADOW MODE
// (lib/auth/permissions.ts — RBAC_ENFORCE unset means a role outside the allow
// list is recorded as `rbac.shadow_deny` and STILL ALLOWED). So this route is
// authenticated as an admin but NOT role-enforced until that flag is flipped,
// which is a separate operator action. Any authenticated admin can reach it today.
import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { requirePermissionStrict } from "@/lib/auth/permissions";
import { adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { createServiceSupabaseClient } from "@/lib/supabase";
import { uploadContractForDealByAdmin, DealOwnershipError } from "@/lib/services/dealer/dealer-contract.service";

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB — parity with the dealer route
const BUCKET = "dealer-contracts";
// The deal id is interpolated into the storage key BEFORE the deal is confirmed to
// exist (that check happens inside uploadContractForDealByAdmin), so an id
// containing a separator or `..` would place an admin-supplied file at an
// arbitrary key in the private bucket and only then 404. Deal ids are uuids;
// anything outside this alphabet is rejected before it can reach the key.
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

interface Props { params: Promise<{ dealId: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const adminCheck = await requirePermissionStrict(request, "deals.esign.void");
  // Enforced directly (not via the shadow flag): this route had no role
  // check at all, so every authenticated admin could reach it.
  if (!adminCheck.ok) return adminError(adminCheck.code, adminCheck.message, adminCheck.status);
  const admin = adminCheck.admin;

  if (!SAFE_ID.test(dealId)) return adminError("VALIDATION_ERROR", "Invalid deal id", 400);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return adminError("INVALID_REQUEST", "Invalid form data", 400);
  }

  const file = form.get("file") as File | null;
  if (!file) return adminError("VALIDATION_ERROR", "File is required", 400);
  if (file.type !== "application/pdf") {
    return adminError("VALIDATION_ERROR", "Only PDF files are accepted", 400);
  }
  if (file.size > MAX_BYTES) {
    return adminError("VALIDATION_ERROR", "File must be under 20 MB", 400);
  }

  const supabase = createServiceSupabaseClient();
  // Keyed by deal, under an `admin/` prefix — a concierge deal has no dealer id to
  // scope by, and objects still stay attributable to the deal they belong to.
  const path = `admin/${dealId}/${crypto.randomUUID()}.pdf`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: "application/pdf", upsert: false });

  if (uploadError) {
    logger.error("[admin/deals/contract/upload-file]", uploadError);
    return adminError("STORAGE_ERROR", "File upload failed. Please try again.", 500);
  }

  try {
    const cv = await uploadContractForDealByAdmin(dealId, path, admin.adminId);
    await createAuditLog(admin, request, {
      action: "CONTRACT_VERSION_UPLOADED_BY_ADMIN",
      entityType: "Deal",
      entityId: dealId,
      metadata: { contractVersionId: cv.id, version: cv.version, documentUrl: path },
    });
    return adminSuccess(
      { contractVersion: cv, documentUrl: path, mimeType: "application/pdf", sizeBytes: file.size },
      201,
    );
  } catch (err) {
    if (err instanceof DealOwnershipError) return adminError("NOT_FOUND", "Deal not found", 404);
    throw err;
  }
}
