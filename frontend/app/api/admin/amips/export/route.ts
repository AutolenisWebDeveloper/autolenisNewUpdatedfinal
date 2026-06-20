import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-session";
import { loadExecutiveIntelligence } from "@/lib/amips/intelligence/executive-intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CSV cell escaping per RFC 4180.
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

type ReportKind = "opportunities" | "vehicles" | "content";

function buildCsv(kind: ReportKind, intel: Awaited<ReturnType<typeof loadExecutiveIntelligence>>): string {
  if (kind === "vehicles") {
    const header = ["make", "model", "avg_buyer_advantage", "metros", "dealers", "outlook"];
    const rows = intel.segments.map((s) =>
      [s.make, s.model, s.avgBuyerAdvantage, s.metros, s.dealers, s.outlook].map(csvCell).join(","),
    );
    return [header.join(","), ...rows].join("\n");
  }
  if (kind === "content") {
    const header = ["metric", "value"];
    const c = intel.content;
    const rows: Array<[string, string | number]> = [
      ["active_pages", c.activePages],
      ["under_review", c.underReview],
      ["refresh_required", c.refreshRequired],
      ["retired", c.retired],
      ["published_30d", c.published30d],
      ["published_7d", c.published7d],
      ["projected_next_30d", c.projectedNext30d],
      ["impressions", c.impressions],
      ["clicks", c.clicks],
      ["avg_ctr", c.ctr != null ? `${(c.ctr * 100).toFixed(2)}%` : ""],
      ["avg_position", c.avgPosition != null ? c.avgPosition.toFixed(1) : ""],
      ["leads", c.leads],
      ["revenue_attribution_cents", c.revenueAttributionCents],
      ["revenue_run_rate_cents", c.revenueRunRateCents],
      ["indexation_rate", `${Math.round(c.indexationRate * 100)}%`],
      ["indexation_decision", c.indexationDecision],
    ];
    return [header.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n");
  }
  // opportunities (default)
  const header = ["rank", "metro", "state", "opportunity_score", "lead_driver", "demand", "buyer_leverage", "dealers", "pages", "population"];
  const rows = intel.opportunities.map((o, i) =>
    [i + 1, o.metro, o.state, o.opportunityScore, o.driver, o.demandScore ?? "", o.buyerLeverage ?? "", o.dealers, o.pages, o.population ?? ""]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

// GET — download an executive-intelligence report as CSV.
//   ?report=opportunities | vehicles | content   (default: opportunities)
export async function GET(request: NextRequest) {
  await requireAdmin();

  const param = request.nextUrl.searchParams.get("report");
  const kind: ReportKind =
    param === "vehicles" || param === "content" ? param : "opportunities";

  const intel = await loadExecutiveIntelligence();
  const csv = buildCsv(kind, intel);
  const filename = `amips-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
