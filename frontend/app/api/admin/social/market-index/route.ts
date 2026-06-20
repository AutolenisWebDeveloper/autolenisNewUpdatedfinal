// /api/admin/social/market-index
// GET  — last published AutoLenis Market Index (for the dashboard tab).
// POST — generate a new Market Index now. Body { publish?: boolean } (default
//        true): publish:false generates a preview WITHOUT posting to LinkedIn;
//        publish:true (or omitted) runs the full generate-and-publish pipeline.

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { publishMarketIndex, generateMarketIndex } from "@/lib/social/market-index.generator";

export const maxDuration = 300;

export interface MarketIndexLast {
  title: string | null;
  summary: string | null;
  publishedAt: string | null;
  platformPostId: string | null;
  linkedInUrl: string | null;
  status: string | null;
}

function linkedInUrlFor(platformPostId: string | null): string | null {
  return platformPostId ? `https://www.linkedin.com/feed/update/${platformPostId}` : null;
}

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  try {
    const last = await prisma.socialPost.findFirst({
      where: { platform: "linkedin", contentType: "linkedin_article" },
      orderBy: { createdAt: "desc" },
      select: {
        hook: true,
        caption: true,
        publishedAt: true,
        platformPostId: true,
        status: true,
      },
    });

    const data: MarketIndexLast = {
      title: last?.hook ?? null,
      summary: last?.caption ?? null,
      publishedAt: last?.publishedAt ? last.publishedAt.toISOString() : null,
      platformPostId: last?.platformPostId ?? null,
      linkedInUrl: linkedInUrlFor(last?.platformPostId ?? null),
      status: last?.status ?? null,
    };
    return adminSuccess(data);
  } catch (err) {
    logger.error("[admin/social] market-index GET failed:", err);
    // Degrade gracefully when the social tables aren't provisioned.
    return adminSuccess({
      title: null,
      summary: null,
      publishedAt: null,
      platformPostId: null,
      linkedInUrl: null,
      status: null,
    } satisfies MarketIndexLast);
  }
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  // Default to publish:true so the dashboard "Generate Now" (no body) keeps its
  // generate-and-publish behavior, while the Intelligence page's explicit
  // { publish: false } generates a preview without posting to LinkedIn.
  const body = (await request.json().catch(() => ({}))) as { publish?: boolean };
  const shouldPublish = body.publish !== false;

  try {
    if (shouldPublish) {
      const result = await publishMarketIndex();
      return adminSuccess(result);
    }
    const report = await generateMarketIndex();
    return adminSuccess({ ...report, published: false });
  } catch (err) {
    logger.error("[admin/social] market-index POST failed:", err);
    return adminError("MARKET_INDEX_FAILED", "Market index generation failed", 500);
  }
}
