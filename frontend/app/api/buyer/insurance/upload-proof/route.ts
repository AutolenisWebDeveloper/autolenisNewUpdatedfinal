// POST /api/buyer/insurance/upload-proof
// Accepts multipart/form-data with `file` + `dealId`
// Validates file type (PDF/JPG/PNG) and size (≤ 10 MB)
// Uploads to Supabase Storage `insurance-proofs` bucket
// Updates deal.insuranceStatus to EXTERNAL_UPLOADED
// Creates buyer notification
//
// Required Supabase Storage configuration:
//   - Bucket name: "insurance-proofs"
//   - Access: private (admins access via service role key; files are not publicly accessible)
//   - RLS policy: authenticated buyers can INSERT their own files (path starts with their buyerId); service role can SELECT all
import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { createServiceSupabaseClient } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";

const MAX_BYTES     = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const BUCKET        = "insurance-proofs";

export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return errorResponse("BAD_REQUEST", "Request must be multipart/form-data", 400);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse("BAD_REQUEST", "Could not parse form data", 400);
  }

  const file   = formData.get("file");
  const dealId = formData.get("dealId");

  if (!file || !(file instanceof File)) {
    return errorResponse("BAD_REQUEST", "No file provided", 400);
  }
  if (!dealId || typeof dealId !== "string") {
    return errorResponse("BAD_REQUEST", "dealId is required", 400);
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return errorResponse("BAD_REQUEST", "File must be a PDF, JPG, or PNG", 400);
  }
  if (file.size > MAX_BYTES) {
    return errorResponse("BAD_REQUEST", "File exceeds 10 MB limit", 400);
  }

  // Verify deal ownership
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, buyerId: buyer.id },
  });
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);

  // Prevent re-upload if already verified
  if (deal.insuranceStatus === "VERIFIED" || deal.insuranceStatus === "POLICY_BOUND") {
    return errorResponse(
      "ALREADY_VERIFIED",
      "Insurance is already verified for this deal.",
      409,
    );
  }

  // Upload to Supabase Storage
  const supabase = createServiceSupabaseClient();
  const ext      = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1];
  const path     = `${buyer.id}/${dealId}/${crypto.randomUUID()}.${ext}`;
  const buffer   = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: false });

  if (uploadError) {
    console.error("[upload-proof] Supabase storage error:", uploadError);
    return errorResponse(
      "UPLOAD_FAILED",
      "File upload failed. Please try again or contact support.",
      500,
    );
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const proofUrl = urlData.publicUrl;

  // Update deal insurance status
  await prisma.deal.update({
    where: { id: dealId },
    data:  { insuranceStatus: "EXTERNAL_UPLOADED" },
  });

  // Notify buyer
  await prisma.notification.create({
    data: {
      buyerId: buyer.id,
      type:    "DEAL_STAGE_CHANGED",
      title:   "Insurance proof uploaded",
      body:    "Your proof of insurance has been submitted and is under review. We'll notify you once it's verified.",
    },
  }).catch((err: unknown) => {
    console.error("[upload-proof] buyer notification failed:", err);
  });

  return successResponse({ status: "EXTERNAL_UPLOADED", proofUrl }, 201);
}
