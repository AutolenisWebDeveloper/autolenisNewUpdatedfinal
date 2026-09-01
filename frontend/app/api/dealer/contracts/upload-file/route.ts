// POST /api/dealer/contracts/upload-file — attach a contract PDF to a deal.
// Accepts multipart/form-data: file (PDF) + dealId (string).
//
// Stores the PDF in the private bucket "dealer-contracts" via the service-role
// client AND creates the ContractVersion, which starts the fail-closed Contract
// Shield scan. Returns { contractVersion, documentUrl, mimeType, sizeBytes }.
//
// Creating the ContractVersion here is the point. Attachment used to be two steps
// — this route, then POST /api/dealer/contracts/upload — and nothing ever took the
// second one: ContractUploadButton stops after this call, and that JSON route had
// no callers at all. So the PDF reached storage, the dealer was shown "Uploaded",
// and no ContractVersion existed. With no ContractVersion there is no scan, no
// APPROVED version and no signing envelope, so the deal dead-ended at
// CONTRACT_PENDING; the contract-shield cron looks for `ContractVersion` rows in
// status UPLOADED, found none, and reported healthy. One route that completes the
// pipeline cannot be left half-done by a caller that forgets step two.
import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { createServiceSupabaseClient } from "@/lib/supabase";
import { assertDealerOwnsDeal, uploadDealerContract, DealOwnershipError } from "@/lib/services/dealer/dealer-contract.service";

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const BUCKET = "dealer-contracts";

export async function POST(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("INVALID_REQUEST", "Invalid form data", 400);
  }

  const file = form.get("file") as File | null;
  const dealId = (form.get("dealId") as string | null)?.trim();

  if (!file) return errorResponse("VALIDATION_ERROR", "File is required", 400);
  if (!dealId) return errorResponse("VALIDATION_ERROR", "dealId is required", 400);

  // Only allow uploading against a deal this dealer actually won.
  try {
    await assertDealerOwnsDeal(dealId, dealer.id);
  } catch (err) {
    if (err instanceof DealOwnershipError) return errorResponse("FORBIDDEN", err.message, 403);
    throw err;
  }

  if (file.type !== "application/pdf") {
    return errorResponse("VALIDATION_ERROR", "Only PDF files are accepted", 400);
  }
  if (file.size > MAX_BYTES) {
    return errorResponse("VALIDATION_ERROR", "File must be under 20 MB", 400);
  }

  const supabase = createServiceSupabaseClient();
  const path = `${dealer.id}/${dealId}/${crypto.randomUUID()}.pdf`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: "application/pdf", upsert: false });

  if (uploadError) {
    logger.error("[dealer/contracts/upload-file]", uploadError);
    return errorResponse("STORAGE_ERROR", "File upload failed. Please try again.", 500);
  }

  // Complete the pipeline: version the contract and start the fail-closed scan.
  // The bucket is private, so what is persisted is the bare storage path (signed
  // at read time), never a public URL. Ownership was already asserted above;
  // uploadDealerContract re-asserts it, which is intentional — it is the service's
  // own chokepoint and protects every caller, not just this route.
  let cv;
  try {
    cv = await uploadDealerContract(dealId, dealer.id, path);
  } catch (err) {
    // Ownership was asserted above, but it is re-checked inside the service; if it
    // changed in between, answer 403 like the pre-check rather than a bare 500.
    if (err instanceof DealOwnershipError) return errorResponse("FORBIDDEN", err.message, 403);
    throw err;
  }

  return successResponse({
    contractVersion: cv,
    documentUrl: path,
    mimeType: "application/pdf",
    sizeBytes: file.size,
  });
}
