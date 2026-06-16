// Intelligence sitemap — every ACTIVE AMIPS market-intelligence page across all
// tiers, served as a single <urlset>. URLs mirror the /intelligence/[slug] route
// loader (prisma.amipsPage), so retiring a page (lifecycleStatus != ACTIVE)
// removes it from the sitemap automatically. Public route — see proxy.ts.
export const dynamic = "force-dynamic";

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const BASE = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

const MAX_URLS = 50_000;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  let rows: Array<{
    slug: string;
    lastRefreshedAt: Date | null;
    publishedAt: Date | null;
    updatedAt: Date;
  }> = [];
  try {
    rows = await prisma.amipsPage.findMany({
      where: { lifecycleStatus: "ACTIVE" },
      select: {
        slug: true,
        lastRefreshedAt: true,
        publishedAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: MAX_URLS,
    });
  } catch (err) {
    // DB unavailable (e.g. at build time) — emit an empty but valid sitemap.
    logger.error("[sitemap-intelligence] error:", err);
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
        "    <changefreq>weekly</changefreq>",
        "    <priority>0.8</priority>",
        "  </url>",
      ].join("\n");
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
