// POST /api/admin/social/posts/bulk
// Bulk approve | reject | skip across a set of post ids.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { approvePost, rejectPost } from "@/lib/social/social-post.orchestrator";
import { z } from "zod";

const schema = z.object({
  action: z.enum(["approve", "reject", "skip"]),
  ids: z.array(z.string()).min(1).max(200),
  rejectionReason: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.message, 400);
  const { action, ids, rejectionReason } = parsed.data;

  let processed = 0;
  const failed: string[] = [];

  for (const id of ids) {
    try {
      if (action === "approve") await approvePost(id);
      else if (action === "reject") await rejectPost(id, rejectionReason ?? "Bulk rejected by admin");
      else await prisma.socialPost.update({ where: { id }, data: { status: "SKIPPED" } });
      processed += 1;
    } catch {
      failed.push(id);
    }
  }

  await createAuditLog(admin, request, {
    action: `SOCIAL_POST_BULK_${action.toUpperCase()}`,
    entityType: "SocialPost",
    entityId: ids.join(","),
    metadata: { action, count: ids.length, processed, failed: failed.length },
  });

  return adminSuccess({ processed, failed });
}
