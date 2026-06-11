// Phase 3 — content generation job dashboard feed.
// GET /api/admin/content/jobs?status=&cursor=&limit=  (cursor pagination)

import { NextRequest } from "next/server";
import { adminError, adminSuccess } from "@/lib/auth/admin-api";
import { requireContentCapability } from "@/lib/auth/content-permissions";
import { prisma } from "@/lib/prisma";
import type { ContentJobStatus, Prisma } from "@prisma/client";

const JOB_STATUSES = ["QUEUED", "PROCESSING", "SUCCEEDED", "FAILED", "CANCELED", "PAUSED"];
const MAX_LIMIT = 100;

export async function GET(request: NextRequest) {
  const admin = await requireContentCapability(request, "content.view");
  if (!admin) return adminError("FORBIDDEN", "Missing content.view capability", 403);

  const params = request.nextUrl.searchParams;
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(params.get("limit")) || 25));
  const cursor = params.get("cursor") || undefined;
  const status = params.get("status") || undefined;

  const where: Prisma.ContentGenerationJobWhereInput = {};
  if (status && JOB_STATUSES.includes(status)) where.status = status as ContentJobStatus;

  const rows = await prisma.contentGenerationJob.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { _count: { select: { items: true } } },
  });

  const hasMore = rows.length > limit;
  const jobs = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? jobs[jobs.length - 1]?.id : null;

  return adminSuccess({ jobs, nextCursor, hasMore });
}
