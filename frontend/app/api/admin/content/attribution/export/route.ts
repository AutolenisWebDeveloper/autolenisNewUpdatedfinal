import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";

// Phase C-Attribution — CSV export of the raw content-attribution rows for the
// admin dashboard. Admin-only (requireAdmin); GET so the dashboard can link to
// it directly as a download.

export const dynamic = "force-dynamic";

const COLUMNS = [
  "created_at",
  "article_slug",
  "cluster",
  "city",
  "state",
  "metro",
  "source",
  "lead_temperature",
  "converted",
  "converted_at",
  "conversion_value_cents",
  "email",
  "buyer_opportunity_id",
] as const;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = value instanceof Date ? value.toISOString() : String(value);
  // Quote and escape if the value contains a comma, quote, or newline.
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET() {
  await requireAdmin();

  const rows = await prisma.contentAttribution.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      articleSlug: true,
      cluster: true,
      city: true,
      state: true,
      metro: true,
      source: true,
      leadTemperature: true,
      converted: true,
      convertedAt: true,
      conversionValueCents: true,
      email: true,
      buyerOpportunityId: true,
    },
  });

  const lines = [
    COLUMNS.join(","),
    ...rows.map((r) =>
      [
        r.createdAt,
        r.articleSlug,
        r.cluster,
        r.city,
        r.state,
        r.metro,
        r.source,
        r.leadTemperature,
        r.converted,
        r.convertedAt,
        r.conversionValueCents,
        r.email,
        r.buyerOpportunityId,
      ]
        .map(csvCell)
        .join(","),
    ),
  ];

  const filename = `content-attribution-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
