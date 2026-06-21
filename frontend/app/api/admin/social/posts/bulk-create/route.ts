// POST /api/admin/social/posts/bulk-create
// Creates many social posts at once from an array of rows (backs both the CSV
// import and the multi-row compose form). Each row may carry an already-uploaded
// imageUrl, which is attached so the post is immediately publishable. Partial
// failures are isolated and reported per-row.

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { buildUtmUrl } from "@/lib/social/config";
import { attachImageUrlToPost } from "@/lib/social/image-generation.service";
import { z } from "zod";

const VALID_PLATFORMS = ["tiktok", "instagram", "facebook", "youtube", "linkedin"] as const;

const rowSchema = z.object({
  platform: z.enum(VALID_PLATFORMS),
  franchiseSlug: z.string().optional(),
  hook: z.string().min(1).max(300),
  caption: z.string().min(1).max(5000),
  hashtags: z.union([z.array(z.string()), z.string()]).optional(),
  scheduledAt: z.string().optional(),
  imageUrl: z.string().url().optional(),
  status: z.enum(["APPROVED", "PENDING_REVIEW"]).optional(),
});

const schema = z.object({
  rows: z.array(rowSchema).min(1).max(200),
});

function contentTypeFor(platform: string): string {
  if (platform === "tiktok") return "tiktok_video";
  if (platform === "instagram") return "instagram_reel";
  if (platform === "youtube") return "youtube_short";
  return `${platform}_post`;
}

function toHashtagList(h: string[] | string | undefined): string[] {
  if (Array.isArray(h)) return h.map((s) => s.trim()).filter(Boolean);
  return (h ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.message, 400);
  const { rows } = parsed.data;

  // Resolve all referenced franchises once.
  const slugs = Array.from(
    new Set(rows.map((r) => r.franchiseSlug ?? "dealer_secret_daily")),
  );
  const franchises = await prisma.contentFranchise.findMany({
    where: { slug: { in: slugs } },
    select: { id: true, slug: true },
  });
  const franchiseBySlug = new Map(franchises.map((f) => [f.slug, f.id]));

  const created: string[] = [];
  const failed: { index: number; error: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const franchiseSlug = row.franchiseSlug ?? "dealer_secret_daily";
      const platform = row.platform;

      // Validate the scheduled date if provided.
      let scheduledAt: Date | null = null;
      if (row.scheduledAt) {
        const d = new Date(row.scheduledAt);
        if (Number.isNaN(d.getTime())) {
          failed.push({ index: i, error: "invalid scheduledAt" });
          continue;
        }
        scheduledAt = d;
      }

      const trackedUrl = buildUtmUrl({
        path: "/request-a-car",
        platform,
        franchise: franchiseSlug,
        hookType: "bulk",
        contentType: `${platform}_post`,
      });

      const post = await prisma.socialPost.create({
        data: {
          platform,
          franchiseId: franchiseBySlug.get(franchiseSlug) ?? null,
          contentType: contentTypeFor(platform),
          hookType: "bulk",
          hook: row.hook,
          script: row.caption,
          caption: row.caption,
          hashtags: toHashtagList(row.hashtags),
          status: row.status ?? "APPROVED",
          automationMode: "MANUAL_REVIEW",
          requiresReview: row.status === "PENDING_REVIEW",
          scheduledAt,
          utmSource: platform,
          utmMedium: "social_bulk",
          utmCampaign: `${franchiseSlug}_bulk`,
          utmPlatform: platform,
          utmHook: "bulk",
          trackedUrl,
          funnelDestination: "/request-a-car",
        },
      });

      if (row.imageUrl) {
        await attachImageUrlToPost(post.id, row.imageUrl, { provider: "bulk_upload" });
      }

      created.push(post.id);
    } catch (err) {
      logger.error(`[bulk-create] row ${i} failed:`, err instanceof Error ? err.message : err);
      failed.push({ index: i, error: err instanceof Error ? err.message : "create failed" });
    }
  }

  await createAuditLog(admin, request, {
    action: "SOCIAL_POST_BULK_CREATE",
    entityType: "SocialPost",
    entityId: created.join(",").slice(0, 500),
    metadata: { attempted: rows.length, created: created.length, failed: failed.length },
  });

  return adminSuccess({
    created: created.length,
    failed,
    total: rows.length,
    message: `Created ${created.length} of ${rows.length} posts`,
  });
}
