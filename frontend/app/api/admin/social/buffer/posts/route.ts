// GET /api/admin/social/buffer/posts
// Retrieves posts directly from Buffer (the source of truth for what is actually
// published / scheduled / queued on the connected social accounts) and joins
// them back to local SocialPost rows by platformPostId so the dashboard shows a
// single, reconciled view.
//
// Query params:
//   status   — comma-separated Buffer statuses (draft,needs_approval,scheduled,
//              sending,sent,error). Omit for all.
//   platform — service hint (facebook|instagram|tiktok|youtube|linkedin) to scope
//              to one channel.
//   limit    — page size (1-100, default 25)
//   after    — pagination cursor (endCursor from a previous page)
//   metrics  — "true" to include per-post analytics (slower, larger)

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import {
  listBufferPosts,
  type BufferPostStatus,
  type ListBufferPostsResult,
} from "@/lib/social/providers/buffer.provider";

// External Buffer round-trip (optionally with metrics) can take a few seconds.
export const maxDuration = 30;

const VALID_STATUSES: BufferPostStatus[] = [
  "draft",
  "needs_approval",
  "scheduled",
  "sending",
  "sent",
  "error",
];

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const sp = request.nextUrl.searchParams;
  const statuses = (sp.get("status") ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is BufferPostStatus => VALID_STATUSES.includes(s as BufferPostStatus));
  const platform = sp.get("platform")?.trim() || undefined;
  const limit = Number(sp.get("limit") ?? "25");
  const after = sp.get("after") ?? undefined;
  const includeMetrics = sp.get("metrics") === "true";

  let result: ListBufferPostsResult;
  try {
    result = await listBufferPosts({
      statuses: statuses.length > 0 ? statuses : undefined,
      service: platform,
      first: Number.isFinite(limit) ? limit : 25,
      after,
      includeMetrics,
    });
  } catch (err) {
    return adminError(
      "BUFFER_LIST_FAILED",
      err instanceof Error ? err.message : "Failed to list Buffer posts",
      502,
    );
  }

  if (result.error) {
    const notConfigured = /not configured|no buffer organization/i.test(result.error);
    return adminError(
      notConfigured ? "BUFFER_NOT_CONFIGURED" : "BUFFER_LIST_FAILED",
      result.error,
      notConfigured ? 409 : 502,
    );
  }

  // Reconcile against local DB: attach the local SocialPost id (and its status)
  // for every Buffer post we already track, so the admin sees the link and any
  // drift between the two systems.
  const ids = result.posts.map((p) => p.id).filter(Boolean);
  const localByPlatformId = new Map<string, { id: string; status: string; leadScore: number }>();
  if (ids.length > 0) {
    const locals = await prisma.socialPost
      .findMany({
        where: { platformPostId: { in: ids } },
        select: { id: true, status: true, leadScore: true, platformPostId: true },
      })
      .catch(() => []);
    for (const l of locals) {
      if (l.platformPostId) {
        localByPlatformId.set(l.platformPostId, { id: l.id, status: l.status, leadScore: l.leadScore });
      }
    }
  }

  const posts = result.posts.map((p) => {
    const local = localByPlatformId.get(p.id);
    return {
      ...p,
      local: local ?? null,
      tracked: Boolean(local),
    };
  });

  return adminSuccess({
    posts,
    endCursor: result.endCursor,
    hasNextPage: result.hasNextPage,
    trackedCount: posts.filter((p) => p.tracked).length,
  });
}
