// WO-2 / Phase 3 — enqueue a content generation (or regeneration) batch.
//
// POST /api/admin/content/articles/generate
//   { slugs?: string[], filter?: {...}, reviewOnly?: boolean, regenerate?: boolean }
// Enqueues ContentGenerationJob items (status QUEUED) and returns the job id; the
// internal content-generation-drain cron performs the long-running generation.

import { NextRequest } from "next/server";
import { z } from "zod";
import { adminError, adminSuccess, createAuditLog } from "@/lib/auth/admin-api";
import { requireContentCapability } from "@/lib/auth/content-permissions";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { enqueueGeneration } from "@/lib/services/content/content-generation.service";

const schema = z
  .object({
    slugs: z.array(z.string().min(1)).optional(),
    reviewOnly: z.boolean().optional(),
    regenerate: z.boolean().optional(),
    filter: z
      .object({
        cluster: z.string().optional(),
        metro: z.string().optional(),
        status: z.string().optional(),
      })
      .optional(),
  })
  .refine((d) => (d.slugs && d.slugs.length > 0) || d.filter, {
    message: "Provide a non-empty slugs array or a filter",
  });

export async function POST(request: NextRequest) {
  const admin = await requireContentCapability(request, "content.generate");
  if (!admin) return adminError("FORBIDDEN", "Missing content.generate capability", 403);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.message, 400);

  const { reviewOnly, regenerate, filter } = parsed.data;
  let slugs = parsed.data.slugs ?? [];

  // A filter (regeneration path) resolves to the matching existing article slugs.
  if (slugs.length === 0 && filter) {
    const where: Prisma.ContentArticleWhereInput = {};
    if (filter.cluster) where.cluster = filter.cluster;
    if (filter.metro) where.metro = filter.metro;
    if (filter.status) where.status = filter.status as Prisma.ContentArticleWhereInput["status"];
    const rows = await prisma.contentArticle.findMany({ where, select: { slug: true }, take: 5000 });
    slugs = rows.map((r) => r.slug);
  }

  if (slugs.length === 0) return adminError("EMPTY_SELECTION", "No slugs matched", 400);

  const job = await enqueueGeneration({
    slugs,
    op: regenerate ? "regenerate" : "generate",
    reviewOnly,
    createdByAdminId: admin.adminId,
    filter: filter ?? null,
  });

  await createAuditLog(admin, request, {
    action: regenerate ? "CONTENT_ARTICLE_REGENERATE_ENQUEUED" : "CONTENT_ARTICLE_GENERATE_ENQUEUED",
    entityType: "ContentGenerationJob",
    entityId: job.id,
    metadata: { count: slugs.length, reviewOnly: !!reviewOnly, regenerate: !!regenerate },
  });

  return adminSuccess({ jobId: job.id, queued: slugs.length });
}
