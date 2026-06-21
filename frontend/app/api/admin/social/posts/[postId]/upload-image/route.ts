// POST /api/admin/social/posts/[postId]/upload-image
// Uploads a user-provided image (multipart form, field "file") for an existing
// post, stores it in social-media-assets, and attaches it as the post's
// VIDEO_READY image so the post can publish without AI generation.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { uploadAndAttachPostImage } from "@/lib/social/image-generation.service";

const MAX_BYTES = 15 * 1024 * 1024; // 15MB
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> },
) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const { postId } = await params;

  const post = await prisma.socialPost.findUnique({
    where: { id: postId },
    select: { id: true, platform: true },
  });
  if (!post) return adminError("NOT_FOUND", "Post not found", 404);

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
    const imageUrl = await uploadAndAttachPostImage(postId, buffer, file.type);

    await createAuditLog(admin, request, {
      action: "SOCIAL_POST_IMAGE_UPLOAD",
      entityType: "SocialPost",
      entityId: postId,
      metadata: { platform: post.platform, contentType: file.type, sizeBytes: file.size },
    });

    return adminSuccess({ imageUrl, message: "Image uploaded and attached" });
  } catch (err) {
    return adminError(
      "UPLOAD_FAILED",
      err instanceof Error ? err.message : "Image upload failed",
      500,
    );
  }
}
