// POST /api/admin/social/competitor-scan
// Runs the AI competitor content scan on demand (admin Intelligence page) and
// returns the week's opportunities. The scan is idempotent per ISO week.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  try {
    const { scanCompetitorContent } = await import("@/lib/social/competitor-monitor");
    const insights = await scanCompetitorContent();
    return adminSuccess({ insights, count: insights.length });
  } catch (err) {
    console.error("[admin/social] competitor-scan failed:", err);
    return adminError("COMPETITOR_SCAN_FAILED", "Competitor scan failed", 500);
  }
}
