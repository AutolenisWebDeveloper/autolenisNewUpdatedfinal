// Phase C3 — Admin Content Management API.
//
// GET   /api/admin/content/[id]  — fetch a single ContentArticle (review view).
// PATCH /api/admin/content/[id]  — change article status (publish / review /
//                                  draft / archive). Audit-logged.

import { NextRequest } from "next/server";
import { z } from "zod";
import {
  getAdminFromRequest,
  adminSuccess,
  adminError,
  createAuditLog,
} from "@/lib/auth/admin-api";
import {
  getContentArticleById,
  updateContentArticleStatus,
} from "@/lib/services/admin/admin-content.service";
import { ARTICLE_STATUSES } from "@/lib/content/cluster-meta";

interface Props {
  params: Promise<{ id: string }>;
}

const patchSchema = z.object({
  status: z.enum(ARTICLE_STATUSES),
});

export async function GET(request: NextRequest, { params }: Props) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { id } = await params;
  const article = await getContentArticleById(id);
  if (!article) return adminError("NOT_FOUND", "Article not found", 404);

  return adminSuccess({ article });
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return adminError("VALIDATION_ERROR", parsed.error.message, 400);
  }

  const result = await updateContentArticleStatus(id, parsed.data.status);
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
