// GET /api/admin/social/analytics/audience
// Returns cached audience demographics per platform, populated by the analytics
// sync cron (which writes `audience_<platform>` keys into
// SocialIntelligenceCache). An optional `platform` query param scopes the read.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

const PLATFORMS = ["tiktok", "instagram", "facebook", "youtube", "linkedin"] as const;
type Platform = (typeof PLATFORMS)[number];

interface AudienceBreakdown {
  countries: { country: string; pct: number }[];
  ageRanges: { range: string; pct: number }[];
  genders: { gender: string; pct: number }[];
  updatedAt?: string;
}

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const requested = request.nextUrl.searchParams.get("platform")?.toLowerCase();
  const targets: Platform[] =
    requested && (PLATFORMS as readonly string[]).includes(requested)
      ? [requested as Platform]
      : [...PLATFORMS];

  const rows = await prisma.socialIntelligenceCache.findMany({
    where: { cacheKey: { in: targets.map((p) => `audience_${p}`) } },
  });

  const byKey = new Map(rows.map((r) => [r.cacheKey, r]));

  const platforms: Record<string, AudienceBreakdown | null> = {};
  let lastUpdated: Date | null = null;

  for (const p of PLATFORMS) {
    const row = byKey.get(`audience_${p}`);
    if (!row) {
      platforms[p] = null;
      continue;
    }
    const data = (row.data ?? {}) as Partial<AudienceBreakdown>;
    platforms[p] = {
      countries: data.countries ?? [],
      ageRanges: data.ageRanges ?? [],
      genders: data.genders ?? [],
      updatedAt: data.updatedAt,
    };
    if (!lastUpdated || row.updatedAt > lastUpdated) lastUpdated = row.updatedAt;
  }

  return adminSuccess({ platforms, lastUpdated });
}
