// POST /api/admin/social/compose/upload-image
// Uploads a user-provided image (multipart form, field "file") during compose,
// before a post exists, and returns a stable hosted URL. The compose / bulk
// create flow then passes that URL as the post's image.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { uploadImageBufferToSupabase } from "@/lib/social/image-generation.service";

const MAX_BYTES = 15 * 1024 * 1024; // 15MB
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  let file: File | null;
  try {
    const formData = await request.formData();
    file = formData.get("file") as File | null;
  } catch {
    return adminError("VALIDATION_ERROR", "Expected multipart/form-data with a file", 400);
  }
  if (!file) return adminError("VALIDATION_ERROR", "No file provided", 400);
  if (!ALLOWED.has(file.type)) {
    return adminError("VALIDATION_ERROR", "File must be a JPEG, PNG, or WebP image", 400);
  }
  if (file.size > MAX_BYTES) {
    return adminError("VALIDATION_ERROR", "Image exceeds the 15MB limit", 400);
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.type.includes("png") ? "png" : file.type.includes("webp") ? "webp" : "jpg";
    const path = `compose-uploads/${admin.adminId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const imageUrl = await uploadImageBufferToSupabase(buffer, path, file.type);
    return adminSuccess({ imageUrl });
  } catch (err) {
    return adminError(
      "UPLOAD_FAILED",
      err instanceof Error ? err.message : "Image upload failed",
      500,
    );
  }
}
