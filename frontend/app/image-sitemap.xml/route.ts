import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const BASE = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

export const dynamic = "force-dynamic";
export const revalidate = 3600;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  let vehicles: Array<{ id: string; year: number; make: string; model: string; images: string[] }> = [];
  try {
    vehicles = await prisma.inventoryItem.findMany({
      where: { isActive: true },
      select: { id: true, year: true, make: true, model: true, images: true },
      take: 5000,
      orderBy: { updatedAt: "desc" },
    });
  } catch {
    vehicles = [];
  }

  const entries = vehicles
    .filter(v => Array.isArray(v.images) && v.images.length > 0)
    .map(v => {
      const imgs = v.images.slice(0, 3);
      const title = escapeXml(`${v.year} ${v.make} ${v.model}`);
      const imageXml = imgs
        .map(
          url =>
            `    <image:image>
      <image:loc>${escapeXml(url)}</image:loc>
      <image:title>${title}</image:title>
    </image:image>`
        )
        .join("\n");
      return `  <url>
    <loc>${BASE}/inventory/${v.id}</loc>
${imageXml}
  </url>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries}
</urlset>`;

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
