// POST /api/admin/social/generate
// Manually generate a post for a specific signal + franchise + platform.
// If platform is omitted, generates for every platform on the franchise.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { generateAndQueuePost } from "@/lib/social/social-post.orchestrator";
import { computePostingSlots } from "@/lib/social/scheduling";
import { z } from "zod";

const schema = z.object({
  signalId: z.string(),
  franchiseSlug: z.string(),
  platform: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.message, 400);
  const { signalId, franchiseSlug, platform } = parsed.data;

  const [signal, franchise] = await Promise.all([
    prisma.topicSignal.findUnique({ where: { id: signalId } }),
    prisma.contentFranchise.findUnique({ where: { slug: franchiseSlug } }),
  ]);
  if (!signal) return adminError("NOT_FOUND", "Signal not found", 404);
  if (!franchise) return adminError("NOT_FOUND", "Franchise not found", 404);

  const platforms = platform ? [platform] : franchise.platforms;
  const slots = computePostingSlots(franchise.postingSlots);

  console.log("[social-generate] signal:", signalId, "franchise:", franchiseSlug, "platforms:", platforms);

  const created: string[] = [];
  const failed: string[] = [];
  for (let i = 0; i < platforms.length; i++) {
    const scheduledAt = slots[i % Math.max(slots.length, 1)] ?? computePostingSlots([12])[0];
    try {
      console.log("[social-generate] calling orchestrator for platform:", platforms[i]);
      const post = await generateAndQueuePost({ signal, franchise, platform: platforms[i], scheduledAt });
      console.log("[social-generate] result: created post", post.id, "status", post.status);
      created.push(post.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[social-generate] platform ${platforms[i]} failed:`, message);
      failed.push(`${platforms[i]}: ${message}`);
    }
  }

  console.log("[social-generate] done. created:", created.length, "failed:", failed.length);

  await createAuditLog(admin, request, {
    action: "SOCIAL_POST_MANUAL_GENERATE",
    entityType: "SocialPost",
    entityId: signalId,
    metadata: { franchiseSlug, platforms, created: created.length, failed: failed.length },
  });

  if (created.length === 0) {
    return adminError("GENERATION_FAILED", failed.join("; ") || "No posts generated", 502);
  }
  return adminSuccess({ created, failed });
}
