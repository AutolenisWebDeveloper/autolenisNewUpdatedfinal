// AMIPS Phase 2 — tier-segmented sitemap builders.
//
// Each content tier gets its own sitemap so cohorts can be submitted and
// indexation tracked per tier (the AMIPS-3 indexation gate). Only ACTIVE pages
// appear — retiring a page (lifecycle_status != ACTIVE) removes it from the
// sitemap automatically. Shared here so the four tier routes and the index stay
// in lockstep.

import { prisma } from "@/lib/prisma";

const BASE = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

// Per-tier crawl priority (transaction-intent pages rank highest).
export const TIER_PRIORITY: Record<string, number> = {
  A: 0.8,
  B: 0.7,
  C: 0.9,
  D: 1.0,
};

const MAX_URLS = 50_000;

const XML_HEADERS = {
  "Content-Type": "application/xml",
  "Cache-Control": "public, max-age=3600, s-maxage=3600",
} as const;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Build the <urlset> XML for one content tier's ACTIVE pages.
 */
export async function buildTierSitemap(tier: string): Promise<string> {
  const priority = TIER_PRIORITY[tier] ?? 0.7;

  let rows: Array<{
    slug: string;
    lastRefreshedAt: Date | null;
    publishedAt: Date | null;
    updatedAt: Date;
  }> = [];
  try {
    rows = await prisma.amipsPage.findMany({
      where: { contentTier: tier, lifecycleStatus: "ACTIVE" },
      select: {
        slug: true,
        lastRefreshedAt: true,
        publishedAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: MAX_URLS,
    });
  } catch {
    // DB unavailable (e.g. at build time) — emit an empty but valid sitemap.
    rows = [];
  }

  const urls = rows
    .map((r) => {
      const lastmod = (r.lastRefreshedAt ?? r.publishedAt ?? r.updatedAt)
        .toISOString()
        .slice(0, 10);
      return [
        "  <url>",
        `    <loc>${escapeXml(`${BASE}/intelligence/${r.slug}`)}</loc>`,
        `    <lastmod>${lastmod}</lastmod>`,
        "    <changefreq>monthly</changefreq>",
        `    <priority>${priority.toFixed(1)}</priority>`,
        "  </url>",
      ].join("\n");
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

/**
 * Build the <sitemapindex> XML referencing every tier sitemap.
 */
export function buildAmipsSitemapIndex(): string {
  const now = new Date().toISOString().slice(0, 10);
  const tiers = ["a", "b", "c", "d"];
  const entries = tiers
    .map((t) =>
      [
        "  <sitemap>",
        `    <loc>${BASE}/sitemap-amips-${t}.xml</loc>`,
        `    <lastmod>${now}</lastmod>`,
        "  </sitemap>",
      ].join("\n"),
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</sitemapindex>`;
}

/**
 * Helper used by the tier route handlers to return a cached XML response.
 */
export async function tierSitemapResponse(tier: string): Promise<Response> {
  const xml = await buildTierSitemap(tier);
  return new Response(xml, { headers: XML_HEADERS });
}

export function sitemapIndexResponse(): Response {
  return new Response(buildAmipsSitemapIndex(), { headers: XML_HEADERS });
}
