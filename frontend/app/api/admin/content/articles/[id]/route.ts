// Bulk Article Management — single article status mutation.
//
// PATCH /api/admin/content/articles/[id] — publish / archive / draft one
// ContentArticle from the bulk dashboard row actions and preview drawer.
// Delegates to the shared updateContentArticleStatus service so published_at
// stamping/clearing stays identical to the review flow. Audit-logged.

import { NextRequest } from "next/server";
import { z } from "zod";
import {
  getAdminFromRequest,
  adminSuccess,
  adminError,
  createAuditLog,
} from "@/lib/auth/admin-api";
import { updateContentArticleStatus } from "@/lib/services/admin/admin-content.service";

interface Props {
  params: Promise<{ id: string }>;
}

// "RETIRED" is accepted as an alias for the platform's ARCHIVED state so the
// client can speak the spec's vocabulary; everything persists as ARCHIVED.
const patchSchema = z.object({
  status: z.enum(["PUBLISHED", "ARCHIVED", "RETIRED", "DRAFT", "REVIEW_NEEDED"]),
});

export async function PATCH(request: NextRequest, { params }: Props) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return adminError("VALIDATION_ERROR", parsed.error.message, 400);
  }

  const status = parsed.data.status === "RETIRED" ? "ARCHIVED" : parsed.data.status;
  const result = await updateContentArticleStatus(id, status);
  if (!result) return adminError("NOT_FOUND", "Article not found", 404);

  await createAuditLog(admin, request, {
    action: "CONTENT_ARTICLE_STATUS_CHANGED",
    entityType: "ContentArticle",
    entityId: id,
    metadata: {
      slug: result.article.slug,
      from: result.previousStatus,
      to: result.article.status,
    },
    previousState: { status: result.previousStatus },
    newState: { status: result.article.status },
  });

  return adminSuccess({
    article: {
      id: result.article.id,
      status: result.article.status,
      publishedAt: result.article.publishedAt,
    },
  });
}
