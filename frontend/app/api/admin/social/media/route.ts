// GET /api/admin/social/media
// Lists generated visual assets (SocialVideo rows that have a thumbnail) joined
// with their parent post. Supports platform / media-type / status filters for
// the dashboard Media grid.

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import type { Prisma, SocialVideoStatus } from "@prisma/client";

const VALID_STATUS: SocialVideoStatus[] = [
  "SCRIPT_READY", "VIDEO_QUEUED", "VIDEO_GENERATING", "VIDEO_READY", "VIDEO_FAILED", "PUBLISH_READY",
];

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  // An unauthenticated request is a 401 — not an empty result. Only a DB/query
  // failure degrades to an empty list (handled in the catch below), matching the
  // posts route which also returns 401 here.
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform") ?? undefined;
  const mediaType = searchParams.get("type") ?? undefined; // "image" | "video"
  const status = searchParams.get("status") ?? undefined;

  const where: Prisma.SocialVideoWhereInput = { thumbnailUrl: { not: null } };
  if (status && VALID_STATUS.includes(status as SocialVideoStatus)) {
    where.status = status as SocialVideoStatus;
  }
  if (mediaType === "video") where.videoUrl = { not: null };
  if (mediaType === "image") where.videoUrl = null;
  if (platform) where.post = { platform };

  try {
    const media = await prisma.socialVideo.findMany({
      where,
      include: {
        post: {
          select: {
            id: true,
            platform: true,
            hook: true,
            status: true,
            scheduledAt: true,
            franchise: { select: { name: true, slug: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return adminSuccess({ media });
  } catch (err) {
    logger.error("[admin/social] media query failed:", err);
    return adminSuccess({ media: [] });
  }
}
